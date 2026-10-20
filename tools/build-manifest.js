#!/usr/bin/env node
'use strict';
// Генератор манифеста сборки сервера.
//
// 1. Положи файлы клиента в папку, повторяя структуру .minecraft:
//      pack/mods/*.jar, pack/config/..., pack/options.txt
// 2. Опиши сборку в pack.json (всё, кроме "files"):
//      { "id": "my-server", "name": "Мой сервер", "version": "1.0.0", "minecraft": "1.20.1",
//        "loader": { "type": "forge", "version": "47.3.0" }, "managedDirs": ["mods"],
//        "server": { "address": "play.example.com", "port": 25565, "autoConnect": true },
//        "once": ["options.txt"] }
// 3. Запусти:
//      node tools/build-manifest.js pack --meta pack.json --out pack/manifest.json [--base-url https://cdn.example.com/pack/]
// 4. Залей папку pack на любой статический хостинг (GitHub Pages, S3, свой nginx)
//    и укажи ссылку на manifest.json в launcher.config.json -> presets.
//
// Без --base-url пути в манифесте относительные: файлы ищутся рядом с manifest.json.
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

function parseArgs(argv) {
  const pos = [];
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) opts[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    else pos.push(argv[i]);
  }
  return { pos, opts };
}

function walk(root, rel = '') {
  const out = [];
  for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walk(root, r));
    else if (e.isFile()) out.push(r);
  }
  return out;
}

function globToRegex(glob) {
  const esc = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*');
  return new RegExp(`^${esc}$`, 'i');
}

function main() {
  const { pos, opts } = parseArgs(process.argv.slice(2));
  const dir = pos[0];
  if (!dir) { console.log(fs.readFileSync(__filename, 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n')); process.exit(1); }
  const meta = opts.meta ? JSON.parse(fs.readFileSync(opts.meta, 'utf8')) : {};
  const out = opts.out || path.join(dir, 'manifest.json');
  const once = (meta.once || []).map(globToRegex);
  const ignore = ['manifest.json', '.DS_Store', 'Thumbs.db', ...(meta.ignore || [])].map(globToRegex);
  const base = opts['base-url'] ? String(opts['base-url']).replace(/\/?$/, '/') : null;

  const files = walk(dir)
    .filter((rel) => !ignore.some((r) => r.test(rel) || r.test(path.basename(rel))))
    .sort()
    .map((rel) => {
      const buf = fs.readFileSync(path.join(dir, rel));
      const f = { path: rel, sha1: crypto.createHash('sha1').update(buf).digest('hex'), size: buf.length };
      if (base) f.url = base + rel.split('/').map(encodeURIComponent).join('/');
      if (once.some((r) => r.test(rel))) f.mode = 'once';
      return f;
    });

  const { once: _o, ignore: _i, ...rest } = meta;
  const manifest = { formatVersion: 1, ...rest, generatedAt: new Date().toISOString(), files };
  if (!manifest.minecraft) console.warn('Внимание: в pack.json не указан "minecraft"');
  fs.writeFileSync(out, JSON.stringify(manifest, null, 2));
  const total = files.reduce((s, f) => s + f.size, 0);
  console.log(`Готово: ${out}\nФайлов: ${files.length}, размер: ${(total / 1024 / 1024).toFixed(1)} МБ`);
}

main();
