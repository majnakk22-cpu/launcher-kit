'use strict';
// Менеджер загрузок: общая очередь, лимит потоков, отмена, пауза, снимки состояния.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Downloader } = require('../src/core/downloader');
const { startServer, sha1, tmpDir } = require('./helpers');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Медленная раздача: 4 куска с паузами. */
function slow(buf, delay = 60) {
  return (req, res) => {
    let i = 0;
    const step = Math.ceil(buf.length / 4);
    const tick = () => {
      if (res.destroyed) return;
      if (i >= buf.length) { res.end(); return; }
      res.write(buf.subarray(i, i + step));
      i += step;
      setTimeout(tick, delay);
    };
    tick();
  };
}

test('общая очередь: лимит потоков на все задания сразу, снимки состояния', async (t) => {
  const dir = tmpDir();
  const files = Array.from({ length: 8 }, (_, i) => Buffer.alloc(4000 + i, i + 1));
  const routes = {};
  files.forEach((b, i) => { routes[`/f${i}`] = slow(b); });
  const srv = await startServer(routes);
  t.after(() => srv.close());

  const snaps = [];
  let maxActive = 0;
  const d = new Downloader({ concurrency: 3, onChange: (s) => { snaps.push(s); maxActive = Math.max(maxActive, s.active.length); } });
  const mk = (i) => ({ url: `${srv.url}/f${i}`, path: path.join(dir, `f${i}.bin`), sha1: sha1(files[i]), size: files[i].length });
  const progress = [];
  const [a, b] = await Promise.all([
    d.downloadAll([0, 1, 2, 3].map(mk), (p) => progress.push(p), { label: 'Задание A' }),
    d.downloadAll([4, 5, 6, 7].map(mk), undefined, { label: 'Задание B' }),
  ]);
  assert.equal(a.downloaded, 4);
  assert.equal(b.downloaded, 4);
  assert.ok(maxActive <= 3, `одновременно качалось ${maxActive} файлов`);
  assert.ok(snaps.some((s) => s.queued > 0), 'в снимках была очередь');
  assert.ok(snaps.some((s) => s.active.some((x) => x.label === 'Задание B')));
  const last = d.snapshot();
  assert.deepEqual(last.jobs.map((j) => [j.label, j.status]).sort(), [['Задание A', 'done'], ['Задание B', 'done']]);
  assert.equal(progress.at(-1).done, 4);

  // повторная загрузка тех же файлов — ничего не качает и не засоряет историю
  const again = await d.downloadAll([0, 1].map(mk), undefined, { label: 'Проверка' });
  assert.equal(again.skipped, 2);
  assert.ok(!d.snapshot().jobs.some((j) => j.label === 'Проверка'));
});

test('отмена задания и пауза очереди', async (t) => {
  const dir = tmpDir();
  const big = Buffer.alloc(20000, 7);
  const srv = await startServer({ '/a': slow(big, 150), '/b': slow(big, 150), '/c': slow(big, 150), '/ok': big });
  t.after(() => srv.close());
  const d = new Downloader({ concurrency: 1 });

  const job = d.downloadAll(['a', 'b', 'c'].map((n) => ({ url: `${srv.url}/${n}`, path: path.join(dir, `${n}.bin`), size: big.length })), undefined, { label: 'Долгое' });
  await sleep(100);
  const id = d.snapshot().jobs.find((j) => j.label === 'Долгое').id;
  assert.equal(d.snapshot().queued, 2);
  d.cancel(id);
  await assert.rejects(job, /Загрузка отменена/);
  await sleep(50);
  const s = d.snapshot();
  assert.equal(s.queued, 0);
  assert.equal(s.active.length, 0);
  assert.equal(s.jobs.find((j) => j.id === id).status, 'cancelled');
  assert.ok(!fs.existsSync(path.join(dir, 'b.bin')));
  assert.ok(!fs.readdirSync(dir).some((f) => f.endsWith('.part')), 'недокачанные .part удалены');

  // пауза: задание ждёт, после resume — завершается
  d.pause();
  const p = d.downloadAll([{ url: `${srv.url}/ok`, path: path.join(dir, 'ok.bin'), sha1: sha1(big) }], undefined, { label: 'После паузы' });
  await sleep(150);
  assert.equal(d.snapshot().queued, 1);
  assert.ok(!fs.existsSync(path.join(dir, 'ok.bin')));
  d.resume();
  await p;
  assert.ok(fs.existsSync(path.join(dir, 'ok.bin')));
});

test('ошибка обязательного файла валит задание, необязательного — нет', async (t) => {
  const dir = tmpDir();
  const srv = await startServer({ '/ok': 'data' });
  t.after(() => srv.close());
  const d = new Downloader({ concurrency: 2, retries: 0 });
  const r = await d.downloadAll([
    { url: `${srv.url}/ok`, path: path.join(dir, 'ok') },
    { url: `${srv.url}/missing`, path: path.join(dir, 'm1'), optional: true },
  ], undefined, { label: 'Опционально' });
  assert.equal(r.failed.length, 1);
  await assert.rejects(d.downloadAll([{ url: `${srv.url}/missing`, path: path.join(dir, 'm2') }], undefined, { label: 'Сломано' }), /404/);
  assert.equal(d.snapshot().jobs.find((j) => j.label === 'Сломано').status, 'failed');
});
