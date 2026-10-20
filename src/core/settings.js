'use strict';
// Глобальные настройки лаунчера (settings.json в папке данных).
const path = require('path');
const { readJson, writeJson } = require('./util/fs');
const { deepMerge } = require('./instances/instances');
const platform = require('./util/platform');

function settingsDefaults() {
  const total = platform.totalMemoryMb();
  const max = Math.max(2048, Math.min(8192, Math.floor(total / 2 / 512) * 512));
  return {
    memory: { min: 1024, max },
    javaArgs: [],
    downloadThreads: 8,
    autoSync: true, // синхронизировать сборки с манифестом перед запуском
    afterLaunch: 'keep', // keep | hide | close — что делать с окном лаунчера после старта игры
    curseforgeApiKey: '', // можно задать в launcher.config.json или ввести в настройках
    lastInstanceId: null,
    language: 'ru',
  };
}

class SettingsStore {
  constructor(ctx) {
    this.ctx = ctx;
    this.file = path.join(ctx.paths.root, 'settings.json');
    this.data = settingsDefaults();
  }
  async load() {
    this.data = deepMerge(settingsDefaults(), await readJson(this.file, {}));
    return this.data;
  }
  get() { return this.data; }
  async set(patch) {
    this.data = deepMerge(this.data, patch);
    await writeJson(this.file, this.data);
    this.ctx.emit('settings-changed', this.data);
    return this.data;
  }
}

module.exports = { SettingsStore, settingsDefaults };
