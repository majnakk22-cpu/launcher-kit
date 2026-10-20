'use strict';
// Реестр модлоадеров. Чтобы добавить свой — опиши объект { id, name, listVersions(mc), install(ctx, mc, ver, opts) }
// и зарегистрируй через core.loaders.register(loader).
const path = require('path');
const { readJson, writeJson, exists } = require('../util/fs');
const { fabric, quilt } = require('./fabric');
const { forge, neoforge } = require('./forge');
const { collectLibraries } = require('../minecraft/libraries');

const LOADER_TYPES = ['vanilla', 'forge', 'neoforge', 'fabric', 'quilt'];

class LoaderService {
  constructor(ctx) {
    this.ctx = ctx;
    this.registry = new Map();
    for (const l of [forge, neoforge, fabric, quilt]) this.register(l);
  }

  register(loader) { this.registry.set(loader.id, loader); }

  list() {
    return [{ id: 'vanilla', name: 'Vanilla' }, ...[...this.registry.values()].map((l) => ({ id: l.id, name: l.name }))];
  }

  get(id) {
    const l = this.registry.get(id);
    if (!l) throw new Error(`Неизвестный модлоадер: ${id}`);
    return l;
  }

  async listVersions(type, mc) {
    if (!type || type === 'vanilla') return [];
    return this.get(type).listVersions(mc);
  }

  /** "latest" / "recommended" / пусто -> конкретная версия. */
  async resolveVersion(type, mc, wanted) {
    if (wanted && !['latest', 'recommended'].includes(wanted)) return wanted;
    const list = await this.listVersions(type, mc);
    if (!list.length) throw new Error(`Нет версий ${type} для Minecraft ${mc}`);
    if (wanted === 'recommended') return (list.find((v) => v.recommended) || list.find((v) => v.stable) || list[0]).version;
    return (list.find((v) => v.stable) || list[0]).version;
  }

  get stateFile() { return path.join(this.ctx.paths.cache, 'installed-loaders.json'); }

  /**
   * Гарантирует, что модлоадер установлен. Возвращает id версии для запуска.
   * opts: { getJava(versionJson) -> javaPath, onProgress(text, progress) }
   */
  async ensureInstalled(type, mc, loaderVersion, opts = {}) {
    if (!type || type === 'vanilla') return mc;
    const version = await this.resolveVersion(type, mc, loaderVersion);
    const key = `${type}:${mc}:${version}`;
    const state = await readJson(this.stateFile, {});
    const known = state[key];
    if (known && await exists(this.ctx.paths.versionJson(known)) && await this._generatedPresent(known)) return known;

    this.ctx.log('info', `Установка ${type} ${version} для Minecraft ${mc}`);
    await this.ctx.versions.ensureVersionJson(mc);
    const id = await this.get(type).install(this.ctx, mc, version, opts);
    state[key] = id;
    await writeJson(this.stateFile, state);
    return id;
  }

  /** Проверяет, что библиотеки, которые создаёт установщик Forge, на месте. */
  async _generatedPresent(id) {
    try {
      const v = await this.ctx.versions.resolve(id);
      const { generated } = collectLibraries(v, this.ctx.paths);
      for (const f of generated) if (!(await exists(f))) return false;
      return true;
    } catch { return false; }
  }
}

module.exports = { LoaderService, LOADER_TYPES };
