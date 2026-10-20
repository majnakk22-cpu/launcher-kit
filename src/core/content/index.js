'use strict';
// Каталог контента (Modrinth / CurseForge): поиск, установка в сборку с зависимостями, обновления, удаление.
const path = require('path');
const { fsp, safeJoin, exists, walkFiles } = require('../util/fs');

const FOLDERS = { mod: 'mods', resourcepack: 'resourcepacks', shader: 'shaderpacks', datapack: 'datapacks' };
const RELEASE_ORDER = { release: 0, beta: 1, alpha: 2 };

/** Лучшая версия: сначала релизы, потом беты; внутри — самая свежая. */
function pickBestVersion(versions, { allowUnstable = true } = {}) {
  const list = versions.filter((v) => v.files.length && (allowUnstable || v.releaseType === 'release'));
  list.sort((a, b) => (RELEASE_ORDER[a.releaseType] ?? 3) - (RELEASE_ORDER[b.releaseType] ?? 3) || new Date(b.date) - new Date(a.date));
  return list[0] || null;
}

class ContentService {
  constructor(ctx, providers) {
    this.ctx = ctx;
    this.providers = new Map(providers.map((p) => [p.id, p]));
  }

  provider(id) {
    const p = this.providers.get(id);
    if (!p) throw new Error(`Неизвестный источник: ${id}`);
    return p;
  }

  list() { return [...this.providers.values()].map((p) => ({ id: p.id, name: p.name, available: p.available() })); }

  async _filterFor(instanceId) {
    const inst = await this.ctx.instances.get(instanceId);
    return { inst, mcVersion: inst.minecraft, loader: inst.loader?.type || 'vanilla' };
  }

  /** params: { query, type, mcVersion, loader, offset, limit, sort } или { instanceId, ... } */
  async search(providerId, params = {}) {
    let p = { ...params };
    if (params.instanceId) {
      const f = await this._filterFor(params.instanceId);
      p = { mcVersion: f.mcVersion, loader: f.loader, ...params };
    }
    return this.provider(providerId).search(p);
  }

  async categories(providerId, type = 'mod') {
    const p = this.provider(providerId);
    return p.getCategories ? p.getCategories(type) : [];
  }

  async getVersions(providerId, projectId, params = {}) {
    let p = { ...params };
    if (params.instanceId) {
      const f = await this._filterFor(params.instanceId);
      p = { mcVersion: f.mcVersion, loader: f.loader, ...params };
    }
    return this.provider(providerId).getVersions(projectId, p);
  }

  /**
   * Установка в сборку. req: { provider, projectId, versionId?, type='mod', title?, withDependencies=true }
   * Возвращает { installed: [], blocked: [{title, url}], skipped: [] }
   */
  async install(instanceId, req, onProgress = () => {}) {
    const { inst, mcVersion, loader } = await this._filterFor(instanceId);
    const type = req.type || 'mod';
    const folder = FOLDERS[type] || 'mods';
    const gameDir = this.ctx.paths.gameDir(instanceId);
    let content = [...(inst.content || [])];
    const result = { installed: [], blocked: [], skipped: [] };

    const queue = [{ provider: req.provider, projectId: String(req.projectId), versionId: req.versionId || null, title: req.title || null, root: true }];
    const visited = new Set();

    while (queue.length) {
      const job = queue.shift();
      const key = `${job.provider}:${job.projectId}`;
      if (visited.has(key)) continue;
      visited.add(key);
      const prov = this.provider(job.provider);

      // зависимость уже стоит — пропускаем
      if (!job.root && content.some((c) => c.provider === job.provider && c.projectId === job.projectId)) { result.skipped.push(job.projectId); continue; }

      let version;
      if (job.versionId) version = await prov.getVersion(job.versionId, job.projectId);
      else version = pickBestVersion(await prov.getVersions(job.projectId, { mcVersion, loader, type }));
      if (!version) {
        if (job.root) throw new Error(`Нет версии для Minecraft ${mcVersion}${loader !== 'vanilla' ? ` / ${loader}` : ''}`);
        this.ctx.log('warn', `Зависимость ${job.projectId}: нет подходящей версии`);
        result.skipped.push(job.projectId);
        continue;
      }
      let title = job.title;
      if (!title) { try { title = (await prov.getProject(job.projectId)).title; } catch { title = job.projectId; } }

      const file = version.files.find((f) => f.primary) || version.files[0];
      if (!file.url) {
        let url = null;
        try { url = (await prov.getProject(job.projectId)).url; } catch { /* ignore */ }
        result.blocked.push({ title, fileName: file.fileName, url: url ? `${url}/files/${version.id}` : null, folder });
        continue;
      }

      onProgress({ text: `Установка: ${title}` });
      const rel = `${folder}/${file.fileName}`;
      await this.ctx.downloader.downloadAll([{ url: file.url, path: safeJoin(gameDir, rel), sha1: file.sha1, size: file.size }], undefined, { label: title });

      // удаляем старый файл этого проекта (обновление)
      const prev = content.find((c) => c.provider === job.provider && c.projectId === job.projectId);
      if (prev && prev.path !== rel) await fsp.rm(safeJoin(gameDir, prev.path), { force: true }).catch(() => {});
      content = content.filter((c) => !(c.provider === job.provider && c.projectId === job.projectId));
      const entry = { provider: job.provider, projectId: job.projectId, versionId: version.id, versionNumber: version.versionNumber, fileName: file.fileName, path: rel, title, type, installedAt: Date.now() };
      content.push(entry);
      result.installed.push(entry);

      if (req.withDependencies !== false && type === 'mod') {
        for (const d of version.dependencies) {
          if (d.type === 'required' && d.projectId) queue.push({ provider: job.provider, projectId: String(d.projectId), versionId: d.versionId || null });
        }
      }
    }

    await this.ctx.instances.update(instanceId, { content });
    return result;
  }

  async remove(instanceId, provider, projectId) {
    const inst = await this.ctx.instances.get(instanceId);
    const gameDir = this.ctx.paths.gameDir(instanceId);
    const entry = (inst.content || []).find((c) => c.provider === provider && c.projectId === String(projectId));
    if (entry) {
      await fsp.rm(safeJoin(gameDir, entry.path), { force: true });
      await fsp.rm(safeJoin(gameDir, `${entry.path}.disabled`), { force: true });
    }
    await this.ctx.instances.update(instanceId, { content: (inst.content || []).filter((c) => c !== entry) });
  }

  /** [{ entry, latest }] — для каких установленных проектов есть новая версия. */
  async checkUpdates(instanceId) {
    const { inst, mcVersion, loader } = await this._filterFor(instanceId);
    const out = [];
    for (const entry of inst.content || []) {
      try {
        const latest = pickBestVersion(await this.provider(entry.provider).getVersions(entry.projectId, { mcVersion, loader, type: entry.type }));
        if (latest && latest.id !== entry.versionId) out.push({ entry, latest: { id: latest.id, versionNumber: latest.versionNumber } });
      } catch (e) {
        this.ctx.log('warn', `Проверка обновлений ${entry.title}: ${e.message}`);
      }
    }
    return out;
  }

  async update(instanceId, provider, projectId) {
    const inst = await this.ctx.instances.get(instanceId);
    const entry = (inst.content || []).find((c) => c.provider === provider && c.projectId === String(projectId));
    return this.install(instanceId, { provider, projectId, type: entry?.type || 'mod', title: entry?.title, withDependencies: true });
  }

  /** Файлы в папке (mods/resourcepacks/...) с пометкой включён/выключен и источником. */
  async listLocal(instanceId, folder = 'mods') {
    const inst = await this.ctx.instances.get(instanceId);
    const dir = safeJoin(this.ctx.paths.gameDir(instanceId), folder);
    const files = (await walkFiles(dir)).filter((f) => !f.includes('/'));
    return files.map((f) => {
      const enabled = !f.endsWith('.disabled');
      const rel = `${folder}/${enabled ? f : f.slice(0, -'.disabled'.length)}`;
      const entry = (inst.content || []).find((c) => c.path === rel) || null;
      return { fileName: f, path: rel, enabled, entry };
    });
  }

  /** Вкл/выкл мод переименованием в .disabled */
  async setEnabled(instanceId, relPath, enabled) {
    const gameDir = this.ctx.paths.gameDir(instanceId);
    const on = safeJoin(gameDir, relPath);
    const off = `${on}.disabled`;
    if (enabled && await exists(off)) await fsp.rename(off, on);
    if (!enabled && await exists(on)) await fsp.rename(on, off);
  }

  /** Удалить локальный файл (в том числе добавленный вручную). */
  async removeLocal(instanceId, relPath) {
    const inst = await this.ctx.instances.get(instanceId);
    const gameDir = this.ctx.paths.gameDir(instanceId);
    await fsp.rm(safeJoin(gameDir, relPath), { force: true });
    await fsp.rm(safeJoin(gameDir, `${relPath}.disabled`), { force: true });
    await this.ctx.instances.update(instanceId, { content: (inst.content || []).filter((c) => c.path !== relPath) });
  }

  /** Копирует файлы с диска (drag&drop) в папку сборки. */
  async addLocalFiles(instanceId, filePaths, folder = 'mods') {
    const dir = safeJoin(this.ctx.paths.gameDir(instanceId), folder);
    await fsp.mkdir(dir, { recursive: true });
    for (const f of filePaths) await fsp.copyFile(f, path.join(dir, path.basename(f)));
  }
}

module.exports = { ContentService, pickBestVersion, FOLDERS };
