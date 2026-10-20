'use strict';
// Ассеты (звуки, языки, текстуры ресурс-пака по умолчанию).
const path = require('path');
const { readJson, copyIfChanged, safeJoin } = require('../util/fs');

const RESOURCES_URL = 'https://resources.download.minecraft.net/';

class AssetService {
  constructor(ctx) { this.ctx = ctx; }

  /** Скачивает индекс ассетов и возвращает { indexId, index, items } — items ещё нужно скачать. */
  async prepare(version) {
    const ai = version.assetIndex;
    if (!ai) return { indexId: version.assets || 'legacy', index: { objects: {} }, items: [] };
    const indexPath = this.ctx.paths.assetIndex(ai.id);
    await this.ctx.downloader.downloadAll([{ url: ai.url, path: indexPath, sha1: ai.sha1 }], undefined, { label: `Индекс ассетов ${ai.id}` });
    const index = await readJson(indexPath);
    const items = Object.values(index.objects || {}).map((o) => ({
      url: `${RESOURCES_URL}${o.hash.slice(0, 2)}/${o.hash}`,
      path: this.ctx.paths.assetObject(o.hash),
      sha1: o.hash,
      size: o.size,
      verify: 'size',
    }));
    return { indexId: ai.id, index, items };
  }

  /**
   * Для очень старых версий: копирование ассетов в "виртуальную" папку или в gameDir/resources.
   * Возвращает путь для плейсхолдера ${game_assets}.
   */
  async finalize({ indexId, index }, gameDir) {
    const objects = Object.entries(index.objects || {});
    let gameAssets = this.ctx.paths.assets;
    if (index.virtual) {
      gameAssets = path.join(this.ctx.paths.assets, 'virtual', indexId);
      for (const [name, o] of objects) await copyIfChanged(this.ctx.paths.assetObject(o.hash), safeJoin(gameAssets, name));
    }
    if (index.map_to_resources) {
      const res = path.join(gameDir, 'resources');
      for (const [name, o] of objects) await copyIfChanged(this.ctx.paths.assetObject(o.hash), safeJoin(res, name));
    }
    return gameAssets;
  }
}

module.exports = { AssetService, RESOURCES_URL };
