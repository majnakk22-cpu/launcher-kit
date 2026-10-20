'use strict';
// Modrinth API v2 (https://docs.modrinth.com). Ключ не нужен, но обязателен осмысленный User-Agent.
const { getJson } = require('../util/http');

const API = 'https://api.modrinth.com/v2';
const CATEGORY_RU = {
  adventure: 'Приключения', cursed: 'Проклятое', decoration: 'Декор', economy: 'Экономика', equipment: 'Снаряжение', food: 'Еда',
  'game-mechanics': 'Игровые механики', library: 'Библиотеки', magic: 'Магия', management: 'Управление', minigame: 'Мини-игры',
  mobs: 'Мобы', optimization: 'Оптимизация', social: 'Общение', storage: 'Хранение', technology: 'Технологии',
  transportation: 'Транспорт', utility: 'Утилиты', worldgen: 'Генерация мира', multiplayer: 'Мультиплеер', challenging: 'Сложное',
  combat: 'Бой', 'kitchen-sink': 'Всё и сразу', lightweight: 'Лёгкие', quests: 'Квесты', 'vanilla-like': 'Как ванилла',
  atmosphere: 'Атмосфера', bloom: 'Свечение', cartoon: 'Мультяшные', fantasy: 'Фэнтези', realistic: 'Реалистичные',
  'semi-realistic': 'Полуреалистичные', 'colored-lighting': 'Цветное освещение', foliage: 'Листва', 'path-tracing': 'Трассировка лучей',
  pbr: 'PBR', reflections: 'Отражения', shadows: 'Тени', potato: 'Для слабых ПК', low: 'Низкая нагрузка', medium: 'Средняя нагрузка',
  high: 'Высокая нагрузка', screenshot: 'Для скриншотов', audio: 'Звуки', blocks: 'Блоки', 'core-shaders': 'Core-шейдеры', entities: 'Сущности',
  environment: 'Окружение', equipment_rp: 'Снаряжение', fonts: 'Шрифты', gui: 'Интерфейс', items: 'Предметы', locale: 'Языки',
  models: 'Модели', simplistic: 'Минимализм', themed: 'Тематические', tweaks: 'Твики', modded: 'Для модов',
};

const SORTS = { relevance: 'relevance', downloads: 'downloads', follows: 'follows', newest: 'newest', updated: 'updated' };

function loaderSet(loader) {
  if (!loader || loader === 'vanilla') return null;
  return loader === 'quilt' ? ['quilt', 'fabric'] : [loader];
}

function normalizeProject(p) {
  return {
    provider: 'modrinth',
    id: p.project_id || p.id,
    slug: p.slug,
    title: p.title,
    description: p.description,
    author: p.author || null,
    iconUrl: p.icon_url || null,
    downloads: p.downloads || 0,
    updatedAt: p.date_modified || p.updated || null,
    categories: p.display_categories || p.categories || [],
    projectType: p.project_type,
    url: `https://modrinth.com/${p.project_type || 'project'}/${p.slug || p.project_id || p.id}`,
  };
}

function normalizeVersion(v) {
  return {
    provider: 'modrinth',
    projectId: v.project_id,
    id: v.id,
    name: v.name,
    versionNumber: v.version_number,
    gameVersions: v.game_versions || [],
    loaders: v.loaders || [],
    releaseType: v.version_type || 'release',
    date: v.date_published,
    files: (v.files || []).map((f) => ({ fileName: f.filename, url: f.url, sha1: f.hashes?.sha1, size: f.size, primary: Boolean(f.primary) })),
    dependencies: (v.dependencies || []).map((d) => ({ projectId: d.project_id, versionId: d.version_id, type: d.dependency_type })),
  };
}

class ModrinthProvider {
  constructor({ baseUrl = API } = {}) {
    this.id = 'modrinth';
    this.name = 'Modrinth';
    this.baseUrl = baseUrl;
  }

  available() { return true; }

  /** Категории для фильтра: [{ id, name, group }] */
  async getCategories(type = 'mod') {
    if (!this._categories) this._categories = await getJson(`${this.baseUrl}/tag/category`);
    return this._categories
      .filter((c) => c.project_type === type)
      .map((c) => ({ id: c.name, name: CATEGORY_RU[c.name] || c.name.replace(/-/g, ' ').replace(/^./, (x) => x.toUpperCase()), group: c.header }));
  }

  async search({ query = '', type = 'mod', mcVersion, loader, categories = [], offset = 0, limit = 20, sort = 'relevance' } = {}) {
    const facets = [[`project_type:${type}`]];
    for (const c of categories) facets.push([`categories:${c}`]);
    if (mcVersion) facets.push([`versions:${mcVersion}`]);
    const ls = (type === 'mod' || type === 'modpack') ? loaderSet(loader) : null;
    if (ls) facets.push(ls.map((l) => `categories:${l}`));
    const qs = new URLSearchParams({ query, facets: JSON.stringify(facets), offset: String(offset), limit: String(limit), index: SORTS[sort] || 'relevance' });
    const res = await getJson(`${this.baseUrl}/search?${qs}`);
    return { hits: res.hits.map(normalizeProject), total: res.total_hits, offset: res.offset, limit: res.limit };
  }

  async getProject(id) {
    const p = await getJson(`${this.baseUrl}/project/${encodeURIComponent(id)}`);
    return { ...normalizeProject(p), body: p.body, gallery: (p.gallery || []).map((g) => g.url) };
  }

  async getVersions(projectId, { mcVersion, loader, type } = {}) {
    const qs = new URLSearchParams();
    if (mcVersion) qs.set('game_versions', JSON.stringify([mcVersion]));
    const ls = (!type || type === 'mod') ? loaderSet(loader) : null;
    if (ls) qs.set('loaders', JSON.stringify(ls));
    const list = await getJson(`${this.baseUrl}/project/${encodeURIComponent(projectId)}/version?${qs}`);
    return list.map(normalizeVersion);
  }

  async getVersion(versionId) {
    return normalizeVersion(await getJson(`${this.baseUrl}/version/${encodeURIComponent(versionId)}`));
  }
}

module.exports = { ModrinthProvider, normalizeVersion, normalizeProject };
