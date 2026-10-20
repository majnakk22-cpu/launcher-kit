'use strict';
// Файловые утилиты ядра. Ничего не знают про Electron.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
  return dir;
}

async function exists(p) {
  try { await fsp.access(p); return true; } catch { return false; }
}

async function statOrNull(p) {
  try { return await fsp.stat(p); } catch { return null; }
}

async function readJson(p, fallback = undefined) {
  try {
    return JSON.parse(await fsp.readFile(p, 'utf8'));
  } catch (e) {
    if (fallback !== undefined && (e.code === 'ENOENT' || e instanceof SyntaxError)) return fallback;
    throw e;
  }
}

/** Атомарная запись JSON: пишем во временный файл и переименовываем. */
async function writeJson(p, data) {
  await ensureDir(path.dirname(p));
  const tmp = `${p}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2));
  await fsp.rename(tmp, p);
}

function hashFile(p, algo = 'sha1') {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash(algo);
    fs.createReadStream(p)
      .on('error', reject)
      .on('data', (c) => h.update(c))
      .on('end', () => resolve(h.digest('hex')));
  });
}

async function sha1File(p) { return hashFile(p, 'sha1'); }

/**
 * Безопасно соединяет базовую папку и относительный путь из внешнего источника
 * (манифест сервера, модпак). Не даёт выйти за пределы base через "../" или абсолютный путь.
 */
function safeJoin(base, rel) {
  if (typeof rel !== 'string' || !rel) throw new Error('Пустой путь');
  const norm = rel.replace(/\\/g, '/');
  if (norm.startsWith('/') || /^[a-zA-Z]:/.test(norm)) throw new Error(`Абсолютный путь запрещён: ${rel}`);
  if (norm.split('/').includes('..')) throw new Error(`Путь с ".." запрещён: ${rel}`);
  const target = path.resolve(base, norm);
  const root = path.resolve(base);
  if (target !== root && !target.startsWith(root + path.sep)) throw new Error(`Путь выходит за пределы папки: ${rel}`);
  return target;
}

/** Рекурсивный обход файлов. Возвращает пути относительно root с прямыми слэшами. */
async function walkFiles(root, rel = '') {
  const out = [];
  let entries;
  try { entries = await fsp.readdir(path.join(root, rel), { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...await walkFiles(root, r));
    else if (e.isFile()) out.push(r);
  }
  return out;
}

async function removeEmptyDirs(dir) {
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) if (e.isDirectory()) await removeEmptyDirs(path.join(dir, e.name));
  try { if ((await fsp.readdir(dir)).length === 0) await fsp.rmdir(dir); } catch { /* ignore */ }
}

/** Копирует файл, если цели нет или размер отличается. */
async function copyIfChanged(src, dst) {
  const [a, b] = await Promise.all([statOrNull(src), statOrNull(dst)]);
  if (!a) throw new Error(`Нет файла ${src}`);
  if (b && b.size === a.size) return false;
  await ensureDir(path.dirname(dst));
  await fsp.copyFile(src, dst);
  return true;
}

module.exports = {
  fs, fsp, ensureDir, exists, statOrNull, readJson, writeJson,
  hashFile, sha1File, safeJoin, walkFiles, removeEmptyDirs, copyIfChanged,
};
