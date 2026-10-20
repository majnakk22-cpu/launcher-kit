#!/usr/bin/env node
'use strict';
// Консольный интерфейс к ядру — удобно для отладки и для запуска без GUI.
//
//   node tools/cli.js versions [--snapshots]
//   node tools/cli.js loaders <forge|neoforge|fabric|quilt> <mc>
//   node tools/cli.js create <name> --mc 1.20.1 [--loader forge] [--loader-version 47.3.0]
//   node tools/cli.js list
//   node tools/cli.js offline <nick>
//   node tools/cli.js launch <instanceId> [--server host:port]
//   node tools/cli.js search <modrinth|curseforge> <query> [--instance id] [--type mod]
//   node tools/cli.js install <instanceId> <modrinth|curseforge> <projectId|slug>
//   node tools/cli.js import <file.mrpack|file.zip>
//   node tools/cli.js from-manifest <url>
//   node tools/cli.js sync <instanceId>
//
// Папка данных: --data <dir> или переменная LAUNCHER_DATA_DIR (по умолчанию ./.launcher-data)
const path = require('path');
const fs = require('fs');
const { createLauncherCore } = require('../src/core');

function parseArgs(argv) {
  const pos = [];
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) opts[k] = argv[++i]; else opts[k] = true;
    } else pos.push(a);
  }
  return { pos, opts };
}

function bar(p) {
  if (!p || !(p.total || p.totalBytes)) return '';
  const r = p.totalBytes ? p.bytes / p.totalBytes : p.done / p.total;
  const n = Math.round(r * 24);
  return `[${'#'.repeat(n)}${'.'.repeat(24 - n)}] ${(r * 100).toFixed(0)}%`;
}

async function main() {
  const { pos, opts } = parseArgs(process.argv.slice(2));
  const [cmd, ...rest] = pos;
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'launcher.config.json'), 'utf8'));
  const dataDir = opts.data || process.env.LAUNCHER_DATA_DIR || path.resolve('.launcher-data');
  const core = await createLauncherCore({ dataDir, config });

  let lastLine = '';
  core.on('progress', (p) => {
    const line = `${p.text || ''} ${bar(p)}`.trim();
    if (line !== lastLine && process.stdout.isTTY) { process.stdout.write(`\r${line.padEnd(80)}`); lastLine = line; }
  });
  core.on('log', (l) => { if (l.level !== 'debug' || opts.verbose) console.log(`\n[${l.level}] ${l.message}`); });

  switch (cmd) {
    case 'versions': {
      const list = await core.versions.listMinecraftVersions({ types: opts.snapshots ? ['release', 'snapshot'] : ['release'] });
      console.log(list.slice(0, Number(opts.limit) || 30).map((v) => `${v.id}\t${v.type}`).join('\n'));
      break;
    }
    case 'loaders': {
      const list = await core.loaders.listVersions(rest[0], rest[1]);
      console.log(list.slice(0, 20).map((v) => `${v.version}${v.recommended ? '  (recommended)' : ''}${v.stable ? '' : '  (beta)'}`).join('\n'));
      break;
    }
    case 'create': {
      const inst = await core.instances.create({
        name: rest[0],
        minecraft: opts.mc,
        loader: { type: opts.loader || 'vanilla', version: opts['loader-version'] || (opts.loader ? 'latest' : null) },
      });
      console.log(`Создана сборка ${inst.id}`);
      break;
    }
    case 'list': {
      for (const i of await core.instances.list()) console.log(`${i.id}\t${i.minecraft}\t${i.loader.type} ${i.loader.version || ''}\t${i.name}`);
      break;
    }
    case 'offline': {
      const a = await core.accounts.addOffline(rest[0]);
      console.log(`Аккаунт ${a.name} (${a.uuid}) добавлен и выбран`);
      break;
    }
    case 'launch': {
      let server;
      if (opts.server) { const [address, port] = String(opts.server).split(':'); server = { address, port: Number(port) || 25565 }; }
      core.on('game-log', (l) => console.log(l.line));
      const done = new Promise((resolve) => core.on('game-exit', (e) => { console.log(`\nИгра завершилась с кодом ${e.code}`); resolve(); }));
      await core.launcher.launch(rest[0], { server });
      console.log('\nИгра запущена');
      await done;
      break;
    }
    case 'search': {
      const r = await core.content.search(rest[0], { query: rest.slice(1).join(' '), instanceId: opts.instance, type: opts.type || 'mod', mcVersion: opts.mc, loader: opts.loader });
      console.log(`Найдено: ${r.total}`);
      for (const hit of r.hits) console.log(`${hit.id}\t${hit.slug || ''}\t${hit.title}\t⬇${hit.downloads}`);
      break;
    }
    case 'install': {
      const r = await core.content.install(rest[0], { provider: rest[1], projectId: rest[2], type: opts.type || 'mod' });
      console.log(`\nУстановлено: ${r.installed.map((e) => e.fileName).join(', ')}`);
      if (r.blocked.length) console.log(`Скачать вручную: ${r.blocked.map((b) => b.url || b.fileName).join(', ')}`);
      break;
    }
    case 'import': {
      const r = await core.modpacks.importFile(path.resolve(rest[0]), { onProgress: (p) => core.emit('progress', p) });
      console.log(`\nСборка ${r.instance.id} готова`);
      break;
    }
    case 'from-manifest': {
      const inst = await core.sync.createFromManifest(rest[0]);
      console.log(`Сборка ${inst.id} привязана к манифесту`);
      break;
    }
    case 'sync': {
      const r = await core.sync.sync(rest[0], (p) => core.emit('progress', { text: 'Синхронизация', ...p }));
      console.log(`\nВерсия ${r.version}: скачано ${r.downloaded}, удалено ${r.removed.length}`);
      break;
    }
    default:
      console.log(fs.readFileSync(__filename, 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n'));
  }
}

main().catch((e) => { console.error(`\nОшибка: ${e.message}`); process.exit(1); });
