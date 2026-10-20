'use strict';
// Менеджер конфигураций по умолчанию — файлы, которые копируются в новую сборку при создании.
const { fsp, ensureDir, readJson, writeJson, exists, copyFile } = require('../util/fs');
const path = require('path');

class DefaultConfigsManager {
  constructor(ctx) {
    this.ctx = ctx;
    this.sourceDir = ctx.paths.defaultConfigsDir();
  }

  /** Убедиться, что папка с дефолтными конфигами существует */
  async ensureSourceDir() {
    await ensureDir(this.sourceDir);
  }

  /** Получить список доступных пресетов конфигов (папки в default-configs) */
  async listPresets() {
    await this.ensureSourceDir();
    try {
      const entries = await fsp.readdir(this.sourceDir, { withFileTypes: true });
      return entries.filter(e => e.isDirectory()).map(e => e.name);
    } catch {
      return [];
    }
  }

  /** Скопировать дефолтные конфиги для конкретного пресета в игровую папку сборки */
  async applyPreset(presetName, gameDir) {
    const presetDir = path.join(this.sourceDir, presetName);
    if (!(await exists(presetDir))) {
      throw new Error(`Пресет конфигов "${presetName}" не найден`);
    }
    await this.copyRecursive(presetDir, gameDir);
  }

  /** Скопировать все пресеты (для backwards compatibility) */
  async applyAll(gameDir) {
    await this.ensureSourceDir();
    const presets = await this.listPresets();
    for (const preset of presets) {
      await this.applyPreset(preset, gameDir);
    }
  }

  async copyRecursive(src, dest) {
    await ensureDir(dest);
    const entries = await fsp.readdir(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        await this.copyRecursive(srcPath, destPath);
      } else {
        await copyFile(srcPath, destPath);
      }
    }
  }
}

module.exports = { DefaultConfigsManager };