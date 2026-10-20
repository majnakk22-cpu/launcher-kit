'use strict';
// «Конфиги по умолчанию»: настройки игры (options.txt), список серверов (servers.dat) и любые файлы
// (конфиги модов, ресурспаки, шейдеры…), которые применяются к каждой новой сборке.
//
// Хранилище:
//   <dataDir>/defaults.json        — настройки, сервера, режим
//   <dataDir>/defaults/files/**     — файлы, копируемые в игровую папку сборки
const path = require('path');
const { fsp, ensureDir, readJson, writeJson, exists, safeJoin, walkFiles } = require('../util/fs');
const { encodeOption, decodeOption, parseOptionsTxt, serializeOptionsTxt, parseExtra, schemaForUi, GAME_OPTIONS } = require('./game-options');
const nbt = require('../util/nbt');

function emptyDefaults() {
  return {
    enabled: true,
    // Как применять к модпакам и сборкам серверов, у которых свои настройки:
    //  override — наши значения важнее; fill — только то, чего нет у сборки; skip — не применять
    packMode: 'override',
    options: {}, // { lang: 'ru_ru', soundCategory_music: 0.3, fov: 90, ... } — только заданные ключи
    extraOptions: '', // произвольные строки "ключ:значение" для options.txt
    servers: [], // [{ name, ip }]
  };
}

class DefaultsService {
  constructor(ctx) {
    this.ctx = ctx;
    this.file = path.join(ctx.paths.root, 'defaults.json');
    this.filesDir = path.join(ctx.paths.root, 'defaults', 'files');
  }

  schema() { return schemaForUi(); }

  async get() {
    let data = await readJson(this.file, null);
    if (!data) {
      // Первый запуск: стартовые значения можно задать в launcher.config.json -> defaults
      const fromConfig = Object.fromEntries(Object.entries(this.ctx.config.defaults || {}).filter(([k]) => !k.startsWith('$')));
      data = { ...emptyDefaults(), ...fromConfig };
    }
    data = { ...emptyDefaults(), ...data };
    return { ...data, files: await this.listFiles() };
  }

  async set(patch) {
    const cur = await this.get();
    delete cur.files;
    const next = { ...cur, ...patch };
    delete next.files;
    // убираем пустые значения
    next.options = Object.fromEntries(Object.entries(next.options || {}).filter(([, v]) => v !== null && v !== undefined && v !== ''));
    next.servers = (next.servers || []).filter((s) => s && s.ip).map((s) => ({ name: String(s.name || s.ip).trim(), ip: String(s.ip).trim() }));
    await writeJson(this.file, next);
    this.ctx.emit('defaults-changed', null);
    return this.get();
  }

  // ---------- файлы ----------

  async listFiles() {
    return (await walkFiles(this.filesDir)).sort();
  }

  /** Копирует файлы с диска в defaults/files/<subdir>/ */
  async addFiles(filePaths, subdir = '') {
    const target = subdir ? safeJoin(this.filesDir, subdir) : this.filesDir;
    await ensureDir(target);
    for (const f of filePaths) await fsp.copyFile(f, path.join(target, path.basename(f)));
    this.ctx.emit('defaults-changed', null);
    return this.listFiles();
  }

  async removeFile(rel) {
    await fsp.rm(safeJoin(this.filesDir, rel), { force: true });
    this.ctx.emit('defaults-changed', null);
    return this.listFiles();
  }

  // ---------- применение ----------

  /** Все строки options.txt, которые мы хотим записать. */
  optionLines(d) {
    const out = {};
    for (const [k, v] of Object.entries(d.options || {})) Object.assign(out, encodeOption(k, v));
    Object.assign(out, parseExtra(d.extraOptions));
    return out;
  }

  /**
   * Применяет конфиги к сборке.
   * opts.kind: 'custom' | 'modpack' | 'server' — для модпаков/серверов учитывается packMode.
   * opts.mode: принудительный режим ('override' | 'fill').
   * Возвращает { options, servers, files } — сколько чего изменено.
   */
  async applyTo(instanceId, { kind = 'custom', mode } = {}) {
    const d = await this.get();
    const result = { options: 0, servers: 0, files: 0, skipped: false };
    let m = mode || (kind === 'custom' ? 'override' : d.packMode);
    if (!mode && !d.enabled) m = 'skip';
    if (m === 'skip') { result.skipped = true; return result; }
    const gameDir = this.ctx.paths.gameDir(instanceId);
    await ensureDir(gameDir);

    // 1. options.txt
    const lines = this.optionLines(d);
    if (Object.keys(lines).length) {
      const file = path.join(gameDir, 'options.txt');
      const map = parseOptionsTxt(await fsp.readFile(file, 'utf8').catch(() => ''));
      for (const [k, v] of Object.entries(lines)) {
        if (m === 'fill' && map.has(k)) continue;
        if (map.get(k) !== v) { map.set(k, v); result.options++; }
      }
      if (result.options) await fsp.writeFile(file, serializeOptionsTxt(map));
    }

    // 2. servers.dat — добавляем недостающие сервера (по адресу), существующие не трогаем
    if (d.servers.length) {
      const file = path.join(gameDir, 'servers.dat');
      let list = [];
      try { list = nbt.readServers(await fsp.readFile(file)); } catch { list = []; }
      const known = new Set(list.map((s) => s.ip.toLowerCase()));
      const add = d.servers.filter((s) => !known.has(s.ip.toLowerCase()));
      if (add.length) {
        // наши сервера — в начало списка, чтобы их было видно сразу
        await fsp.writeFile(file, nbt.writeServers([...add, ...list]));
        result.servers = add.length;
      }
    }

    // 3. файлы
    for (const rel of await this.listFiles()) {
      const dst = safeJoin(gameDir, rel);
      if (m === 'fill' && await exists(dst)) continue;
      await ensureDir(path.dirname(dst));
      await fsp.copyFile(path.join(this.filesDir, ...rel.split('/')), dst);
      result.files++;
    }

    await this.ctx.instances.update(instanceId, { defaultsApplied: Date.now() }).catch(() => {});
    this.ctx.log('info', `Конфиги по умолчанию применены к ${instanceId}: настроек ${result.options}, серверов ${result.servers}, файлов ${result.files}`);
    return result;
  }

  /** Применить ко всем существующим сборкам. */
  async applyToAll(opts = {}) {
    const out = {};
    for (const inst of await this.ctx.instances.list()) out[inst.id] = await this.applyTo(inst.id, { mode: 'override', ...opts });
    return out;
  }

  /**
   * Взять настройки из существующей сборки (настроил игру «как надо» — сделал это стандартом).
   * opts.keybinds — забрать и раскладку клавиш (key_*) в extraOptions.
   */
  async importFromInstance(instanceId, { keybinds = false, servers = true } = {}) {
    const gameDir = this.ctx.paths.gameDir(instanceId);
    const text = await fsp.readFile(path.join(gameDir, 'options.txt'), 'utf8').catch(() => null);
    if (text === null) throw new Error('В этой сборке ещё нет options.txt — запусти её хотя бы раз');
    const map = parseOptionsTxt(text);
    const options = {};
    for (const o of GAME_OPTIONS) {
      if (map.has(o.key)) {
        const v = decodeOption(o.key, map.get(o.key));
        if (v !== undefined && !Number.isNaN(v)) options[o.key] = v;
      }
    }
    const cur = await this.get();
    const patch = { options };
    if (keybinds) {
      const extra = parseExtra(cur.extraOptions);
      for (const [k, v] of map) if (k.startsWith('key_')) extra[k] = v;
      patch.extraOptions = Object.entries(extra).map(([k, v]) => `${k}:${v}`).join('\n');
    }
    if (servers) {
      try {
        const list = nbt.readServers(await fsp.readFile(path.join(gameDir, 'servers.dat')));
        const known = new Set(cur.servers.map((s) => s.ip.toLowerCase()));
        patch.servers = [...cur.servers, ...list.filter((s) => s.ip && !known.has(s.ip.toLowerCase())).map((s) => ({ name: s.name, ip: s.ip }))];
      } catch { /* нет servers.dat */ }
    }
    return this.set(patch);
  }
}

module.exports = { DefaultsService, emptyDefaults };
