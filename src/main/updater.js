'use strict';
// Простое самообновление лаунчера без сторонних библиотек.
// В launcher.config.json -> updates.url кладёшь ссылку на JSON вида:
// {
//   "version": "0.2.0",
//   "notes": "Что нового",
//   "page": "https://github.com/me/launcher/releases/latest",
//   "windows": { "url": "https://…/mc-launcher-kit-Setup-0.2.0.exe", "sha1": "…", "size": 123 },
//   "linux":   { "url": "https://…/mc-launcher-kit-0.2.0.AppImage" },
//   "mac":     { "url": "https://…/mc-launcher-kit-0.2.0.dmg" }
// }
// Лаунчер сравнивает версию с package.json и предлагает обновиться.
// На Windows (установленная версия) скачивает установщик и тихо ставит поверх, иначе открывает страницу загрузки.
const path = require('path');
const { spawn } = require('child_process');
const { getJson } = require('../core/util/http');

function compareSemver(a, b) {
  const pa = String(a).replace(/^v/, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = String(b).replace(/^v/, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

function platformKey() {
  if (process.platform === 'win32') return 'windows';
  if (process.platform === 'darwin') return 'mac';
  return 'linux';
}

class Updater {
  constructor({ config, currentVersion, core, app, shell }) {
    this.config = config;
    this.current = currentVersion;
    this.core = core;
    this.app = app;
    this.shell = shell;
    this.info = null;
  }

  get isPortable() { return Boolean(process.env.PORTABLE_EXECUTABLE_FILE); }

  async check() {
    const url = this.config.updates?.url;
    if (!url) return { available: false, current: this.current };
    const data = await getJson(url, { headers: { 'Cache-Control': 'no-cache' }, timeout: 10000 });
    const asset = data[platformKey()] || null;
    this.info = {
      available: Boolean(data.version) && compareSemver(data.version, this.current) > 0,
      current: this.current,
      latest: data.version,
      notes: data.notes || '',
      page: data.page || asset?.url || null,
      asset,
      // Автоустановка возможна только для установленной (не portable) версии под Windows
      canInstall: Boolean(asset?.url) && process.platform === 'win32' && !this.isPortable && this.app.isPackaged,
    };
    return this.info;
  }

  async install() {
    const info = this.info || await this.check();
    if (!info.available) return { ok: false, reason: 'Обновлений нет' };
    if (!info.canInstall) {
      if (info.page) await this.shell.openExternal(info.page);
      return { ok: true, opened: true };
    }
    const file = path.join(this.core.paths.cache, 'updates', path.basename(new URL(info.asset.url).pathname) || `setup-${info.latest}.exe`);
    await this.core.downloader.downloadAll(
      [{ url: info.asset.url, path: file, sha1: info.asset.sha1, size: info.asset.size }],
      undefined,
      { label: `Обновление лаунчера ${info.latest}` },
    );
    // /S — тихая установка поверх, --force-run — запустить лаунчер после установки (NSIS от electron-builder)
    spawn(file, ['/S', '--force-run'], { detached: true, stdio: 'ignore' }).unref();
    setTimeout(() => this.app.quit(), 800);
    return { ok: true, installing: true };
  }
}

module.exports = { Updater, compareSemver };
