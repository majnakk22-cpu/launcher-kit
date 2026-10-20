'use strict';
// IPC: всё, что интерфейс может попросить у ядра. Каждый обработчик возвращает {ok, data} или {ok:false, error},
// чтобы в интерфейс приходили понятные сообщения об ошибках.
const os = require('os');
const fs = require('fs');
const { ipcMain, shell, dialog, clipboard } = require('electron');
const { pingServer } = require('../core/util/server-ping');
const { getJson } = require('../core/util/http');

function registerIpc({ core, config, getWindow, send, forceClose, updater }) {
  const handle = (channel, fn) => {
    ipcMain.handle(channel, async (_e, ...args) => {
      try {
        return { ok: true, data: await fn(...args) };
      } catch (e) {
        core.log('error', `${channel}: ${e.stack || e.message}`);
        return { ok: false, error: e.message || String(e) };
      }
    });
  };

  // ---------- Приложение и окно ----------
  handle('app:info', async () => ({
    config,
    version: config.version,
    dataDir: core.paths.root,
    totalMemoryMb: Math.floor(os.totalmem() / 1024 / 1024),
    platform: process.platform,
    versions: { electron: process.versions.electron, node: process.versions.node },
  }));
  handle('app:openPath', async (p) => {
    const err = await shell.openPath(p);
    if (err) throw new Error(err);
  });
  handle('app:openExternal', async (url) => {
    if (!/^https?:\/\//.test(url)) throw new Error('Разрешены только http(s) ссылки');
    await shell.openExternal(url);
  });
  handle('app:pickFiles', async (opts = {}) => {
    const r = await dialog.showOpenDialog(getWindow(), {
      properties: opts.multiple ? ['openFile', 'multiSelections'] : ['openFile'],
      filters: opts.filters || [],
    });
    return r.canceled ? [] : r.filePaths;
  });
  handle('app:news', async () => (config.news?.url ? getJson(config.news.url) : []));
  handle('app:ping', async (address, port) => pingServer(address, port || 25565));
  handle('app:diskFree', async () => {
    const st = await fs.promises.statfs(core.paths.root);
    return { free: st.bavail * st.bsize, total: st.blocks * st.bsize };
  });
  handle('app:checkUpdate', async () => updater.check());
  handle('app:installUpdate', async () => updater.install());

  ipcMain.on('window:minimize', () => getWindow()?.minimize());
  ipcMain.on('window:maximize', () => { const w = getWindow(); if (w) (w.isMaximized() ? w.unmaximize() : w.maximize()); });
  ipcMain.on('window:close', () => forceClose());

  // ---------- Настройки ----------
  handle('settings:get', async () => core.settings.get());
  handle('settings:set', async (patch) => core.settings.set(patch));
  handle('java:detect', async () => core.java.detectSystemJavas());

  // ---------- Версии и модлоадеры ----------
  handle('versions:minecraft', async (opts) => core.versions.listMinecraftVersions(opts));
  handle('loaders:list', async () => core.loaders.list());
  handle('loaders:versions', async (type, mc) => core.loaders.listVersions(type, mc));

  // ---------- Сборки ----------
  handle('instances:list', async () => core.instances.list());
  handle('instances:get', async (id) => core.instances.get(id));
  handle('instances:create', async (data) => {
    if (config.features?.customInstances === false) throw new Error('Создание своих сборок отключено');
    return core.instances.create(data);
  });
  handle('instances:update', async (id, patch) => core.instances.update(id, patch));
  handle('instances:remove', async (id) => {
    if (core.launcher.running.has(id)) throw new Error('Сборка запущена — сначала закрой игру');
    return core.instances.remove(id);
  });
  handle('instances:openFolder', async (id) => shell.openPath(core.paths.gameDir(id)));
  handle('instances:fromManifest', async (url) => core.sync.createFromManifest(url));
  handle('instances:sync', async (id) => core.sync.sync(id, (p) => send('core:progress', { instanceId: id, text: 'Синхронизация', ...p })));
  handle('instances:checkUpdate', async (id) => core.sync.checkUpdate(id));
  handle('instances:prepare', async (id) => { await core.launcher.prepare(id); return true; });

  // ---------- Аккаунты ----------
  let msFlow = null;
  handle('accounts:list', async () => core.accounts.list());
  handle('accounts:addOffline', async (name) => {
    if (config.features?.offlineAccounts === false) throw new Error('Офлайн-аккаунты отключены');
    return core.accounts.addOffline(name);
  });
  handle('accounts:remove', async (id) => core.accounts.remove(id));
  handle('accounts:setActive', async (id) => core.accounts.setActive(id));
  handle('accounts:msStart', async () => {
    msFlow?.cancel();
    const flow = await core.accounts.startMicrosoftLogin();
    msFlow = flow;
    clipboard.writeText(flow.userCode);
    flow.wait()
      .then((account) => send('auth:ms-result', { ok: true, account }))
      .catch((e) => send('auth:ms-result', { ok: false, error: e.message }))
      .finally(() => { if (msFlow === flow) msFlow = null; });
    shell.openExternal(flow.verificationUri);
    return { userCode: flow.userCode, verificationUri: flow.verificationUri, expiresIn: flow.expiresIn };
  });
  handle('accounts:msCancel', async () => { msFlow?.cancel(); msFlow = null; });

  // ---------- Игра ----------
  handle('game:launch', async (id, opts) => core.launcher.launch(id, opts || {}));
  handle('game:kill', async (id) => core.launcher.kill(id));
  handle('game:running', async () => [...core.launcher.running.keys()]);

  // ---------- Конфиги по умолчанию ----------
  handle('defaults:get', async () => core.defaults.get());
  handle('defaults:schema', async () => core.defaults.schema());
  handle('defaults:set', async (patch) => core.defaults.set(patch));
  handle('defaults:addFiles', async (files, subdir) => core.defaults.addFiles(files, subdir));
  handle('defaults:removeFile', async (rel) => core.defaults.removeFile(rel));
  handle('defaults:openFolder', async () => {
    await fs.promises.mkdir(core.defaults.filesDir, { recursive: true });
    return shell.openPath(core.defaults.filesDir);
  });
  handle('defaults:applyTo', async (instanceId) => core.defaults.applyTo(instanceId, { mode: 'override' }));
  handle('defaults:applyToAll', async () => core.defaults.applyToAll());
  handle('defaults:importFrom', async (instanceId, opts) => core.defaults.importFromInstance(instanceId, opts));

  // ---------- Менеджер загрузок ----------
  handle('downloads:snapshot', async () => core.downloader.snapshot());
  handle('downloads:cancel', async (jobId) => core.downloader.cancel(jobId));
  handle('downloads:cancelAll', async () => core.downloader.cancelAll());
  handle('downloads:pause', async () => core.downloader.pause());
  handle('downloads:resume', async () => core.downloader.resume());
  handle('downloads:clear', async () => core.downloader.clearFinished());

  // ---------- Каталог (Modrinth / CurseForge) ----------
  handle('content:providers', async () => core.content.list());
  handle('content:search', async (provider, params) => core.content.search(provider, params));
  handle('content:categories', async (provider, type) => core.content.categories(provider, type));
  handle('content:versions', async (provider, projectId, params) => core.content.getVersions(provider, projectId, params));
  handle('content:install', async (instanceId, req) => core.content.install(instanceId, req, (p) => send('core:progress', { instanceId, ...p })));
  handle('content:remove', async (instanceId, provider, projectId) => core.content.remove(instanceId, provider, projectId));
  handle('content:checkUpdates', async (instanceId) => core.content.checkUpdates(instanceId));
  handle('content:update', async (instanceId, provider, projectId) => core.content.update(instanceId, provider, projectId));
  handle('content:listLocal', async (instanceId, folder) => core.content.listLocal(instanceId, folder));
  handle('content:setEnabled', async (instanceId, rel, enabled) => core.content.setEnabled(instanceId, rel, enabled));
  handle('content:removeLocal', async (instanceId, rel) => core.content.removeLocal(instanceId, rel));
  handle('content:addLocal', async (instanceId, files, folder) => core.content.addLocalFiles(instanceId, files, folder));

  // ---------- Модпаки ----------
  const packProgress = (p) => send('core:progress', { instanceId: null, ...p });
  handle('modpacks:install', async (req) => core.modpacks.installFromCatalog(req, packProgress));
  handle('modpacks:importFile', async (file) => core.modpacks.importFile(file, { onProgress: packProgress }));
  handle('modpacks:update', async (instanceId) => core.modpacks.update(instanceId, packProgress));
}

module.exports = { registerIpc };
