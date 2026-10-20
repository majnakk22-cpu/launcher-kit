'use strict';
// Подготовка и запуск игры: модлоадер -> version.json -> Java -> файлы -> нативы -> аргументы -> процесс.
const path = require('path');
const { spawn } = require('child_process');
const { fsp, ensureDir, exists, copyIfChanged } = require('../util/fs');
const { withZip } = require('../util/zip');
const { collectLibraries } = require('../minecraft/libraries');
const { buildLaunchArguments, supportsQuickPlay } = require('../minecraft/arguments');
const platform = require('../util/platform');

class GameLauncher {
  constructor(ctx) {
    this.ctx = ctx;
    this.running = new Map(); // instanceId -> { child, startedAt }
    this._starting = new Set(); // идёт подготовка (защита от двойного нажатия «Играть»)
  }

  isRunning(instanceId) { return this.running.has(instanceId); }

  _progress(instanceId, text, p = {}) {
    this.ctx.emit('progress', { instanceId, text, ...p });
  }

  /**
   * Полная подготовка файлов без запуска (можно вызывать отдельно — «Установить»).
   * Возвращает всё, что нужно для запуска.
   */
  async prepare(instanceId) {
    const ctx = this.ctx;
    if (this.running.has(instanceId)) throw new Error('Сборка запущена — закрой игру и повтори');
    let inst = await ctx.instances.get(instanceId);
    const settings = ctx.settings.get();
    const gameDir = ctx.paths.gameDir(instanceId);
    await ensureDir(gameDir);

    // 1. Синхронизация со сервером
    if (inst.sync?.url && settings.autoSync !== false) {
      this._progress(instanceId, 'Синхронизация сборки с сервером');
      try {
        await ctx.sync.sync(instanceId, (p) => this._progress(instanceId, 'Синхронизация сборки', p));
        inst = await ctx.instances.get(instanceId);
      } catch (e) {
        if (!inst.sync.lastSync) throw e;
        ctx.log('warn', `Синхронизация не удалась, запускаю последнюю скачанную версию: ${e.message}`);
      }
    }

    const getJava = (v) => ctx.java.resolveJava(v, {
      customPath: inst.java?.path,
      onProgress: (p) => this._progress(instanceId, 'Загрузка Java', p),
    });

    // 2. Фиксируем конкретную версию модлоадера, чтобы не дёргать сеть при каждом запуске
    if (inst.loader?.type && inst.loader.type !== 'vanilla' && (!inst.loader.version || ['latest', 'recommended'].includes(inst.loader.version))) {
      this._progress(instanceId, 'Поиск версии модлоадера');
      const v = await ctx.loaders.resolveVersion(inst.loader.type, inst.minecraft, inst.loader.version);
      inst = await ctx.instances.update(instanceId, { loader: { type: inst.loader.type, version: v } });
    }

    // 3. Модлоадер
    this._progress(instanceId, 'Подготовка версии');
    const versionId = await ctx.loaders.ensureInstalled(inst.loader?.type, inst.minecraft, inst.loader?.version, {
      getJava,
      onProgress: (text, p) => this._progress(instanceId, text, p || {}),
    });
    const version = await ctx.versions.resolve(versionId);

    // 4. Java
    const javaPath = await getJava(version);

    // 5. Список файлов
    const features = { has_custom_resolution: !inst.window?.fullscreen };
    const libs = collectLibraries(version, ctx.paths, { features });
    const items = [...libs.downloads];

    const vanillaId = version._vanilla || version.id;
    const vanillaJar = ctx.paths.versionJar(vanillaId);
    if (version.downloads?.client) {
      items.push({ url: version.downloads.client.url, path: vanillaJar, sha1: version.downloads.client.sha1, size: version.downloads.client.size });
    }

    this._progress(instanceId, 'Проверка ассетов');
    const assetsInfo = await ctx.assets.prepare(version);
    items.push(...assetsInfo.items);

    let logConfigPath = null;
    const logFile = version.logging?.client?.file;
    if (logFile?.url) {
      logConfigPath = ctx.paths.logConfig(logFile.id);
      items.push({ url: logFile.url, path: logConfigPath, sha1: logFile.sha1, size: logFile.size });
    }

    this._progress(instanceId, 'Загрузка файлов игры');
    await ctx.downloader.downloadAll(items, (p) => this._progress(instanceId, 'Загрузка файлов игры', p), { label: `Файлы игры: ${inst.name}` });

    for (const g of libs.generated) {
      if (!(await exists(g))) throw new Error(`Не хватает файла модлоадера ${path.basename(g)}. Удали папку versions/${version.id} и запусти снова — модлоадер переустановится.`);
    }

    // 6. Jar клиента. Для модлоадеров кладём копию под именем дочерней версии (так делает лаунчер Mojang;
    //    Forge 1.17+ ожидает именно это имя в ignoreList).
    let clientJar = vanillaJar;
    if (version.jar) clientJar = ctx.paths.versionJar(version.jar);
    else if (version.id !== vanillaId) {
      clientJar = ctx.paths.versionJar(version.id);
      await copyIfChanged(vanillaJar, clientJar);
    }

    // 7. Нативы (старые версии; новые грузят их из classpath сами)
    const nativesDir = path.join(ctx.paths.instanceDir(instanceId), 'natives');
    await fsp.rm(nativesDir, { recursive: true, force: true });
    await ensureDir(nativesDir);
    for (const n of libs.natives) {
      await withZip(n.path, (zip) => zip.extractPrefix('', nativesDir, { exclude: n.exclude }));
    }

    const gameAssets = await ctx.assets.finalize(assetsInfo, gameDir);
    const classpath = [...libs.classpath.filter((p) => p !== clientJar), clientJar];

    return { inst, version, javaPath, classpath, nativesDir, gameDir, assetsInfo, gameAssets, logConfigPath, features };
  }

  /**
   * Запуск. opts: { accountId, server: {address, port} } — server перекрывает настройку сборки.
   * События: progress, game-log {instanceId, line, stream}, game-start, game-exit {instanceId, code, crashReport}
   */
  async launch(instanceId, opts = {}) {
    if (this.running.has(instanceId) || this._starting.has(instanceId)) throw new Error('Эта сборка уже запущена');
    this._starting.add(instanceId);
    try {
      return await this._launch(instanceId, opts);
    } finally {
      this._starting.delete(instanceId);
    }
  }

  async _launch(instanceId, opts) {
    const ctx = this.ctx;
    const settings = ctx.settings.get();

    this._progress(instanceId, 'Проверка аккаунта');
    const account = await ctx.accounts.getForLaunch(opts.accountId);

    const p = await this.prepare(instanceId);
    const { inst, version, gameDir } = p;

    const server = opts.server || (inst.server?.autoConnect && inst.server.address ? inst.server : null);
    const features = { ...p.features };
    if (server && supportsQuickPlay(version)) features.is_quick_play_multiplayer = true;

    const cfg = ctx.config;
    const vars = {
      auth_player_name: account.name,
      auth_uuid: account.uuid,
      auth_access_token: account.accessToken || '0',
      auth_session: `token:${account.accessToken || '0'}:${account.uuid}`,
      auth_xuid: account.xuid || '0',
      clientid: cfg.microsoft?.clientId || '',
      user_type: account.type === 'microsoft' ? 'msa' : 'legacy',
      user_properties: '{}',
      version_name: version.id,
      version_type: cfg.versionType || version.type || 'release',
      game_directory: gameDir,
      assets_root: ctx.paths.assets,
      game_assets: p.gameAssets,
      assets_index_name: p.assetsInfo.indexId,
      natives_directory: p.nativesDir,
      library_directory: ctx.paths.libraries,
      classpath_separator: platform.classpathSeparator,
      classpath: p.classpath.join(platform.classpathSeparator),
      launcher_name: cfg.launcherBrand || 'mc-launcher-kit',
      launcher_version: cfg.version || '0.1.0',
      resolution_width: inst.window?.width || 1280,
      resolution_height: inst.window?.height || 720,
      quickPlayMultiplayer: server ? `${server.address}:${server.port || 25565}` : '',
    };

    const maxMem = inst.java?.maxMemory || settings.memory.max;
    const minMem = Math.min(inst.java?.minMemory || settings.memory.min, maxMem); // -Xms > -Xmx = JVM не стартует
    const args = buildLaunchArguments(version, {
      vars,
      features,
      memory: { min: minMem, max: maxMem },
      extraJvm: [...(settings.javaArgs || []), ...(inst.java?.args || [])],
      extraGame: inst.window?.fullscreen ? ['--fullscreen'] : [],
      server,
      logConfigPath: p.logConfigPath,
    });

    let java = p.javaPath;
    if (process.platform === 'win32' && /java\.exe$/i.test(java)) {
      const w = java.replace(/java\.exe$/i, 'javaw.exe');
      if (await exists(w)) java = w;
    }

    const masked = args.map((a) => (a === account.accessToken && a !== '0' ? '<token>' : a));
    ctx.log('info', `Запуск: ${java} ${masked.join(' ')}`);
    this._progress(instanceId, 'Запуск игры');

    const child = spawn(java, args, { cwd: gameDir, windowsHide: false, env: { ...process.env, ...(opts.env || {}) } });
    const startedAt = Date.now();
    this.running.set(instanceId, { child, startedAt });
    ctx.emit('game-start', { instanceId, pid: child.pid });

    const tail = [];
    const pipe = (stream, name) => {
      let buf = '';
      stream.on('data', (d) => {
        buf += d.toString();
        const lines = buf.split(/\r?\n/);
        buf = lines.pop();
        for (const line of lines) {
          tail.push(line);
          if (tail.length > 200) tail.shift();
          ctx.emit('game-log', { instanceId, line, stream: name });
        }
      });
      stream.on('end', () => { if (buf) ctx.emit('game-log', { instanceId, line: buf, stream: name }); });
    };
    pipe(child.stdout, 'stdout');
    pipe(child.stderr, 'stderr');

    child.on('error', (e) => {
      this.running.delete(instanceId);
      ctx.emit('game-exit', { instanceId, code: -1, error: e.message });
    });
    child.on('close', async (code) => {
      this.running.delete(instanceId);
      let crashReport = null;
      if (code !== 0) crashReport = await this._latestCrashReport(gameDir, startedAt);
      await ctx.instances.recordPlay(instanceId, startedAt).catch(() => {});
      ctx.emit('game-exit', { instanceId, code, crashReport, tail: code !== 0 ? tail.slice(-40) : [] });
    });

    await ctx.settings.set({ lastInstanceId: instanceId }).catch(() => {});
    return { pid: child.pid };
  }

  kill(instanceId) {
    const r = this.running.get(instanceId);
    if (r) r.child.kill();
  }

  async _latestCrashReport(gameDir, since) {
    const dir = path.join(gameDir, 'crash-reports');
    try {
      const files = await fsp.readdir(dir);
      let best = null;
      for (const f of files) {
        const st = await fsp.stat(path.join(dir, f));
        if (st.mtimeMs >= since && (!best || st.mtimeMs > best.t)) best = { f, t: st.mtimeMs };
      }
      return best ? path.join(dir, best.f) : null;
    } catch { return null; }
  }
}

module.exports = { GameLauncher };
