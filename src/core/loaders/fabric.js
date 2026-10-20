'use strict';
// Fabric и Quilt: version.json берётся готовым из их meta-API.
const { getJson } = require('../util/http');

function metaLoader({ id, name, listUrl, profileUrl, isStable }) {
  return {
    id,
    name,
    async listVersions(mc) {
      const list = await getJson(listUrl(mc));
      return list.map((e) => ({ version: e.loader.version, stable: isStable(e.loader) }));
    },
    async install(ctx, mc, loaderVersion) {
      const json = await getJson(profileUrl(mc, loaderVersion));
      await ctx.versions.saveVersionJson(json);
      return json.id;
    },
  };
}

const fabric = metaLoader({
  id: 'fabric',
  name: 'Fabric',
  listUrl: (mc) => `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(mc)}`,
  profileUrl: (mc, v) => `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(mc)}/${encodeURIComponent(v)}/profile/json`,
  isStable: (l) => l.stable !== false,
});

const quilt = metaLoader({
  id: 'quilt',
  name: 'Quilt',
  listUrl: (mc) => `https://meta.quiltmc.org/v3/versions/loader/${encodeURIComponent(mc)}`,
  profileUrl: (mc, v) => `https://meta.quiltmc.org/v3/versions/loader/${encodeURIComponent(mc)}/${encodeURIComponent(v)}/profile/json`,
  isStable: (l) => !/beta|alpha|pre|rc/i.test(l.version),
});

module.exports = { fabric, quilt };
