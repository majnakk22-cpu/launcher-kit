'use strict';
// Главный процесс Electron: окно, ядро, мост событий в интерфейс.
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, safeStorage, shell, ipcMain } = require('electron');
const { createLauncherCore } = require('../core');
const { registerIpc } = require('./ipc');
const { Updater } = require('./updater');

const ROOT = path.join(__dirname, '..', '..');
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'launcher.config.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
// Версия лаунчера всегда берётся из package.json (её же видит установщик и автообновление)
config.version = pkg.version;
app.setName(config.name || 'Launcher');

/**
 * Папка данных:
 *  1) переменная окружения LAUNCHER_DATA_DIR
 *  2) портативный режим: рядом с exe лежит файл portable.txt -> папка data рядом с exe
 *  3) %APPDATA%/<dataDirName> (Windows), ~/Library/Application Support/<..> (macOS), ~/.config/<..> (Linux)
 */
function resolveDataDir() {
  if (process.env.LAUNCHER_DATA_DIR) return process.env.LAUNCHER_DATA_DIR;
  const exeDir = path.dirname(process.env.PORTABLE_EXECUTABLE_FILE || app.getPath('exe'));
  if (fs.existsSync(path.join(exeDir, 'portable.txt'))) return path.join(exeDir, 'data');
  return path.join(app.getPath('appData'), config.dataDirName || `.${config.id || 'mc-launcher-kit'}`);
}

// Шифрование токенов средствами ОС (DPAPI / Keychain / libsecret)
const encrypt = (s) => (safeStorage.isEncryptionAvailable() ? `enc:${safeStorage.encryptString(s).toString('base64')}` : `plain:${s}`);
const decrypt = (s) => {
  if (!s) return '{}';
  if (s.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(s.slice(4), 'base64'));
  if (s.startsWith('plain:')) return s.slice(6);
  return s;
};

let win = null;
let core = null;
let allowClose = false;
let closeAckTimer = null;

/** Закрыть окно без вопросов (интерфейс уже всё подтвердил). */
function forceClose() {
  allowClose = true;
  clearTimeout(closeAckTimer);
  win?.close();
}

function send(channel, data) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, data);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 720,
    minWidth: 940,
    minHeight: 600,
    frame: false,
    backgroundColor: config.theme?.bg || '#0f1115',
    title: config.name,
    show: false,
    icon: fs.existsSync(path.join(ROOT, 'build', 'icon.png')) ? path.join(ROOT, 'build', 'icon.png') : undefined,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  if (process.argv.includes('--dev')) win.webContents.openDevTools({ mode: 'detach' });

  // Внешние ссылки — в системный браузер
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  // Закрытие (Alt+F4, панель задач): сначала спрашиваем интерфейс — вдруг там несохранённые
  // изменения или идёт загрузка. Если интерфейс не ответил за 1.5 с (завис) — закрываемся.
  win.on('close', (e) => {
    if (allowClose) return;
    e.preventDefault();
    send('window:close-request');
    clearTimeout(closeAckTimer);
    closeAckTimer = setTimeout(forceClose, 1500);
  });
  win.on('maximize', () => send('window:state', { maximized: true }));
  win.on('unmaximize', () => send('window:state', { maximized: false }));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
  });

  app.whenReady().then(async () => {
    core = await createLauncherCore({ dataDir: resolveDataDir(), config, encrypt, decrypt });

    // Пробрасываем события ядра в интерфейс
    for (const ev of ['progress', 'log', 'game-log', 'game-start', 'game-exit', 'instances-changed', 'settings-changed', 'downloads', 'defaults-changed']) {
      core.on(ev, (data) => send(`core:${ev}`, data));
    }

    // Поведение окна после запуска игры
    core.on('game-start', () => {
      const mode = core.settings.get().afterLaunch;
      if (mode === 'hide') win?.hide();
      if (mode === 'minimize') win?.minimize();
    });
    core.on('game-exit', () => {
      const mode = core.settings.get().afterLaunch;
      if (mode === 'hide' && core.launcher.running.size === 0) { win?.show(); }
    });

    const updater = new Updater({ config, currentVersion: pkg.version, core, app, shell });
    ipcMain.on('window:close-ack', () => clearTimeout(closeAckTimer));
    registerIpc({ core, config, getWindow: () => win, send, forceClose, updater });
    createWindow();
    core.applyPresets().then(() => send('core:instances-changed', null));
  });

  // app.quit() (например, после скачивания обновления) закрывает окно без вопросов
  app.on('before-quit', () => { allowClose = true; });

  app.on('window-all-closed', () => {
    // Если игра запущена — не мешаем ей, просто выходим из лаунчера (процесс игры не убиваем)
    app.quit();
  });
}
