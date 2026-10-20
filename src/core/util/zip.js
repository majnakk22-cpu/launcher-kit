'use strict';
// Минимальный читатель ZIP (jar, mrpack, модпаки CurseForge) без внешних зависимостей.
// Поддерживает методы stored/deflate и ZIP64.
const path = require('path');
const zlib = require('zlib');
const { promisify } = require('util');
const { pipeline } = require('stream/promises');
const { fs, fsp, ensureDir, safeJoin } = require('./fs');

const inflateRaw = promisify(zlib.inflateRaw);

class ZipFile {
  constructor(file, fh, entries) {
    this.file = file;
    this.fh = fh;
    this.entries = entries;
    this.byName = new Map(entries.map((e) => [e.name, e]));
  }

  get(name) { return this.byName.get(name.replace(/^\/+/, '')) || null; }

  async _dataOffset(entry) {
    const hdr = Buffer.alloc(30);
    await this.fh.read(hdr, 0, 30, entry.localOffset);
    if (hdr.readUInt32LE(0) !== 0x04034b50) throw new Error(`Повреждён локальный заголовок: ${entry.name}`);
    return entry.localOffset + 30 + hdr.readUInt16LE(26) + hdr.readUInt16LE(28);
  }

  /** Читает запись целиком в Buffer. */
  async read(nameOrEntry) {
    const entry = typeof nameOrEntry === 'string' ? this.get(nameOrEntry) : nameOrEntry;
    if (!entry) throw new Error(`В архиве ${path.basename(this.file)} нет файла ${nameOrEntry}`);
    const off = await this._dataOffset(entry);
    const buf = Buffer.alloc(entry.compressedSize);
    if (entry.compressedSize) await this.fh.read(buf, 0, entry.compressedSize, off);
    if (entry.method === 0) return buf;
    if (entry.method === 8) return inflateRaw(buf);
    throw new Error(`Неподдерживаемый метод сжатия ${entry.method} (${entry.name})`);
  }

  async readText(name) { return (await this.read(name)).toString('utf8'); }
  async readJson(name) { return JSON.parse((await this.readText(name)).replace(/^﻿/, '')); }

  /** Потоково распаковывает запись в файл (подходит для больших файлов). */
  async extractTo(nameOrEntry, dest) {
    const entry = typeof nameOrEntry === 'string' ? this.get(nameOrEntry) : nameOrEntry;
    if (!entry) throw new Error(`Нет файла ${nameOrEntry}`);
    await ensureDir(path.dirname(dest));
    if (entry.compressedSize === 0) { await fsp.writeFile(dest, Buffer.alloc(0)); return; }
    const off = await this._dataOffset(entry);
    const src = fs.createReadStream(this.file, { start: off, end: off + entry.compressedSize - 1 });
    const tmp = `${dest}.part`;
    if (entry.method === 0) await pipeline(src, fs.createWriteStream(tmp));
    else if (entry.method === 8) await pipeline(src, zlib.createInflateRaw(), fs.createWriteStream(tmp));
    else throw new Error(`Неподдерживаемый метод сжатия ${entry.method}`);
    await fsp.rename(tmp, dest);
  }

  /**
   * Распаковывает файлы с префиксом `prefix` в destDir (префикс отрезается).
   * exclude — массив префиксов, которые пропускаются (например "META-INF/").
   */
  async extractPrefix(prefix, destDir, { exclude = [] } = {}) {
    let n = 0;
    for (const e of this.entries) {
      if (e.isDirectory || !e.name.startsWith(prefix)) continue;
      const rel = e.name.slice(prefix.length);
      if (!rel || exclude.some((x) => rel.startsWith(x))) continue;
      await this.extractTo(e, safeJoin(destDir, rel));
      n++;
    }
    return n;
  }

  async close() { await this.fh.close().catch(() => {}); }
}

async function openZip(file) {
  const fh = await fsp.open(file, 'r');
  try {
    const { size } = await fh.stat();
    const tailLen = Math.min(size, 65557);
    const tail = Buffer.alloc(tailLen);
    await fh.read(tail, 0, tailLen, size - tailLen);
    let eocd = -1;
    for (let i = tailLen - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error(`${path.basename(file)}: не ZIP-архив или он повреждён`);

    let count = tail.readUInt16LE(eocd + 10);
    let cdSize = tail.readUInt32LE(eocd + 12);
    let cdOffset = tail.readUInt32LE(eocd + 16);
    if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
      const loc = eocd - 20;
      if (loc >= 0 && tail.readUInt32LE(loc) === 0x07064b50) {
        const rec = Buffer.alloc(56);
        await fh.read(rec, 0, 56, Number(tail.readBigUInt64LE(loc + 8)));
        if (rec.readUInt32LE(0) === 0x06064b50) {
          count = Number(rec.readBigUInt64LE(32));
          cdSize = Number(rec.readBigUInt64LE(40));
          cdOffset = Number(rec.readBigUInt64LE(48));
        }
      }
    }

    const cd = Buffer.alloc(cdSize);
    await fh.read(cd, 0, cdSize, cdOffset);
    const entries = [];
    let p = 0;
    for (let i = 0; i < count && p + 46 <= cd.length; i++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) throw new Error('Повреждён центральный каталог ZIP');
      const flags = cd.readUInt16LE(p + 8);
      const method = cd.readUInt16LE(p + 10);
      let compressedSize = cd.readUInt32LE(p + 20);
      let uncompressedSize = cd.readUInt32LE(p + 24);
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const commentLen = cd.readUInt16LE(p + 32);
      let localOffset = cd.readUInt32LE(p + 42);
      const nameBuf = cd.subarray(p + 46, p + 46 + nameLen);
      const name = nameBuf.toString(flags & 0x800 ? 'utf8' : 'latin1').replace(/\\/g, '/');
      // ZIP64 extra field
      let x = p + 46 + nameLen;
      const xEnd = x + extraLen;
      while (x + 4 <= xEnd) {
        const id = cd.readUInt16LE(x);
        const len = cd.readUInt16LE(x + 2);
        if (id === 0x0001) {
          let q = x + 4;
          if (uncompressedSize === 0xffffffff) { uncompressedSize = Number(cd.readBigUInt64LE(q)); q += 8; }
          if (compressedSize === 0xffffffff) { compressedSize = Number(cd.readBigUInt64LE(q)); q += 8; }
          if (localOffset === 0xffffffff) { localOffset = Number(cd.readBigUInt64LE(q)); q += 8; }
        }
        x += 4 + len;
      }
      entries.push({ name, method, compressedSize, size: uncompressedSize, localOffset, isDirectory: name.endsWith('/') });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return new ZipFile(file, fh, entries);
  } catch (e) {
    await fh.close().catch(() => {});
    throw e;
  }
}

/** Удобный хелпер: открыть, выполнить fn(zip), закрыть. */
async function withZip(file, fn) {
  const zip = await openZip(file);
  try { return await fn(zip); } finally { await zip.close(); }
}

/** Достаёт атрибут из META-INF/MANIFEST.MF (например Main-Class). */
async function readManifestAttribute(jarPath, attr) {
  return withZip(jarPath, async (zip) => {
    if (!zip.get('META-INF/MANIFEST.MF')) return null;
    const text = (await zip.readText('META-INF/MANIFEST.MF')).replace(/\r?\n /g, '');
    const line = text.split(/\r?\n/).find((l) => l.startsWith(`${attr}:`));
    return line ? line.slice(attr.length + 1).trim() : null;
  });
}

module.exports = { openZip, withZip, readManifestAttribute };
