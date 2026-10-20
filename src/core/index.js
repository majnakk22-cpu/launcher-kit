'use strict';
// Точка входа ядра. Ядро не зависит от Electron — его можно использовать из CLI, тестов или другого UI.
//
//   const core = await createLauncherCore({ dataDir, config });
//   core.on('progress', ...); core.on('game-log', ...);
//   await core.launcher.launch('my-instance');
const { EventEmitter } = require('events');
const { LauncherPaths } = require('./paths');
const { Downloader } = require('./downloader');
const { SettingsStore } = require('./settings');
const { VersionService } = require('./minecraft/versions');
const { AssetService } = require('./minecraft/assets');
const { JavaService } = require('./java/runtime');
const { LoaderService } = require('./loaders');
const { InstanceManager } = require('./instances/instances');
const { SyncService } = require('./instances/sync');
const { AccountStore } = require('./auth/accounts');
const { ContentService } = require('./content');
const { ModrinthProvider } = require('./content/modrinth');
const { CurseForgeProvider } = require('./content/curseforge');
const { ModpackService } = require('./content/modpacks');
const { DefaultsService } = require('./defaults/defaults');
const { GameLauncher } = require('./launch/launcher');
const { ensureDir } = require('./util/fs');
const http = require('./util/http');

/**
 * options:
 *   dataDir   — папка данных лаунчера
 *   config    — содержимое launcher.config.json
 *   encrypt/decrypt — функции шифрования токенов (опционально)
 */
async function createLauncherCore({ dataDir, config = {}, encrypt, decrypt } = {}) {
  const events = new EventEmitter();
  events.setMaxListeners(50);
  const paths = new LauncherPaths(dataDir);
  await ensureDir(paths.root);

  http.setMirrors(config.mirrors);
  http.setUserAgent(config.userAgent || `${config.id || 'mc-launcher-kit'}/${config.version || '0.1.0'}`);

  const ctx = {
    config,
    paths,
    events,
    on: (e, fn) => { events.on(e, fn); return () => events.off(e, fn); },
    emit: (e, data) => events.emit(e, data),
    log: (level, message) => events.emit('log', { level, message, time: Date.now() }),
  };

  ctx.settings = new SettingsStore(ctx);
  await ctx.settings.load();
  ctx.downloader = new Downloader({
    concurrency: ctx.settings.get().downloadThreads || 8,
    log: ctx.log,
    onChange: (snapshot) => ctx.emit('downloads', snapshot),
  });
  ctx.on('settings-changed', (s) => { ctx.downloader.concurrency = s.downloadThreads || 8; ctx.downloader._pump(); });

  ctx.versions = new VersionService(ctx);
  ctx.assets = new AssetService(ctx);
  ctx.java = new JavaService(ctx);
  ctx.loaders = new LoaderService(ctx);
  ctx.instances = new InstanceManager(ctx);
  ctx.defaults = new DefaultsService(ctx);
  ctx.sync = new SyncService(ctx);
  ctx.accounts = new AccountStore(ctx, { encrypt, decrypt, microsoftClientId: config.microsoft?.clientId });

  const providers = [];
  if (config.content?.modrinth !== false) providers.push(new ModrinthProvider({ baseUrl: config.content?.modrinthApi }));
  if (config.content?.curseforge !== false) {
    providers.push(new CurseForgeProvider({
      getApiKey: () => ctx.settings.get().curseforgeApiKey || config.curseforge?.apiKey || '',
      baseUrl: config.content?.curseforgeApi,
    }));
  }
  ctx.content = new ContentService(ctx, providers);
  ctx.modpacks = new ModpackService(ctx);
  ctx.launcher = new GameLauncher(ctx);

  /** Пресеты из конфига: сборки, которые лаунчер создаёт сам (например, твой сервер). */
  ctx.applyPresets = async () => {
    for (const p of config.presets || []) {
      try {
        if (await ctx.instances.has(p.id)) continue;
        if (p.manifestUrl) await ctx.sync.createFromManifest(p.manifestUrl, { id: p.id });
        else await ctx.instances.create(p);
      } catch (e) {
        ctx.log('warn', `Пресет ${p.id}: ${e.message}`);
      }
    }
  };

  return ctx;
}

module.exports = { createLauncherCore };
