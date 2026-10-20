'use strict';
// Установка Forge / NeoForge из официального installer.jar без GUI:
// читаем install_profile.json, качаем библиотеки и сами выполняем "processors"
// (так делают Prism/HMCL). Поддерживаются старый (versionInfo) и новый (spec 0/1) форматы.
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { fsp, ensureDir, exists, sha1File } = require('../util/fs');
const { withZip, readManifestAttribute } = require('../util/zip');
const { mavenPath } = require('../util/maven');
const { collectLibraries, fixRepoUrl } = require('../minecraft/libraries');
const platform = require('../util/platform');

/** "[group:artifact:ver]" -> путь к библиотеке; "'literal'" -> literal; "{KEY}" -> data[KEY]. */
function resolveToken(token, data, libPath) {
  if (typeof token !== 'string') return token;
  if (/^\[.+\]$/.test(token)) return libPath(token.slice(1, -1));
  if (/^'.*'$/.test(token)) return token.slice(1, -1);
  const whole = token.match(/^\{([A-Z0-9_]+)\}$/);
  if (whole) {
    if (!(whole[1] in data)) throw new Error(`Forge installer: неизвестная переменная {${whole[1]}}`);
    return data[whole[1]];
  }
  return token.replace(/\{([A-Z0-9_]+)\}/g, (m, k) => (k in data ? data[k] : m));
}

function runJava(java, args, { cwd, log }) {
  return new Promise((resolve, reject) => {
    const p = spawn(java, args, { cwd, windowsHide: true });
    let tail = '';
    const onData = (d) => {
      const s = d.toString();
      tail = (tail + s).slice(-4000);
      for (const line of s.split(/\r?\n/)) if (line.trim()) log('debug', `[installer] ${line}`);
    };
    p.stdout.on('data', onData);
    p.stderr.on('data', onData);
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`Процессор завершился с кодом ${code}\n${tail}`))));
  });
}

/**
 * ctx: ядро (paths, downloader, versions, log)
 * opts: { installerPath, javaPath, onProgress(phaseText, progress) }
 * Возвращает id установленной версии.
 */
async function installFromInstaller(ctx, { installerPath, getJava, onProgress = () => {} }) {
  const { paths } = ctx;
  const libPath = (coord) => paths.library(mavenPath(coord));

  return withZip(installerPath, async (zip) => {
    const profile = await zip.readJson('install_profile.json');

    // ---------- Старый формат (Forge до ~1.12.2) ----------
    if (profile.versionInfo) {
      const vi = profile.versionInfo;
      const inst = profile.install;
      await zip.extractTo(inst.filePath, libPath(inst.path));
      vi.inheritsFrom = vi.inheritsFrom || inst.minecraft;
      for (const lib of vi.libraries || []) {
        if (lib.url) lib.url = fixRepoUrl(lib.url);
        delete lib.checksums;
      }
      await ctx.versions.saveVersionJson(vi);
      return vi.id;
    }

    // ---------- Новый формат ----------
    const versionJson = await zip.readJson(String(profile.json || '/version.json').replace(/^\//, ''));
    const mc = profile.minecraft;
    onProgress('Распаковка файлов установщика');
    await zip.extractPrefix('maven/', paths.libraries);

    // Ванильный клиент нужен процессорам (патчинг)
    const vanilla = await ctx.versions.ensureVersionJson(mc);
    const clientJar = paths.versionJar(mc);
    if (vanilla.downloads?.client) {
      await ctx.downloader.downloadAll([{ url: vanilla.downloads.client.url, path: clientJar, sha1: vanilla.downloads.client.sha1, size: vanilla.downloads.client.size }], undefined, { label: `Minecraft ${mc}` });
    }

    // Библиотеки установщика и самой версии
    const libs = [
      ...collectLibraries({ libraries: profile.libraries || [] }, paths).downloads,
      ...collectLibraries(versionJson, paths).downloads,
    ];
    onProgress('Загрузка библиотек модлоадера');
    await ctx.downloader.downloadAll(libs, (p) => onProgress('Загрузка библиотек модлоадера', p), { label: `Библиотеки ${versionJson.id}` });

    // Переменные data
    const tmpDir = path.join(paths.cache, 'installer-data', crypto.createHash('sha1').update(installerPath).digest('hex').slice(0, 12));
    await ensureDir(tmpDir);
    const data = {
      SIDE: 'client',
      MINECRAFT_JAR: clientJar,
      MINECRAFT_VERSION: mc,
      ROOT: paths.root,
      INSTALLER: installerPath,
      LIBRARY_DIR: paths.libraries,
    };
    for (const [key, v] of Object.entries(profile.data || {})) {
      const val = v?.client;
      if (val == null) continue;
      if (/^\[.+\]$/.test(val)) data[key] = libPath(val.slice(1, -1));
      else if (/^'.*'$/.test(val)) data[key] = val.slice(1, -1);
      else if (val.startsWith('/')) {
        const dest = path.join(tmpDir, ...val.slice(1).split('/'));
        await zip.extractTo(val.slice(1), dest);
        data[key] = dest;
      } else data[key] = val;
    }

    // Процессоры
    const procs = (profile.processors || []).filter((p) => !p.sides || p.sides.includes('client'));
    if (procs.length) {
      const java = await getJava(vanilla);
      let i = 0;
      for (const proc of procs) {
        i++;
        onProgress(`Обработка Forge (${i}/${procs.length})`, { done: i - 1, total: procs.length });
        const outputs = Object.entries(proc.outputs || {}).map(([k, v]) => [resolveToken(k, data, libPath), resolveToken(v, data, libPath)]);
        if (outputs.length) {
          let ok = true;
          for (const [file, sha] of outputs) {
            if (!(await exists(file)) || (await sha1File(file)) !== String(sha).toLowerCase()) { ok = false; break; }
          }
          if (ok) continue; // уже сделано ранее
        }
        const jar = libPath(proc.jar);
        const mainClass = await readManifestAttribute(jar, 'Main-Class');
        if (!mainClass) throw new Error(`У процессора ${proc.jar} нет Main-Class`);
        const cp = [jar, ...(proc.classpath || []).map(libPath)].join(platform.classpathSeparator);
        const args = (proc.args || []).map((a) => resolveToken(a, data, libPath));
        ctx.log('info', `Процессор ${proc.jar}`);
        await runJava(java, ['-cp', cp, mainClass, ...args], { cwd: paths.root, log: ctx.log });
        for (const [file, sha] of outputs) {
          if (!(await exists(file))) throw new Error(`Процессор не создал файл ${file}`);
          const actual = await sha1File(file);
          if (actual !== String(sha).toLowerCase()) throw new Error(`Неверный sha1 у ${path.basename(file)}: ${actual} != ${sha}`);
        }
      }
    }
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});

    await ctx.versions.saveVersionJson(versionJson);
    return versionJson.id;
  });
}

module.exports = { installFromInstaller, resolveToken };
