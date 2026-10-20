'use strict';
// Модпаки: импорт .mrpack (Modrinth) и .zip (CurseForge), установка из каталога, обновление.
const path = require('path');
const { fsp, safeJoin, readJson, writeJson } = require('../util/fs');
const { withZip } = require('../util/zip');
const { pickBestVersion } = require('./index');
const { normalizeFile, CLASS } = require('./curseforge');

const PACK_STATE = '.launcher-modpack.json';
const CF_FOLDERS = { [CLASS.mod]: 'mods', [CLASS.resourcepack]: 'resourcepacks', [CLASS.shader]: 'shaderpacks' };

function loaderFromMrpackDeps(deps = {}) {
  if (deps.neoforge) {
    const v = deps.minecraft === '1.20.1' && !deps.neoforge.startsWith('1.20.1-') ? `1.20.1-${deps.neoforge}` : deps.neoforge;
    return { type: 'neoforge', version: v };
  }
  if (deps.forge) return { type: 'forge', version: deps.forge };
  if (deps['fabric-loader']) return { type: 'fabric', version: deps['fabric-loader'] };
  if (deps['quilt-loader']) return { type: 'quilt', version: deps['quilt-loader'] };
  return { type: 'vanilla', version: null };
}

/** "forge-47.2.0" -> {type:'forge', version:'47.2.0'} */
function loaderFromCurseId(id = '', mc = '') {
  const i = id.indexOf('-');
  if (i < 0) return { type: 'vanilla', version: null };
  const type = id.slice(0, i).toLowerCase();
  let version = id.slice(i + 1);
  // NeoForge для 1.20.1 живёт под старыми координатами "1.20.1-47.1.x"
  if (type === 'neoforge' && mc === '1.20.1' && !version.startsWith('1.20.1-')) version = `1.20.1-${version}`;
  return { type, version };
}

class ModpackService {
  constructor(ctx) { this.ctx = ctx; }

  /** Создаёт сборку или обновляет существующую (если указан instanceId). */
  async _upsertInstance({ instanceId, name, minecraft, loader, modpack }) {
    if (instanceId && await this.ctx.instances.has(instanceId)) {
      return this.ctx.instances.update(instanceId, { minecraft, loader, modpack });
    }
    return this.ctx.instances.create({ name, minecraft, loader, modpack });
  }

  /** Конфиги по умолчанию — один раз, после первой установки файлов модпака. */
  async _applyDefaults(instanceId) {
    const inst = await this.ctx.instances.get(instanceId);
    if (inst.defaultsApplied || !this.ctx.defaults) return;
    try { await this.ctx.defaults.applyTo(instanceId, { kind: 'modpack' }); } catch (e) { this.ctx.log('warn', `Конфиги по умолчанию: ${e.message}`); }
  }

  /** Удаляет файлы прошлой версии пака, которых нет в новой. */
  async _applyPackState(gameDir, newFiles) {
    const prev = await readJson(path.join(gameDir, PACK_STATE), { files: [] });
    const keep = new Set(newFiles);
    for (const rel of prev.files || []) if (!keep.has(rel)) await fsp.rm(safeJoin(gameDir, rel), { force: true }).catch(() => {});
    await writeJson(path.join(gameDir, PACK_STATE), { files: [...keep], updatedAt: Date.now() });
  }

  /** Импорт .mrpack. opts: { instanceId?, name?, modpack?, onProgress } */
  async importMrpack(file, opts = {}) {
    const onProgress = opts.onProgress || (() => {});
    return withZip(file, async (zip) => {
      const index = await zip.readJson('modrinth.index.json');
      if (index.game !== 'minecraft') throw new Error('Это не модпак Minecraft');
      const inst = await this._upsertInstance({
        instanceId: opts.instanceId,
        name: opts.name || index.name,
        minecraft: index.dependencies?.minecraft,
        loader: loaderFromMrpackDeps(index.dependencies),
        modpack: opts.modpack || { provider: 'modrinth', name: index.name, versionId: index.versionId },
      });
      const gameDir = this.ctx.paths.gameDir(inst.id);
      const files = (index.files || []).filter((f) => f.env?.client !== 'unsupported');
      const items = files.map((f) => ({ url: f.downloads?.[0], path: safeJoin(gameDir, f.path), sha1: f.hashes?.sha1, size: f.fileSize }));
      onProgress({ text: 'Загрузка файлов модпака' });
      await this.ctx.downloader.downloadAll(items, (p) => onProgress({ text: 'Загрузка файлов модпака', ...p }), { label: `Модпак: ${index.name}` });
      onProgress({ text: 'Распаковка настроек модпака' });
      const overrideFiles = [];
      for (const prefix of ['overrides/', 'client-overrides/']) {
        for (const e of zip.entries) if (!e.isDirectory && e.name.startsWith(prefix)) overrideFiles.push(e.name.slice(prefix.length));
        await zip.extractPrefix(prefix, gameDir);
      }
      await this._applyPackState(gameDir, [...files.map((f) => f.path), ...overrideFiles]);
      await this._applyDefaults(inst.id);
      return { instance: await this.ctx.instances.get(inst.id), blocked: [] };
    });
  }

  /** Импорт zip-модпака CurseForge (manifest.json). Нужен API-ключ CurseForge. */
  async importCurseForgeZip(file, opts = {}) {
    const onProgress = opts.onProgress || (() => {});
    const cf = this.ctx.content.provider('curseforge');
    return withZip(file, async (zip) => {
      const manifest = await zip.readJson('manifest.json');
      if (manifest.manifestType !== 'minecraftModpack') throw new Error('Это не модпак CurseForge');
      const primary = (manifest.minecraft?.modLoaders || []).find((l) => l.primary) || manifest.minecraft?.modLoaders?.[0];
      const inst = await this._upsertInstance({
        instanceId: opts.instanceId,
        name: opts.name || manifest.name,
        minecraft: manifest.minecraft?.version,
        loader: primary ? loaderFromCurseId(primary.id, manifest.minecraft?.version) : { type: 'vanilla', version: null },
        modpack: opts.modpack || { provider: 'curseforge', name: manifest.name, version: manifest.version },
      });
      const gameDir = this.ctx.paths.gameDir(inst.id);
      const entries = (manifest.files || []).filter((f) => f.required !== false);
      const blocked = [];
      const items = [];
      const packFiles = [];
      if (entries.length) {
        if (!cf.available()) throw new Error('Для модпаков CurseForge нужен API-ключ CurseForge (Настройки)');
        onProgress({ text: 'Получение списка файлов CurseForge' });
        const rawFiles = await cf.getFilesBatch(entries.map((f) => f.fileID));
        const mods = await cf.getModsBatch([...new Set(rawFiles.map((f) => f.modId))]);
        const modById = new Map(mods.map((m) => [m.id, m]));
        for (const raw of rawFiles) {
          const v = normalizeFile(raw);
          const f = v.files[0];
          const mod = modById.get(String(raw.modId));
          const folder = CF_FOLDERS[mod?.classId] || 'mods';
          const rel = `${folder}/${f.fileName}`;
          if (!f.url) { blocked.push({ title: mod?.title || f.fileName, fileName: f.fileName, url: mod?.url ? `${mod.url}/files/${raw.id}` : null, folder }); continue; }
          items.push({ url: f.url, path: safeJoin(gameDir, rel), sha1: f.sha1, size: f.size });
          packFiles.push(rel);
        }
      }
      onProgress({ text: 'Загрузка файлов модпака' });
      await this.ctx.downloader.downloadAll(items, (p) => onProgress({ text: 'Загрузка файлов модпака', ...p }), { label: `Модпак: ${manifest.name}` });
      const overrides = `${(manifest.overrides || 'overrides').replace(/\/+$/, '')}/`;
      for (const e of zip.entries) if (!e.isDirectory && e.name.startsWith(overrides)) packFiles.push(e.name.slice(overrides.length));
      await zip.extractPrefix(overrides, gameDir);
      await this._applyPackState(gameDir, packFiles);
      await this._applyDefaults(inst.id);
      if (blocked.length) this.ctx.log('warn', `${blocked.length} файл(ов) нужно скачать вручную (автор запретил сторонние лаунчеры)`);
      return { instance: await this.ctx.instances.get(inst.id), blocked };
    });
  }

  /** Определяет формат по содержимому архива. */
  async importFile(file, opts = {}) {
    const kind = await withZip(file, async (zip) => (zip.get('modrinth.index.json') ? 'mrpack' : zip.get('manifest.json') ? 'curseforge' : null));
    if (kind === 'mrpack') return this.importMrpack(file, opts);
    if (kind === 'curseforge') return this.importCurseForgeZip(file, opts);
    throw new Error('Неизвестный формат модпака (ожидается .mrpack или zip CurseForge)');
  }

  /** Установка из каталога. { provider, projectId, versionId?, instanceId? (для обновления), title? } */
  async installFromCatalog({ provider, projectId, versionId, instanceId, title }, onProgress = () => {}) {
    const prov = this.ctx.content.provider(provider);
    const version = versionId
      ? await prov.getVersion(versionId, projectId)
      : pickBestVersion(await prov.getVersions(projectId, { type: 'modpack' }));
    if (!version) throw new Error('У модпака нет доступных версий');
    const file = version.files.find((f) => f.primary) || version.files[0];
    if (!file?.url) throw new Error('Автор модпака запретил скачивание сторонними лаунчерами — скачай zip с сайта и импортируй вручную');
    onProgress({ text: 'Загрузка модпака' });
    const local = path.join(this.ctx.paths.cache, 'modpacks', `${provider}-${version.id}-${file.fileName}`);
    await this.ctx.downloader.downloadAll([{ url: file.url, path: local, sha1: file.sha1, size: file.size }], (p) => onProgress({ text: 'Загрузка модпака', ...p }), { label: `Модпак: ${title || version.name}` });
    const modpack = { provider, projectId: String(projectId), versionId: version.id, versionNumber: version.versionNumber, name: title || version.name };
    return this.importFile(local, { instanceId, name: title, modpack, onProgress });
  }

  /** Обновление сборки-модпака до последней версии. */
  async update(instanceId, onProgress) {
    const inst = await this.ctx.instances.get(instanceId);
    if (!inst.modpack?.projectId) throw new Error('Сборка не из каталога модпаков');
    return this.installFromCatalog({ provider: inst.modpack.provider, projectId: inst.modpack.projectId, instanceId, title: inst.name }, onProgress);
  }
}

module.exports = { ModpackService, loaderFromMrpackDeps, loaderFromCurseId };
