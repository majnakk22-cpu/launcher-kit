'use strict';
// Менеджер загрузок: одна общая очередь на весь лаунчер.
// Каждый вызов downloadAll() — это «задание» (job) с понятным названием; файлы заданий
// ставятся в общую очередь и качаются не больше `concurrency` штук одновременно.
// Задание можно отменить, всю очередь — поставить на паузу. Снимок состояния уходит в UI.
const path = require('path');
const crypto = require('crypto');
const { Readable, Transform } = require('stream');
const { pipeline } = require('stream/promises');
const { fs, fsp, ensureDir, statOrNull, sha1File } = require('./util/fs');
const { request, HttpError, sleep } = require('./util/http');
const { runPool } = require('./util/pool');

class DownloadCancelledError extends Error {
  constructor(label) { super(`Загрузка отменена${label ? `: ${label}` : ''}`); this.cancelled = true; }
}

const FINISHED = new Set(['done', 'failed', 'cancelled']);
const HISTORY_LIMIT = 30;

/**
 * Элемент загрузки:
 * { url, path, sha1?, size?, optional?, verify?: 'sha1' | 'size', headers? }
 *  - verify:'size' — не считать хэш у существующего файла (ассеты: имя файла уже = хэш).
 *  - optional — ошибка не прерывает задание, а попадает в result.failed.
 */
class Downloader {
  constructor({ concurrency = 8, retries = 3, log = () => {}, onChange = () => {} } = {}) {
    this.concurrency = concurrency;
    this.retries = retries;
    this.log = log;
    this.onChange = onChange;
    this.jobs = new Map();
    this.queue = [];
    this.active = new Set();
    this.paused = false;
    this._seq = 0;
    this._bytesTotal = 0;
    this._samples = [];
    this._timer = null;
  }

  // ---------- проверка и скачивание одного файла ----------

  async isValid(item) {
    const st = await statOrNull(item.path);
    if (!st || !st.isFile()) return false;
    if (item.size != null && item.size > 0 && st.size !== item.size) return false;
    if (item.sha1 && item.verify !== 'size') {
      return (await sha1File(item.path)) === item.sha1.toLowerCase();
    }
    return true;
  }

  async downloadOne(item, onBytes = () => {}, signal = undefined) {
    if (!item.url) throw new Error(`Нет URL для ${item.path}`);
    await ensureDir(path.dirname(item.path));
    const tmp = `${item.path}.part`;
    let lastErr;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      if (signal?.aborted) throw new DownloadCancelledError();
      let received = 0;
      try {
        const res = await request(item.url, { timeout: 120000, retries: 0, headers: item.headers, signal });
        if (!res.ok) throw new HttpError(item.url, res.status);
        const hash = crypto.createHash('sha1');
        const meter = new Transform({
          transform(chunk, _enc, cb) { hash.update(chunk); received += chunk.length; onBytes(chunk.length); cb(null, chunk); },
        });
        await pipeline(Readable.fromWeb(res.body), meter, fs.createWriteStream(tmp));
        const digest = hash.digest('hex');
        if (item.sha1 && digest !== item.sha1.toLowerCase()) throw new Error(`sha1 не совпал для ${item.url}: ${digest} != ${item.sha1}`);
        if (item.size && received !== item.size) throw new Error(`Размер не совпал для ${item.url}: ${received} != ${item.size}`);
        await fsp.rename(tmp, item.path);
        return;
      } catch (e) {
        lastErr = e;
        onBytes(-received); // откатываем прогресс неудачной попытки
        await fsp.rm(tmp, { force: true }).catch(() => {});
        if (signal?.aborted) throw new DownloadCancelledError();
        if (e instanceof HttpError && (e.status === 404 || e.status === 403)) break; // повторять бессмысленно
        if (attempt < this.retries) await sleep(800 * (attempt + 1));
      }
    }
    throw lastErr;
  }

  // ---------- задания ----------

  /**
   * Скачивает все элементы как одно задание.
   * onProgress({ done, total, bytes, totalBytes, current }); opts: { label }
   * Возвращает { downloaded, skipped, failed: [{item, error}] }.
   */
  async downloadAll(items, onProgress = () => {}, { label = 'Загрузка' } = {}) {
    const map = new Map();
    for (const it of items) if (it && it.path && !map.has(path.resolve(it.path))) map.set(path.resolve(it.path), it);
    const list = [...map.values()];

    const job = {
      id: ++this._seq,
      label,
      status: 'checking',
      total: list.length,
      done: 0,
      skipped: 0,
      bytes: 0,
      totalBytes: 0,
      failed: [],
      error: null,
      createdAt: Date.now(),
      finishedAt: null,
      controller: new AbortController(),
      current: null,
      _lastEmit: 0,
    };
    job.emitProgress = (force) => {
      const now = Date.now();
      if (!force && now - job._lastEmit < 100) return;
      job._lastEmit = now;
      onProgress({ done: job.done, total: job.total, bytes: Math.max(0, job.bytes), totalBytes: job.totalBytes, current: job.current });
    };
    this.jobs.set(job.id, job);
    if (list.length > 20) this._notify(true); // короткие проверки не мелькают в UI

    // 1. Проверяем, что уже скачано
    const needed = [];
    await runPool(list, 16, async (it) => {
      if (job.status !== 'checking') return;
      if (await this.isValid(it)) job.skipped++;
      else needed.push(it);
    });
    if (job.status === 'cancelled') throw new DownloadCancelledError(label);

    if (!needed.length) {
      // всё на месте — задание не показываем в истории
      this.jobs.delete(job.id);
      this._notify(true);
      return { downloaded: 0, skipped: job.skipped, failed: [] };
    }

    job.total = needed.length;
    job.totalBytes = needed.reduce((s, it) => s + (it.size || 0), 0);
    job.status = 'queued';
    job.emitProgress(true);

    const result = await new Promise((resolve, reject) => {
      job.resolve = resolve;
      job.reject = reject;
      for (const item of needed) this.queue.push({ job, item, received: 0, startedAt: null });
      this._pump();
      this._notify(true);
    });
    job.emitProgress(true);
    return result;
  }

  _pump() {
    while (!this.paused && this.active.size < this.concurrency && this.queue.length) {
      const task = this.queue.shift();
      if (FINISHED.has(task.job.status)) continue;
      this._run(task);
    }
  }

  async _run(task) {
    const { job, item } = task;
    task.startedAt = Date.now();
    this.active.add(task);
    job.status = 'downloading';
    job.current = path.basename(item.path);
    try {
      await this.downloadOne(item, (n) => {
        task.received += n;
        job.bytes += n;
        if (n > 0) this._bytesTotal += n;
        job.emitProgress(false);
        this._notify(false);
      }, job.controller.signal);
      job.done++;
    } catch (e) {
      if (job.status === 'cancelled' || job.status === 'failed') { /* уже обработано */ }
      else if (item.optional) {
        job.failed.push({ item, error: e });
        job.done++;
        this.log('warn', `Не удалось скачать (необязательно): ${item.url}: ${e.message}`);
      } else this._fail(job, e);
    } finally {
      this.active.delete(task);
      if (!FINISHED.has(job.status) && job.done >= job.total) this._finish(job);
      this._pump();
      this._notify(false);
    }
  }

  _finish(job) {
    job.status = 'done';
    job.finishedAt = Date.now();
    job.current = null;
    job.resolve({ downloaded: job.total - job.failed.length, skipped: job.skipped, failed: job.failed });
    this._trim();
    this._notify(true);
  }

  _fail(job, err) {
    job.status = 'failed';
    job.error = err.message;
    job.finishedAt = Date.now();
    job.controller.abort();
    this.queue = this.queue.filter((t) => t.job !== job);
    job.reject?.(err);
    this._trim();
    this._notify(true);
  }

  /** Отмена задания: текущие файлы обрываются, остальные убираются из очереди. */
  cancel(jobId) {
    const job = this.jobs.get(Number(jobId));
    if (!job || FINISHED.has(job.status)) return false;
    job.status = 'cancelled';
    job.finishedAt = Date.now();
    job.controller.abort();
    this.queue = this.queue.filter((t) => t.job !== job);
    job.reject?.(new DownloadCancelledError(job.label));
    this._trim();
    this._pump();
    this._notify(true);
    return true;
  }

  cancelAll() { for (const id of [...this.jobs.keys()]) this.cancel(id); }

  /** Пауза: начатые файлы докачиваются, новые не стартуют. */
  pause() { this.paused = true; this._notify(true); }
  resume() { this.paused = false; this._pump(); this._notify(true); }

  clearFinished() {
    for (const [id, j] of this.jobs) if (FINISHED.has(j.status)) this.jobs.delete(id);
    this._notify(true);
  }

  _trim() {
    const finished = [...this.jobs.values()].filter((j) => FINISHED.has(j.status)).sort((a, b) => b.finishedAt - a.finishedAt);
    for (const j of finished.slice(HISTORY_LIMIT)) this.jobs.delete(j.id);
  }

  // ---------- снимок состояния для UI ----------

  _speed() {
    const now = Date.now();
    this._samples.push([now, this._bytesTotal]);
    while (this._samples.length > 2 && now - this._samples[0][0] > 3000) this._samples.shift();
    const [t0, b0] = this._samples[0];
    return now - t0 > 0 ? Math.round(((this._bytesTotal - b0) * 1000) / (now - t0)) : 0;
  }

  get isBusy() { return this.active.size > 0 || this.queue.length > 0; }

  snapshot() {
    const busy = this.isBusy;
    return {
      paused: this.paused,
      concurrency: this.concurrency,
      speed: busy ? this._speed() : 0,
      queued: this.queue.length,
      active: [...this.active].map((t) => ({ jobId: t.job.id, label: t.job.label, file: path.basename(t.item.path), received: Math.max(0, t.received), size: t.item.size || 0, startedAt: t.startedAt })),
      queue: this.queue.slice(0, 100).map((t) => ({ jobId: t.job.id, label: t.job.label, file: path.basename(t.item.path), size: t.item.size || 0 })),
      jobs: [...this.jobs.values()].sort((a, b) => b.createdAt - a.createdAt).map((j) => ({
        id: j.id, label: j.label, status: j.status, done: j.done, total: j.total, bytes: Math.max(0, j.bytes), totalBytes: j.totalBytes,
        skipped: j.skipped, failed: j.failed.length, error: j.error, createdAt: j.createdAt, finishedAt: j.finishedAt,
      })),
    };
  }

  _notify(immediate) {
    if (immediate) {
      if (this._timer) { clearTimeout(this._timer); this._timer = null; }
      this.onChange(this.snapshot());
      return;
    }
    if (this._timer) return;
    this._timer = setTimeout(() => { this._timer = null; this.onChange(this.snapshot()); }, 250);
    this._timer.unref?.();
  }
}

module.exports = { Downloader, DownloadCancelledError };
