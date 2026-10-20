'use strict';
// Сборки (instances): у каждой своя игровая папка, версия, модлоадер, память, сервер и т.д.
const { fsp, ensureDir, readJson, writeJson, exists } = require('../util/fs');

const TRANSLIT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '',
  ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya', і: 'i', ї: 'yi', є: 'e',
};

function slugify(name) {
  const s = String(name || '').toLowerCase().split('').map((c) => TRANSLIT[c] ?? c).join('')
    .replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return s || 'instance';
}

function defaults() {
  return {
    formatVersion: 1,
    id: '',
    name: '',
    minecraft: '',
    loader: { type: 'vanilla', version: null },
    icon: null,
    java: { path: null, minMemory: null, maxMemory: null, args: [] },
    window: { width: 1280, height: 720, fullscreen: false },
    server: { address: '', port: 25565, autoConnect: false },
    sync: null, // { url, lastVersion, lastSync, locked } — сборка привязана к манифесту сервера
    modpack: null, // { provider, projectId, versionId, name } — установлена из Modrinth/CurseForge
    content: [], // установленные из каталога моды/ресурспаки: [{ provider, projectId, versionId, fileName, path, title }]
    createdAt: Date.now(),
    lastPlayed: null,
    playTimeMs: 0,
    defaultsApplied: null, // когда применены «конфиги по умолчанию»
  };
}

function deepMerge(base, patch) {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) out[k] = deepMerge(base[k], v);
    else out[k] = v;
  }
  return out;
}

class InstanceManager {
  constructor(ctx) { this.ctx = ctx; }

  async list() {
    let dirs = [];
    try { dirs = await fsp.readdir(this.ctx.paths.instances); } catch { return []; }
    const out = [];
    for (const d of dirs) {
      const inst = await readJson(this.ctx.paths.instanceFile(d), null).catch(() => null);
      if (inst) out.push(deepMerge(defaults(), inst));
    }
    return out.sort((a, b) => (b.lastPlayed || b.createdAt || 0) - (a.lastPlayed || a.createdAt || 0));
  }

  async get(id) {
    const inst = await readJson(this.ctx.paths.instanceFile(id), null);
    if (!inst) throw new Error(`Сборка "${id}" не найдена`);
    return deepMerge(defaults(), inst);
  }

  async has(id) { return exists(this.ctx.paths.instanceFile(id)); }

  async create(data) {
    if (!data.minecraft) throw new Error('Не указана версия Minecraft');
    let id = slugify(data.id || data.name || data.minecraft);
    if (!data.id) {
      const base = id;
      let n = 2;
      while (await this.has(id)) id = `${base}-${n++}`;
    } else if (await this.has(id)) throw new Error(`Сборка "${id}" уже существует`);
    const inst = deepMerge(defaults(), { ...data, id, name: data.name || id, createdAt: Date.now() });
    await ensureDir(this.ctx.paths.gameDir(id));
    await writeJson(this.ctx.paths.instanceFile(id), inst);
    // Конфиги по умолчанию. Модпакам и сборкам серверов они применяются после установки их файлов.
    if (!inst.sync && !inst.modpack && this.ctx.defaults) {
      try { await this.ctx.defaults.applyTo(id, { kind: 'custom' }); } catch (e) { this.ctx.log('warn', `Конфиги по умолчанию: ${e.message}`); }
    }
    this.ctx.emit('instances-changed');
    return this.get(id);
  }

  async update(id, patch) {
    const inst = deepMerge(await this.get(id), patch);
    inst.id = id;
    await writeJson(this.ctx.paths.instanceFile(id), inst);
    this.ctx.emit('instances-changed');
    return inst;
  }

  async remove(id) {
    await fsp.rm(this.ctx.paths.instanceDir(id), { recursive: true, force: true });
    this.ctx.emit('instances-changed');
  }

  async recordPlay(id, startedAt) {
    const inst = await this.get(id);
    await this.update(id, { lastPlayed: startedAt, playTimeMs: (inst.playTimeMs || 0) + (Date.now() - startedAt) });
  }
}

module.exports = { InstanceManager, slugify, deepMerge, instanceDefaults: defaults };
