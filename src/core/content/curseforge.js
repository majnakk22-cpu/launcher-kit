'use strict';
// CurseForge API (https://docs.curseforge.com). Нужен API-ключ: https://console.curseforge.com
// Ключ задаётся в launcher.config.json (curseforge.apiKey) или в настройках лаунчера.
const { request, ensureOk } = require('../util/http');

const API = 'https://api.curseforge.com/v1';
const GAME_ID = 432; // Minecraft
const CLASS = { mod: 6, modpack: 4471, resourcepack: 12, shader: 6552, datapack: 6945, world: 17 };
const CLASS_TO_TYPE = Object.fromEntries(Object.entries(CLASS).map(([k, v]) => [v, k]));
const LOADER = { forge: 1, fabric: 4, quilt: 5, neoforge: 6 };
const LOADER_NAMES = ['forge', 'fabric', 'quilt', 'neoforge'];
const SORT = { relevance: 1, follows: 2, updated: 3, downloads: 6, newest: 11 };
const RELEASE = { 1: 'release', 2: 'beta', 3: 'alpha' };
const RELATION = { 1: 'embedded', 2: 'optional', 3: 'required', 4: 'optional', 5: 'incompatible', 6: 'embedded' };

function normalizeMod(m) {
  return {
    provider: 'curseforge',
    id: String(m.id),
    slug: m.slug,
    title: m.name,
    description: m.summary,
    author: m.authors?.[0]?.name || null,
    iconUrl: m.logo?.thumbnailUrl || m.logo?.url || null,
    downloads: m.downloadCount || 0,
    updatedAt: m.dateModified || null,
    categories: (m.categories || []).map((c) => c.name),
    projectType: CLASS_TO_TYPE[m.classId] || 'mod',
    classId: m.classId,
    url: m.links?.websiteUrl || null,
  };
}

function normalizeFile(f) {
  const gv = f.gameVersions || [];
  return {
    provider: 'curseforge',
    projectId: String(f.modId),
    id: String(f.id),
    name: f.displayName,
    versionNumber: f.displayName,
    gameVersions: gv.filter((v) => /^\d/.test(v)),
    loaders: gv.map((v) => v.toLowerCase()).filter((v) => LOADER_NAMES.includes(v)),
    releaseType: RELEASE[f.releaseType] || 'release',
    date: f.fileDate,
    files: [{
      fileName: f.fileName,
      url: f.downloadUrl || null, // null — автор запретил скачивание сторонними лаунчерами
      sha1: (f.hashes || []).find((h) => h.algo === 1)?.value,
      size: f.fileLength,
      primary: true,
    }],
    dependencies: (f.dependencies || []).map((d) => ({ projectId: String(d.modId), versionId: null, type: RELATION[d.relationType] || 'optional' })),
  };
}

class CurseForgeProvider {
  /** getApiKey — функция, чтобы ключ можно было поменять в настройках без перезапуска. */
  constructor({ getApiKey, baseUrl = API }) {
    this.id = 'curseforge';
    this.name = 'CurseForge';
    this.getApiKey = getApiKey;
    this.baseUrl = baseUrl;
  }

  available() { return Boolean(this.getApiKey()); }

  async _call(pathAndQuery, { method = 'GET', json } = {}) {
    const key = this.getApiKey();
    if (!key) throw new Error('Не задан API-ключ CurseForge (настройки или launcher.config.json)');
    const url = `${this.baseUrl}${pathAndQuery}`;
    const res = await ensureOk(await request(url, { method, json, headers: { 'x-api-key': key, Accept: 'application/json' } }), url);
    return (await res.json()).data;
  }

  /** Категории для фильтра: [{ id, name, group }] */
  async getCategories(type = 'mod') {
    this._categories = this._categories || {};
    if (!this._categories[type]) {
      const list = await this._call(`/categories?gameId=${GAME_ID}&classId=${CLASS[type] || CLASS.mod}`);
      this._categories[type] = list.filter((c) => !c.isClass).map((c) => ({ id: String(c.id), name: c.name, group: null }))
        .sort((a, b) => a.name.localeCompare(b.name));
    }
    return this._categories[type];
  }

  async search({ query = '', type = 'mod', mcVersion, loader, categories = [], offset = 0, limit = 20, sort = 'relevance' } = {}) {
    const qs = new URLSearchParams({
      gameId: String(GAME_ID),
      classId: String(CLASS[type] || CLASS.mod),
      searchFilter: query,
      sortField: String(SORT[sort] || 1),
      sortOrder: 'desc',
      index: String(offset),
      pageSize: String(Math.min(limit, 50)),
    });
    if (mcVersion) qs.set('gameVersion', mcVersion);
    if ((type === 'mod' || type === 'modpack') && LOADER[loader]) qs.set('modLoaderType', String(LOADER[loader]));
    if (categories.length) qs.set('categoryIds', JSON.stringify(categories.slice(0, 10).map(Number)));
    const key = this.getApiKey();
    if (!key) throw new Error('Не задан API-ключ CurseForge');
    const url = `${this.baseUrl}/mods/search?${qs}`;
    const res = await ensureOk(await request(url, { headers: { 'x-api-key': key, Accept: 'application/json' } }), url);
    const body = await res.json();
    return { hits: body.data.map(normalizeMod), total: body.pagination?.totalCount || 0, offset, limit };
  }

  async getProject(id) {
    const m = await this._call(`/mods/${Number(id)}`);
    return normalizeMod(m);
  }

  async getVersions(projectId, { mcVersion, loader, type } = {}) {
    const qs = new URLSearchParams({ pageSize: '50' });
    if (mcVersion) qs.set('gameVersion', mcVersion);
    const list = (await this._call(`/mods/${Number(projectId)}/files?${qs}`)).map(normalizeFile);
    const wantLoaders = loader && loader !== 'vanilla' && (!type || type === 'mod') ? (loader === 'quilt' ? ['quilt', 'fabric'] : [loader]) : null;
    return list
      .filter((v) => !wantLoaders || v.loaders.length === 0 || v.loaders.some((l) => wantLoaders.includes(l)))
      .sort((a, b) => new Date(b.date) - new Date(a.date));
  }

  async getVersion(fileId, projectId) {
    if (projectId) return normalizeFile(await this._call(`/mods/${Number(projectId)}/files/${Number(fileId)}`));
    const [f] = await this._call('/mods/files', { method: 'POST', json: { fileIds: [Number(fileId)] } });
    if (!f) throw new Error(`Файл CurseForge ${fileId} не найден`);
    return normalizeFile(f);
  }

  async getFilesBatch(fileIds) {
    const out = [];
    for (let i = 0; i < fileIds.length; i += 500) {
      out.push(...await this._call('/mods/files', { method: 'POST', json: { fileIds: fileIds.slice(i, i + 500).map(Number) } }));
    }
    return out;
  }

  async getModsBatch(modIds) {
    const out = [];
    for (let i = 0; i < modIds.length; i += 500) {
      out.push(...await this._call('/mods', { method: 'POST', json: { modIds: modIds.slice(i, i + 500).map(Number) } }));
    }
    return out.map(normalizeMod);
  }
}

module.exports = { CurseForgeProvider, normalizeFile, normalizeMod, CLASS, CLASS_TO_TYPE };
