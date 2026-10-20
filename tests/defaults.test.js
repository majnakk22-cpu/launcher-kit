'use strict';
// Конфиги по умолчанию: options.txt, servers.dat (NBT), файлы, режимы для модпаков, импорт из сборки.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createLauncherCore } = require('../src/core');
const nbt = require('../src/core/util/nbt');
const { encodeOption, decodeOption, parseOptionsTxt } = require('../src/core/defaults/game-options');
const { makeZip, startServer, sha1, tmpDir } = require('./helpers');

const readOpts = (file) => Object.fromEntries(parseOptionsTxt(fs.readFileSync(file, 'utf8')));

test('кодирование настроек options.txt', () => {
  assert.deepEqual(encodeOption('fov', 70), { fov: '0' });
  assert.deepEqual(encodeOption('fov', 110), { fov: '1' });
  assert.deepEqual(encodeOption('fov', 90), { fov: '0.5' });
  assert.equal(decodeOption('fov', '0.5'), 90);
  assert.deepEqual(encodeOption('graphicsMode', 2), { graphicsMode: '2', fancyGraphics: 'true' });
  assert.deepEqual(encodeOption('autoJump', false), { autoJump: 'false' });
  assert.equal(decodeOption('lang', 'ru_ru'), 'ru_ru');
  assert.equal(decodeOption('guiScale', '3'), 3);
  assert.equal(decodeOption('soundCategory_music', '0.25'), 0.25);
  assert.deepEqual(encodeOption('unknownKey', 1), {});
});

test('NBT: servers.dat читается и пишется без потерь', () => {
  const buf = nbt.writeServers([{ name: 'Нулевая зона', ip: 'play.example.com' }, { name: 'Local', ip: 'localhost:25570' }]);
  // корень: TAG_Compound(10) + пустое имя (0,0) + TAG_List(9) "servers"
  assert.deepEqual([...buf.subarray(0, 6)], [10, 0, 0, 9, 0, 7]);
  assert.equal(buf.subarray(6, 13).toString(), 'servers');
  const back = nbt.readServers(buf);
  assert.deepEqual(back.map((s) => [s.name, s.ip]), [['Нулевая зона', 'play.example.com'], ['Local', 'localhost:25570']]);
  // произвольные поля (иконка, acceptTextures) сохраняются при перезаписи
  const raw = nbt.read(buf);
  raw.value.servers.value.items[0].acceptTextures = { type: 'byte', value: 1 };
  raw.value.servers.value.items[0].icon = { type: 'string', value: 'iVBOR' };
  const again = nbt.readServers(nbt.writeServers(nbt.readServers(nbt.write(raw))));
  assert.equal(again[0]._raw.acceptTextures.value, 1);
  assert.equal(again[0]._raw.icon.value, 'iVBOR');
  // пустой список тоже валиден
  assert.deepEqual(nbt.readServers(nbt.writeServers([])), []);
});

test('новая сборка получает конфиги по умолчанию; режимы для модпаков; импорт из сборки', async (t) => {
  const dir = tmpDir();
  const core = await createLauncherCore({ dataDir: path.join(dir, 'data'), config: {} });

  await core.defaults.set({
    options: { lang: 'ru_ru', soundCategory_music: 0.2, fov: 90, renderDistance: 16, autoJump: false },
    extraOptions: 'key_key.zoom:key.keyboard.c\nchatScale:0.8',
    servers: [{ name: 'Мой сервер', ip: 'play.example.com' }],
  });
  const src = path.join(dir, 'sodium-options.json');
  fs.writeFileSync(src, '{"quality":"low"}');
  await core.defaults.addFiles([src], 'config');
  assert.deepEqual((await core.defaults.get()).files, ['config/sodium-options.json']);

  // 1. Обычная новая сборка
  const inst = await core.instances.create({ name: 'Новая', minecraft: '1.20.1' });
  const g = (id, p) => path.join(core.paths.gameDir(id), p);
  const o = readOpts(g(inst.id, 'options.txt'));
  assert.equal(o.lang, 'ru_ru');
  assert.equal(o.soundCategory_music, '0.2');
  assert.equal(o.fov, '0.5');
  assert.equal(o.renderDistance, '16');
  assert.equal(o.key_key, undefined);
  assert.equal(o['key_key.zoom'], 'key.keyboard.c');
  assert.equal(o.chatScale, '0.8');
  assert.deepEqual(nbt.readServers(fs.readFileSync(g(inst.id, 'servers.dat'))).map((s) => s.ip), ['play.example.com']);
  assert.equal(fs.readFileSync(g(inst.id, 'config/sodium-options.json'), 'utf8'), '{"quality":"low"}');
  assert.ok(inst.defaultsApplied > 0);

  // повторное применение не дублирует сервер и сохраняет чужие строки
  fs.appendFileSync(g(inst.id, 'options.txt'), 'gamma:0.9\n');
  const servers = nbt.readServers(fs.readFileSync(g(inst.id, 'servers.dat')));
  fs.writeFileSync(g(inst.id, 'servers.dat'), nbt.writeServers([...servers, { name: 'Друг', ip: 'friend.example.com' }]));
  await core.defaults.applyTo(inst.id);
  assert.equal(readOpts(g(inst.id, 'options.txt')).gamma, '0.9');
  assert.deepEqual(nbt.readServers(fs.readFileSync(g(inst.id, 'servers.dat'))).map((s) => s.ip), ['play.example.com', 'friend.example.com']);

  // 2. Модпак со своим options.txt: режим override — наше важнее, применяется ПОСЛЕ распаковки пака
  const mod = Buffer.from('mod');
  const srv = await startServer({ '/m.jar': mod });
  t.after(() => srv.close());
  const pack = (name) => makeZip(path.join(dir, `${name}.mrpack`), {
    'modrinth.index.json': JSON.stringify({ formatVersion: 1, game: 'minecraft', versionId: '1', name, dependencies: { minecraft: '1.20.1' }, files: [{ path: 'mods/m.jar', hashes: { sha1: sha1(mod) }, fileSize: mod.length, downloads: [`${srv.url}/m.jar`] }] }),
    'overrides/options.txt': 'lang:en_us\nrenderDistance:8\nmaxFps:60\n',
    'overrides/config/sodium-options.json': '{"quality":"pack"}',
  });
  const p1 = (await core.modpacks.importFile(pack('Pack One'))).instance;
  let po = readOpts(g(p1.id, 'options.txt'));
  assert.equal(po.lang, 'ru_ru', 'override: язык из конфигов по умолчанию');
  assert.equal(po.maxFps, '60', 'строки пака, которых нет в наших настройках, остаются');
  assert.equal(fs.readFileSync(g(p1.id, 'config/sodium-options.json'), 'utf8'), '{"quality":"low"}');

  // режим fill — только недостающее
  await core.defaults.set({ packMode: 'fill' });
  const p2 = (await core.modpacks.importFile(pack('Pack Two'))).instance;
  po = readOpts(g(p2.id, 'options.txt'));
  assert.equal(po.lang, 'en_us', 'fill: настройка пака сохранена');
  assert.equal(po.soundCategory_music, '0.2', 'fill: недостающее добавлено');
  assert.equal(fs.readFileSync(g(p2.id, 'config/sodium-options.json'), 'utf8'), '{"quality":"pack"}');

  // режим skip и выключенные конфиги
  await core.defaults.set({ packMode: 'skip' });
  const p3 = (await core.modpacks.importFile(pack('Pack Three'))).instance;
  assert.ok(!fs.existsSync(g(p3.id, 'servers.dat')));
  await core.defaults.set({ enabled: false, packMode: 'override' });
  const off = await core.instances.create({ name: 'Без конфигов', minecraft: '1.20.1' });
  assert.ok(!fs.existsSync(g(off.id, 'options.txt')));
  await core.defaults.set({ enabled: true });

  // 3. Импорт настроек из сборки
  fs.writeFileSync(g(off.id, 'options.txt'), 'lang:uk_ua\nfov:1.0\nguiScale:2\nkey_key.jump:key.keyboard.space\nsomethingElse:1\n');
  fs.writeFileSync(g(off.id, 'servers.dat'), nbt.writeServers([{ name: 'Новый', ip: 'new.example.com' }, { name: 'Дубль', ip: 'PLAY.example.com' }]));
  const d = await core.defaults.importFromInstance(off.id, { keybinds: true });
  assert.equal(d.options.lang, 'uk_ua');
  assert.equal(d.options.fov, 110);
  assert.equal(d.options.guiScale, 2);
  assert.ok(d.extraOptions.includes('key_key.jump:key.keyboard.space'));
  assert.ok(!d.extraOptions.includes('somethingElse'));
  assert.deepEqual(d.servers.map((s) => s.ip), ['play.example.com', 'new.example.com'], 'дубли серверов не добавляются');

  // стартовые значения из launcher.config.json
  const core2 = await createLauncherCore({ dataDir: path.join(dir, 'data2'), config: { defaults: { options: { lang: 'be_by' }, servers: [{ name: 'S', ip: 's.example.com' }] } } });
  const i2 = await core2.instances.create({ name: 'X', minecraft: '1.20.1' });
  assert.equal(readOpts(path.join(core2.paths.gameDir(i2.id), 'options.txt')).lang, 'be_by');
});
