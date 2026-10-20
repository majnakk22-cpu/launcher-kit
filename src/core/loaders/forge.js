'use strict';
// Forge и NeoForge: список версий + скачивание installer.jar и установка через forge-installer.js
const path = require('path');
const { getJson, getText } = require('../util/http');
const { installFromInstaller } = require('./forge-installer');

function compareVersions(a, b) {
  const pa = a.split(/[^0-9]+/).filter(Boolean).map(Number);
  const pb = b.split(/[^0-9]+/).filter(Boolean).map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

async function downloadInstaller(ctx, url, name) {
  const file = path.join(ctx.paths.cache, 'installers', name);
  await ctx.downloader.downloadAll([{ url, path: file }], undefined, { label: `Установщик ${name.replace(/-installer\.jar$/, '')}` });
  return file;
}

const forge = {
  id: 'forge',
  name: 'Forge',
  async listVersions(mc) {
    const xml = await getText('https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml');
    let promos = {};
    try { promos = (await getJson('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json')).promos || {}; } catch { /* не критично */ }
    const prefix = `${mc}-`;
    const all = [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map((m) => m[1]).filter((v) => v.startsWith(prefix));
    const rec = promos[`${mc}-recommended`];
    const latest = promos[`${mc}-latest`];
    return all
      .map((full) => {
        const version = full.slice(prefix.length);
        const short = version.split('-')[0];
        return { version, stable: true, recommended: short === rec, latest: short === latest };
      })
      .sort((a, b) => compareVersions(b.version, a.version));
  },
  async install(ctx, mc, version, { getJava, onProgress }) {
    const full = `${mc}-${version}`;
    const url = `https://maven.minecraftforge.net/net/minecraftforge/forge/${full}/forge-${full}-installer.jar`;
    onProgress?.('Загрузка установщика Forge');
    const installerPath = await downloadInstaller(ctx, url, `forge-${full}-installer.jar`);
    return installFromInstaller(ctx, { installerPath, getJava, onProgress });
  },
};

/**
 * Соответствие версии Minecraft -> префикс версии NeoForge.
 * 1.20.2 -> "20.2.", 1.21 -> "21.0.", 1.21.1 -> "21.1.".
 * Для новой "годовой" схемы Minecraft (26.1, 26.1.1 ...) NeoForge использует номер вида 26.1.0.x —
 * если схема у них изменится, поправь эту функцию.
 */
function neoforgePrefix(mc) {
  const p = mc.split('.');
  if (p[0] === '1') return `${p[1]}.${p[2] || 0}.`;
  return `${p[0]}.${p[1] || 0}.${p[2] || 0}.`;
}

const neoforge = {
  id: 'neoforge',
  name: 'NeoForge',
  // Для 1.20.1 NeoForge публиковался под старыми координатами net.neoforged:forge
  _artifact(mc) { return mc === '1.20.1' ? 'forge' : 'neoforge'; },
  async listVersions(mc) {
    const artifact = this._artifact(mc);
    const res = await getJson(`https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/${artifact}`);
    const prefix = artifact === 'forge' ? '1.20.1-' : neoforgePrefix(mc);
    return (res.versions || [])
      .filter((v) => v.startsWith(prefix))
      .map((v) => ({ version: v, stable: !/beta|alpha/i.test(v) }))
      .sort((a, b) => compareVersions(b.version, a.version));
  },
  async install(ctx, mc, version, { getJava, onProgress }) {
    const artifact = this._artifact(mc);
    const url = `https://maven.neoforged.net/releases/net/neoforged/${artifact}/${version}/${artifact}-${version}-installer.jar`;
    onProgress?.('Загрузка установщика NeoForge');
    const installerPath = await downloadInstaller(ctx, url, `neoforge-${version}-installer.jar`);
    return installFromInstaller(ctx, { installerPath, getJava, onProgress });
  },
};

module.exports = { forge, neoforge, compareVersions, neoforgePrefix };
