'use strict';
// Java: автоматическая установка официальных рантаймов Mojang + поиск системной Java.
const path = require('path');
const { spawn } = require('child_process');
const { fsp, ensureDir, exists, readJson, writeJson } = require('../util/fs');
const { getJson } = require('../util/http');
const platform = require('../util/platform');

const ALL_JSON = 'https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json';

function javaBinary(home, { gui = false } = {}) {
  if (process.platform === 'win32') return path.join(home, 'bin', gui ? 'javaw.exe' : 'java.exe');
  return path.join(home, 'bin', 'java');
}

/** Запускает `java -version` и возвращает { version, major } или null. */
function probeJava(exe) {
  return new Promise((resolve) => {
    let out = '';
    let p;
    try { p = spawn(exe, ['-version'], { windowsHide: true }); } catch { resolve(null); return; }
    const timer = setTimeout(() => { p.kill(); resolve(null); }, 10000);
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    p.on('error', () => { clearTimeout(timer); resolve(null); });
    p.on('close', () => {
      clearTimeout(timer);
      const m = out.match(/version "([^"]+)"/);
      if (!m) { resolve(null); return; }
      const v = m[1];
      const parts = v.split(/[._-]/).map((x) => parseInt(x, 10));
      const major = parts[0] === 1 ? parts[1] : parts[0];
      resolve({ version: v, major, is64: /64-Bit/i.test(out) });
    });
  });
}

class JavaService {
  constructor(ctx) { this.ctx = ctx; }

  requirementFor(version) {
    return {
      component: version.javaVersion?.component || 'jre-legacy',
      major: version.javaVersion?.majorVersion || 8,
    };
  }

  runtimeHome(component) {
    const dir = path.join(this.ctx.paths.runtime, component, platform.javaRuntimePlatform());
    // На macOS рантайм Mojang лежит внутри jre.bundle
    return process.platform === 'darwin' ? path.join(dir, 'jre.bundle', 'Contents', 'Home') : dir;
  }

  /** Устанавливает (если нужно) рантайм Mojang и возвращает путь к java. */
  async ensureRuntime(component, onProgress = () => {}) {
    const plat = platform.javaRuntimePlatform();
    const dir = path.join(this.ctx.paths.runtime, component, plat);
    const marker = path.join(dir, '.installed.json');
    const home = this.runtimeHome(component);
    const exe = javaBinary(home);
    if (await exists(marker) && await exists(exe)) return exe;

    this.ctx.log('info', `Скачиваю Java (${component}, ${plat})`);
    const all = await getJson(ALL_JSON);
    const entry = all?.[plat]?.[component]?.[0];
    if (!entry) throw new Error(`Mojang не предоставляет Java "${component}" для ${plat}. Укажи путь к Java вручную в настройках.`);
    const manifest = await getJson(entry.manifest.url);

    const items = [];
    const executables = [];
    const links = [];
    for (const [rel, f] of Object.entries(manifest.files)) {
      const abs = path.join(dir, ...rel.split('/'));
      if (f.type === 'directory') await ensureDir(abs);
      else if (f.type === 'link') links.push({ abs, target: f.target });
      else if (f.type === 'file' && f.downloads?.raw) {
        items.push({ url: f.downloads.raw.url, path: abs, sha1: f.downloads.raw.sha1, size: f.downloads.raw.size });
        if (f.executable) executables.push(abs);
      }
    }
    await this.ctx.downloader.downloadAll(items, onProgress, { label: `Java (${component})` });
    if (process.platform !== 'win32') {
      for (const e of executables) await fsp.chmod(e, 0o755).catch(() => {});
      for (const l of links) {
        await fsp.rm(l.abs, { force: true });
        await ensureDir(path.dirname(l.abs));
        await fsp.symlink(l.target, l.abs).catch(() => {});
      }
    }
    await writeJson(marker, { component, platform: plat, version: entry.version?.name, manifestSha1: entry.manifest.sha1 });
    return exe;
  }

  /**
   * Выбор Java для версии: явный путь (настройки/сборка) > рантайм Mojang.
   * gui=true на Windows вернёт javaw.exe (без консольного окна).
   */
  async resolveJava(version, { customPath = null, onProgress } = {}) {
    if (customPath) {
      if (!(await exists(customPath))) throw new Error(`Java не найдена по пути ${customPath}`);
      return customPath;
    }
    const { component } = this.requirementFor(version);
    return this.ensureRuntime(component, onProgress);
  }

  /** Ищет установленные в системе Java (для экрана настроек). */
  async detectSystemJavas() {
    const candidates = new Set();
    if (process.env.JAVA_HOME) candidates.add(javaBinary(process.env.JAVA_HOME));
    const roots = process.platform === 'win32'
      ? ['C:\\Program Files\\Java', 'C:\\Program Files\\Eclipse Adoptium', 'C:\\Program Files\\Zulu', 'C:\\Program Files\\Microsoft', 'C:\\Program Files\\BellSoft', 'C:\\Program Files (x86)\\Java']
      : process.platform === 'darwin' ? ['/Library/Java/JavaVirtualMachines'] : ['/usr/lib/jvm', '/usr/java', '/opt/java'];
    for (const r of roots) {
      let dirs = [];
      try { dirs = await fsp.readdir(r); } catch { continue; }
      for (const d of dirs) {
        const home = process.platform === 'darwin' ? path.join(r, d, 'Contents', 'Home') : path.join(r, d);
        candidates.add(javaBinary(home));
      }
    }
    // Рантаймы, уже скачанные лаунчером
    try {
      for (const comp of await fsp.readdir(this.ctx.paths.runtime)) candidates.add(javaBinary(this.runtimeHome(comp)));
    } catch { /* нет */ }
    candidates.add(process.platform === 'win32' ? 'java.exe' : 'java'); // из PATH

    const out = [];
    for (const exe of candidates) {
      if (exe.includes(path.sep) && !(await exists(exe))) continue;
      const info = await probeJava(exe);
      if (info) out.push({ path: exe, ...info });
    }
    return out;
  }
}

module.exports = { JavaService, probeJava, javaBinary, ALL_JSON };
