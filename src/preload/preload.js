'use strict';
// Безопасный мост: интерфейс видит только window.launcher, без доступа к Node.js.
const { contextBridge, ipcRenderer } = require('electron');

async function invoke(channel, ...args) {
  const r = await ipcRenderer.invoke(channel, ...args);
  if (!r || !r.ok) throw new Error(r?.error || 'Неизвестная ошибка');
  return r.data;
}

const EVENTS = ['core:defaults-changed', 'core:downloads', 'core:progress', 'core:log', 'core:game-log', 'core:game-start', 'core:game-exit', 'core:instances-changed', 'core:settings-changed', 'auth:ms-result', 'window:state', 'window:close-request'];

contextBridge.exposeInMainWorld('launcher', {
  app: {
    info: () => invoke('app:info'),
    openPath: (p) => invoke('app:openPath', p),
    openExternal: (url) => invoke('app:openExternal', url),
    pickFiles: (opts) => invoke('app:pickFiles', opts),
    news: () => invoke('app:news'),
    ping: (address, port) => invoke('app:ping', address, port),
    diskFree: () => invoke('app:diskFree'),
    checkUpdate: () => invoke('app:checkUpdate'),
    installUpdate: () => invoke('app:installUpdate'),
  },
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
    ackClose: () => ipcRenderer.send('window:close-ack'),
  },
  settings: {
    get: () => invoke('settings:get'),
    set: (patch) => invoke('settings:set', patch),
    detectJava: () => invoke('java:detect'),
  },
  versions: {
    minecraft: (opts) => invoke('versions:minecraft', opts),
    loaders: () => invoke('loaders:list'),
    loaderVersions: (type, mc) => invoke('loaders:versions', type, mc),
  },
  instances: {
    list: () => invoke('instances:list'),
    get: (id) => invoke('instances:get', id),
    create: (data) => invoke('instances:create', data),
    update: (id, patch) => invoke('instances:update', id, patch),
    remove: (id) => invoke('instances:remove', id),
    openFolder: (id) => invoke('instances:openFolder', id),
    fromManifest: (url) => invoke('instances:fromManifest', url),
    sync: (id) => invoke('instances:sync', id),
    checkUpdate: (id) => invoke('instances:checkUpdate', id),
    prepare: (id) => invoke('instances:prepare', id),
  },
  accounts: {
    list: () => invoke('accounts:list'),
    addOffline: (name) => invoke('accounts:addOffline', name),
    remove: (id) => invoke('accounts:remove', id),
    setActive: (id) => invoke('accounts:setActive', id),
    msStart: () => invoke('accounts:msStart'),
    msCancel: () => invoke('accounts:msCancel'),
  },
  game: {
    launch: (id, opts) => invoke('game:launch', id, opts),
    kill: (id) => invoke('game:kill', id),
    running: () => invoke('game:running'),
  },
  content: {
    providers: () => invoke('content:providers'),
    search: (provider, params) => invoke('content:search', provider, params),
    categories: (provider, type) => invoke('content:categories', provider, type),
    versions: (provider, projectId, params) => invoke('content:versions', provider, projectId, params),
    install: (instanceId, req) => invoke('content:install', instanceId, req),
    remove: (instanceId, provider, projectId) => invoke('content:remove', instanceId, provider, projectId),
    checkUpdates: (instanceId) => invoke('content:checkUpdates', instanceId),
    update: (instanceId, provider, projectId) => invoke('content:update', instanceId, provider, projectId),
    listLocal: (instanceId, folder) => invoke('content:listLocal', instanceId, folder),
    setEnabled: (instanceId, rel, enabled) => invoke('content:setEnabled', instanceId, rel, enabled),
    removeLocal: (instanceId, rel) => invoke('content:removeLocal', instanceId, rel),
    addLocal: (instanceId, files, folder) => invoke('content:addLocal', instanceId, files, folder),
  },
  defaults: {
    get: () => invoke('defaults:get'),
    schema: () => invoke('defaults:schema'),
    set: (patch) => invoke('defaults:set', patch),
    addFiles: (files, subdir) => invoke('defaults:addFiles', files, subdir),
    removeFile: (rel) => invoke('defaults:removeFile', rel),
    openFolder: () => invoke('defaults:openFolder'),
    applyTo: (instanceId) => invoke('defaults:applyTo', instanceId),
    applyToAll: () => invoke('defaults:applyToAll'),
    importFrom: (instanceId, opts) => invoke('defaults:importFrom', instanceId, opts),
  },
  downloads: {
    snapshot: () => invoke('downloads:snapshot'),
    cancel: (jobId) => invoke('downloads:cancel', jobId),
    cancelAll: () => invoke('downloads:cancelAll'),
    pause: () => invoke('downloads:pause'),
    resume: () => invoke('downloads:resume'),
    clear: () => invoke('downloads:clear'),
  },
  modpacks: {
    install: (req) => invoke('modpacks:install', req),
    importFile: (file) => invoke('modpacks:importFile', file),
    update: (instanceId) => invoke('modpacks:update', instanceId),
  },
  /** Подписка на события. Возвращает функцию отписки. */
  on(event, cb) {
    const ch = EVENTS.find((e) => e === event || e === `core:${event}`);
    if (!ch) throw new Error(`Неизвестное событие ${event}`);
    const fn = (_e, data) => cb(data);
    ipcRenderer.on(ch, fn);
    return () => ipcRenderer.removeListener(ch, fn);
  },
});
