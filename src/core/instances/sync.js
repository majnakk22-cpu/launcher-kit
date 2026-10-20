'use strict';
// Синхронизация сборки с сервером по JSON-манифесту (формат — docs/MANIFEST.md).
// Лаунчер скачивает недостающие/изменённые файлы и удаляет лишние в "управляемых" папках.
const path = require('path');
const { fsp, exists, readJson, writeJson, safeJoin, walkFiles, removeEmptyDirs } = require('../util/fs');
const { getJson } = require('../util/http');

const STATE_FILE = '.launcher-sync.json';

function globToRegex(glob) {
  const esc = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\u0000/g, '.*');
  return new RegExp(`^${esc}$`, 'i');
}

function validateManifest(m) {
  if (!m || typeof m !== 'object') throw new Error('Манифест пустой или не JSON');
  if (!m.minecraft) throw new Error('В манифесте не указан "minecraft"');
  if (m.files && !Array.isArray(m.files)) throw new Error('"files" должен быть массивом');
  for (const f of m.files || []) {
    if (!f.path) throw new Error('У файла в манифесте нет "path"');
    safeJoin('/x', f.path); // бросит на "../"
  }
  return m;
}

class SyncService {
  constructor(ctx) { this.ctx = ctx; }

  async fetchManifest(url) {
    return validateManifest(await getJson(url, { headers: { 'Cache-Control': 'no-cache' } }));
  }

  /** Поля сборки, которые задаёт манифест. */
  instanceFieldsFrom(manifest, url) {
    const f = {
      name: manifest.name || manifest.id,
      minecraft: manifest.minecraft,
      loader: { type: manifest.loader?.type || 'vanilla', version: manifest.loader?.version || null },
      sync: { url, lastVersion: null, lastSync: null, locked: manifest.locked !== false },
    };
    if (manifest.icon) f.icon = manifest.icon;
    if (manifest.server) f.server = { address: manifest.server.address || '', port: manifest.server.port || 25565, autoConnect: Boolean(manifest.server.autoConnect) };
    if (manifest.java) {
      f.java = {};
      if (manifest.java.minMemory) f.java.minMemory = manifest.java.minMemory;
      if (manifest.java.maxMemory) f.java.maxMemory = manifest.java.maxMemory;
      if (manifest.java.args) f.java.args = manifest.java.args;
    }
    return f;
  }

  /** Создаёт сборку по ссылке на манифест (или возвращает существующую с тем же id). */
  async createFromManifest(url, { id } = {}) {
    const m = await this.fetchManifest(url);
    const wantedId = id || m.id;
    if (wantedId && await this.ctx.instances.has(wantedId)) {
      return this.ctx.instances.update(wantedId, this.instanceFieldsFrom(m, url));
    }
    return this.ctx.instances.create({ id: wantedId, ...this.instanceFieldsFrom(m, url) });
  }

  /**
   * Применяет манифест к сборке. onProgress({ done, total, bytes, totalBytes }).
   * Возвращает { version, downloaded, removed }.
   */
  async sync(instanceId, onProgress = () => {}) {
    const inst = await this.ctx.instances.get(instanceId);
    if (!inst.sync?.url) throw new Error('Сборка не привязана к манифесту');
    const url = inst.sync.url;
    const m = await this.fetchManifest(url);
    const gameDir = this.ctx.paths.gameDir(instanceId);

    // Обновляем параметры сборки (версия, модлоадер, память, сервер) — их задаёт сервер
    const fields = this.instanceFieldsFrom(m, url);
    delete fields.sync;
    await this.ctx.instances.update(instanceId, fields);

    const files = (m.files || []).filter((f) => !f.side || f.side === 'client' || f.side === 'both');
    const items = [];
    for (const f of files) {
      const abs = safeJoin(gameDir, f.path);
      if (f.mode === 'once' && await exists(abs)) continue; // например options.txt — не перезаписываем настройки игрока
      items.push({ url: new URL(f.url || f.path.split('/').map(encodeURIComponent).join('/'), url).href, path: abs, sha1: f.sha1, size: f.size });
    }
    const res = await this.ctx.downloader.downloadAll(items, onProgress, { label: `Синхронизация: ${m.name || inst.name}` });

    // Удаление лишнего
    const keep = new Set(files.map((f) => f.path.replace(/\\/g, '/')));
    const userContent = new Set((inst.content || []).map((c) => c.path));
    const keepPatterns = (m.keep || []).map(globToRegex);
    const isKept = (rel) => keep.has(rel) || userContent.has(rel) || keepPatterns.some((r) => r.test(rel));

    const state = await readJson(path.join(gameDir, STATE_FILE), { files: [] });
    const removed = [];
    // 1) файлы, которые раньше пришли с сервера, а теперь убраны из манифеста
    for (const rel of state.files || []) {
      if (!isKept(rel)) {
        await fsp.rm(safeJoin(gameDir, rel), { force: true });
        removed.push(rel);
      }
    }
    // 2) всё постороннее в управляемых папках (по умолчанию — mods)
    for (const dir of m.managedDirs || ['mods']) {
      const base = safeJoin(gameDir, dir);
      for (const relInDir of await walkFiles(base)) {
        const rel = `${dir.replace(/\/+$/, '')}/${relInDir}`;
        if (!isKept(rel)) {
          await fsp.rm(path.join(base, relInDir), { force: true });
          removed.push(rel);
        }
      }
      await removeEmptyDirs(base);
    }

    await writeJson(path.join(gameDir, STATE_FILE), { version: m.version || null, files: [...keep] });
    // Конфиги по умолчанию — один раз, после первой синхронизации
    if (!inst.defaultsApplied && this.ctx.defaults) {
      try { await this.ctx.defaults.applyTo(instanceId, { kind: 'server' }); } catch (e) { this.ctx.log('warn', `Конфиги по умолчанию: ${e.message}`); }
    }
    await this.ctx.instances.update(instanceId, { sync: { ...inst.sync, lastVersion: m.version || null, lastSync: Date.now() } });
    if (removed.length) this.ctx.log('info', `Синхронизация: удалено ${removed.length} файл(ов)`);
    return { version: m.version || null, downloaded: res.downloaded, removed: [...new Set(removed)] };
  }

  /** Есть ли обновление сборки на сервере. */
  async checkUpdate(instanceId) {
    const inst = await this.ctx.instances.get(instanceId);
    if (!inst.sync?.url) return null;
    const m = await this.fetchManifest(inst.sync.url);
    return { current: inst.sync.lastVersion, latest: m.version || null, hasUpdate: (m.version || null) !== inst.sync.lastVersion, changelog: m.changelog || null };
  }
}

module.exports = { SyncService, validateManifest, globToRegex, STATE_FILE };
