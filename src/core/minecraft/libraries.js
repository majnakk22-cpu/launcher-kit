'use strict';
// Разбор библиотек version.json: что скачать, что положить в classpath, какие нативы распаковать.
const path = require('path');
const { isAllowed } = require('./rules');
const { mavenPath } = require('../util/maven');
const platform = require('../util/platform');

const DEFAULT_REPO = 'https://libraries.minecraft.net/';

/** Старые адреса maven-репозиториев, которые давно переехали. */
function fixRepoUrl(url) {
  if (!url) return DEFAULT_REPO;
  let u = url.replace(/^http:\/\/files\.minecraftforge\.net\/maven\/?/, 'https://maven.minecraftforge.net/');
  u = u.replace(/^http:\/\//, 'https://');
  return u.endsWith('/') ? u : `${u}/`;
}

/**
 * Возвращает { classpath: string[], downloads: Item[], natives: [{path, exclude}], missingGenerated: string[] }
 * Item — элемент для Downloader. Библиотеки с пустым url генерируются установщиком (Forge) и не качаются.
 */
function collectLibraries(version, paths, { features = {}, env = {} } = {}) {
  const osName = env.osName || platform.mcOsName();
  const bits = env.archBits || platform.archBits();
  const classpath = [];
  const downloads = [];
  const natives = [];
  const generated = [];

  const addArtifact = (art, name, repoUrl, toClasspath, nativeExclude) => {
    const rel = art?.path || mavenPath(name);
    const abs = paths.library(rel);
    if (art) {
      if (art.url) downloads.push({ url: art.url, path: abs, sha1: art.sha1, size: art.size });
      else generated.push(abs);
    } else {
      downloads.push({ url: fixRepoUrl(repoUrl) + mavenPath(name), path: abs, sha1: undefined, size: undefined });
    }
    if (toClasspath) classpath.push(abs);
    if (nativeExclude) natives.push({ path: abs, exclude: nativeExclude });
  };

  for (const lib of version.libraries || []) {
    if (!lib || !lib.name) continue;
    if (!isAllowed(lib.rules, features, env)) continue;

    if (lib.natives) {
      const clsTpl = lib.natives[osName];
      if (clsTpl) {
        const classifier = clsTpl.replace('${arch}', bits);
        const art = lib.downloads?.classifiers?.[classifier];
        addArtifact(art, `${lib.name}:${classifier}`, lib.url, false, lib.extract?.exclude || ['META-INF/']);
      }
      if (lib.downloads?.artifact) addArtifact(lib.downloads.artifact, lib.name, lib.url, true);
      continue;
    }

    if (lib.downloads?.artifact) {
      addArtifact(lib.downloads.artifact, lib.name, lib.url, true);
    } else if (lib.downloads && !lib.downloads.artifact) {
      // есть только classifiers без natives — ничего не кладём
      continue;
    } else {
      // maven-стиль (Fabric, старый Forge): name + url репозитория (+ возможно sha1/size)
      const item = { url: fixRepoUrl(lib.url) + mavenPath(lib.name), path: paths.library(mavenPath(lib.name)), sha1: lib.sha1, size: lib.size };
      downloads.push(item);
      classpath.push(item.path);
    }
  }

  return {
    classpath: [...new Set(classpath)],
    downloads,
    natives,
    generated: [...new Set(generated)],
  };
}

module.exports = { collectLibraries, fixRepoUrl, DEFAULT_REPO };
