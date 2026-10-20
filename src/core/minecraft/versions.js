'use strict';
// Список версий Minecraft, загрузка version.json и слияние наследования (inheritsFrom).
const path = require('path');
const { readJson, writeJson, exists, statOrNull } = require('../util/fs');
const { getJson } = require('../util/http');
const { mavenKey } = require('../util/maven');

const MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const MANIFEST_TTL = 10 * 60 * 1000;

function libKey(lib) {
  try { return mavenKey(lib.name); } catch { return lib.name; }
}

/**
 * Слияние дочерней версии (Forge/Fabric/...) с родительской (ванилла).
 * Библиотеки ребёнка имеют приоритет: одинаковые group:artifact[:classifier] из родителя отбрасываются.
 */
function mergeVersions(parent, child) {
  const out = { ...parent, ...child };
  // Дубликаты убираем только МЕЖДУ ребёнком и родителем: внутри одной версии одинаковые
  // group:artifact с разными rules (например, отдельный lwjgl для macOS в 1.12.2) — это норма.
  const childKeys = new Set((child.libraries || []).map(libKey));
  out.libraries = [...(child.libraries || []), ...(parent.libraries || []).filter((l) => !childKeys.has(libKey(l)))];
  if (parent.arguments || child.arguments) {
    out.arguments = {
      game: [...(parent.arguments?.game || []), ...(child.arguments?.game || [])],
      jvm: [...(parent.arguments?.jvm || []), ...(child.arguments?.jvm || [])],
    };
  }
  out.minecraftArguments = child.minecraftArguments ?? parent.minecraftArguments;
  for (const k of ['downloads', 'assetIndex', 'assets', 'javaVersion', 'logging']) {
    if (child[k] === undefined && parent[k] !== undefined) out[k] = parent[k];
  }
  out.id = child.id;
  out.inheritsFrom = undefined;
  out._chain = [child.id, ...(parent._chain || [parent.id])];
  out._vanilla = parent._vanilla || parent.id;
  return out;
}

class VersionService {
  constructor(ctx) {
    this.ctx = ctx;
    this._manifest = null;
    this._manifestAt = 0;
  }

  get manifestCache() { return path.join(this.ctx.paths.cache, 'version_manifest_v2.json'); }

  async getManifest(force = false) {
    if (!force && this._manifest && Date.now() - this._manifestAt < MANIFEST_TTL) return this._manifest;
    try {
      this._manifest = await getJson(MANIFEST_URL, { timeout: 15000 });
      this._manifestAt = Date.now();
      await writeJson(this.manifestCache, this._manifest);
    } catch (e) {
      // офлайн-режим: берём кэш с диска
      const cached = await readJson(this.manifestCache, null);
      if (!cached) throw new Error(`Не удалось получить список версий Minecraft: ${e.message}`);
      this.ctx.log('warn', `Список версий взят из кэша (${e.message})`);
      this._manifest = cached;
      this._manifestAt = Date.now();
    }
    return this._manifest;
  }

  /** types: release | snapshot | old_beta | old_alpha */
  async listMinecraftVersions({ types = ['release'] } = {}) {
    const m = await this.getManifest();
    return m.versions.filter((v) => types.includes(v.type)).map((v) => ({ id: v.id, type: v.type, releaseTime: v.releaseTime }));
  }

  async latest() { return (await this.getManifest()).latest; }

  /** Установленные локально version.json (в том числе модлоадеры). */
  async listInstalled() {
    const { fsp } = require('../util/fs');
    let dirs = [];
    try { dirs = await fsp.readdir(this.ctx.paths.versions); } catch { /* пусто */ }
    const out = [];
    for (const d of dirs) if (await exists(this.ctx.paths.versionJson(d))) out.push(d);
    return out;
  }

  /** Гарантирует наличие versions/<id>/<id>.json. Для ваниллы скачивает по манифесту. */
  async ensureVersionJson(id) {
    const file = this.ctx.paths.versionJson(id);
    if (await statOrNull(file)) return readJson(file);
    const m = await this.getManifest();
    const entry = m.versions.find((v) => v.id === id);
    if (!entry) throw new Error(`Версия ${id} не найдена ни локально, ни в манифесте Mojang`);
    await this.ctx.downloader.downloadAll([{ url: entry.url, path: file, sha1: entry.sha1 }], undefined, { label: `Описание версии ${id}` });
    return readJson(file);
  }

  async saveVersionJson(json) {
    await writeJson(this.ctx.paths.versionJson(json.id), json);
  }

  /** Полностью разрешённая версия (с учётом inheritsFrom). */
  async resolve(id, depth = 0) {
    if (depth > 5) throw new Error('Слишком глубокая цепочка inheritsFrom');
    const json = await this.ensureVersionJson(id);
    if (!json.inheritsFrom) return { ...json, _chain: [json.id], _vanilla: json.id };
    const parent = await this.resolve(json.inheritsFrom, depth + 1);
    return mergeVersions(parent, json);
  }
}

module.exports = { VersionService, mergeVersions, MANIFEST_URL };
