'use strict';
// Синхронизация по манифесту, каталог Modrinth/CurseForge и импорт модпаков — на локальных mock-серверах.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createLauncherCore } = require('../src/core');
const { openZip } = require('../src/core/util/zip');
const { makeZip, startServer, sha1, tmpDir } = require('./helpers');

const exists = (p) => fs.existsSync(p);

test('ZIP: deflate и stored, распаковка с исключениями', async () => {
  const dir = tmpDir();
  const big = Buffer.alloc(200000, 'a');
  for (const store of [false, true]) {
    const f = makeZip(path.join(dir, `t-${store}.zip`), { 'a.txt': 'привет', 'dir/b.bin': big, 'META-INF/x': 'skip', 'empty.txt': '' }, { store });
    const zip = await openZip(f);
    assert.equal((await zip.readText('a.txt')), 'привет');
    assert.equal((await zip.read('dir/b.bin')).length, big.length);
    await zip.extractPrefix('', path.join(dir, `out-${store}`), { exclude: ['META-INF/'] });
    assert.ok(exists(path.join(dir, `out-${store}/dir/b.bin`)));
    assert.ok(!exists(path.join(dir, `out-${store}/META-INF/x`)));
    assert.equal(fs.readFileSync(path.join(dir, `out-${store}/empty.txt`), 'utf8'), '');
    await zip.close();
  }
  // архив, созданный другой реализацией (python zipfile), если python есть
  try {
    require('child_process').execFileSync('python3', ['-c', `import zipfile;z=zipfile.ZipFile(r'${path.join(dir, 'py.zip')}','w',zipfile.ZIP_DEFLATED);z.writestr('ы/файл.txt','данные');z.close()`]);
    const z = await openZip(path.join(dir, 'py.zip'));
    assert.equal(await z.readText('ы/файл.txt'), 'данные');
    await z.close();
  } catch (e) { if (e.code !== 'ENOENT' && !String(e.message).includes('python3')) throw e; }
  // защита от path traversal
  const evil = makeZip(path.join(dir, 'evil.zip'), { '../evil.txt': 'x' });
  const ez = await openZip(evil);
  await assert.rejects(ez.extractPrefix('', path.join(dir, 'evil-out')));
  await ez.close();
});

test('синхронизация сборки с манифестом сервера', async (t) => {
  const dir = tmpDir();
  const files = {
    'mods/a.jar': Buffer.from('mod-a-v1'),
    'config/x.toml': Buffer.from('x=1'),
    'options.txt': Buffer.from('lang:ru_ru'),
  };
  let manifest;
  const buildManifest = (version, list) => ({
    formatVersion: 1, id: 'zero', name: 'Нулевая зона', version, minecraft: '1.20.1',
    loader: { type: 'forge', version: '47.3.0' },
    server: { address: 'play.example.com', port: 25566, autoConnect: true },
    java: { maxMemory: 6144 },
    managedDirs: ['mods'],
    keep: ['mods/optifine*.jar'],
    files: Object.entries(list).map(([p, b]) => ({ path: p, sha1: sha1(b), size: b.length, ...(p === 'options.txt' ? { mode: 'once' } : {}) })),
  });
  manifest = buildManifest('1.0.0', files);
  const routes = { '/pack/manifest.json': () => {} };
  const srv = await startServer(routes);
  t.after(() => srv.close());
  routes['/pack/manifest.json'] = (req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(manifest)); };
  for (const [p, b] of Object.entries(files)) routes[`/pack/${p}`] = b;

  const core = await createLauncherCore({ dataDir: path.join(dir, 'data'), config: {} });
  const inst = await core.sync.createFromManifest(`${srv.url}/pack/manifest.json`);
  assert.equal(inst.id, 'zero');
  assert.equal(inst.loader.type, 'forge');
  assert.equal(inst.server.port, 25566);
  assert.equal(inst.java.maxMemory, 6144);

  const g = (p) => path.join(core.paths.gameDir('zero'), p);
  let r = await core.sync.sync('zero');
  assert.equal(r.version, '1.0.0');
  assert.equal(fs.readFileSync(g('mods/a.jar'), 'utf8'), 'mod-a-v1');

  // игрок что-то поменял
  fs.writeFileSync(g('mods/stray.jar'), 'cheat');
  fs.writeFileSync(g('mods/OptiFine_HD.jar'), 'allowed');
  fs.writeFileSync(g('config/x.toml'), 'x=999');
  fs.writeFileSync(g('options.txt'), 'lang:en_us');
  r = await core.sync.sync('zero');
  assert.ok(!exists(g('mods/stray.jar')), 'посторонний мод удалён');
  assert.ok(exists(g('mods/OptiFine_HD.jar')), 'разрешённый keep-паттерном мод остался');
  assert.equal(fs.readFileSync(g('config/x.toml'), 'utf8'), 'x=1', 'изменённый конфиг восстановлен');
  assert.equal(fs.readFileSync(g('options.txt'), 'utf8'), 'lang:en_us', 'mode:once не перезаписывает');

  // новая версия сборки: обновлён мод, удалён конфиг
  const files2 = { 'mods/a.jar': Buffer.from('mod-a-v2'), 'options.txt': files['options.txt'] };
  routes['/pack/mods/a.jar'] = files2['mods/a.jar'];
  manifest = buildManifest('1.1.0', files2);
  assert.equal((await core.sync.checkUpdate('zero')).hasUpdate, true);
  r = await core.sync.sync('zero');
  assert.equal(fs.readFileSync(g('mods/a.jar'), 'utf8'), 'mod-a-v2');
  assert.ok(!exists(g('config/x.toml')), 'файл, убранный из манифеста, удалён');
  assert.equal((await core.instances.get('zero')).sync.lastVersion, '1.1.0');
  assert.equal((await core.sync.checkUpdate('zero')).hasUpdate, false);
});

test('каталог Modrinth: поиск, установка с зависимостями, обновление, вкл/выкл, удаление', async (t) => {
  const dir = tmpDir();
  const fileA1 = Buffer.from('sodium-1');
  const fileA2 = Buffer.from('sodium-2');
  const fileB = Buffer.from('fabric-api');
  const ver = (id, project, num, file, buf, date, deps = []) => ({
    id, project_id: project, name: num, version_number: num, game_versions: ['1.20.1'], loaders: ['fabric'], version_type: 'release', date_published: date,
    files: [{ filename: file, url: `URL/files/${file}`, hashes: { sha1: sha1(buf) }, size: buf.length, primary: true }],
    dependencies: deps,
  });
  let versionsA = [ver('a1', 'AAA', '0.5.0', 'sodium-0.5.0.jar', fileA1, '2025-01-01', [{ project_id: 'BBB', dependency_type: 'required' }, { project_id: 'CCC', dependency_type: 'optional' }])];
  const srv = await startServer({});
  t.after(() => srv.close());
  const U = srv.url;
  const fix = (v) => JSON.parse(JSON.stringify(v).replace(/URL\//g, `${U}/`));
  Object.assign(srv.routes, {
    '/v2/search': (req, res, b, u) => {
      const facets = JSON.parse(u.searchParams.get('facets'));
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ hits: [{ project_id: 'AAA', slug: 'sodium', title: 'Sodium', description: 'fast', author: 'jelly', downloads: 1000, project_type: 'mod', categories: [] }], total_hits: 1, offset: 0, limit: 20, _facets: facets }));
    },
    '/v2/project/AAA/version': (req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(fix(versionsA))); },
    '/v2/project/BBB/version': () => {},
    '/v2/project/BBB': { id: 'BBB', slug: 'fabric-api', title: 'Fabric API', project_type: 'mod' },
    '/files/sodium-0.5.0.jar': fileA1,
    '/files/sodium-0.6.0.jar': fileA2,
    '/files/fabric-api.jar': fileB,
  });
  srv.routes['/v2/project/BBB/version'] = (req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(fix([ver('b1', 'BBB', '0.92', 'fabric-api.jar', fileB, '2025-01-01')]))); };

  const core = await createLauncherCore({ dataDir: path.join(dir, 'data'), config: { content: { modrinthApi: `${U}/v2`, curseforge: false } } });
  const inst = await core.instances.create({ name: 'Fabric', minecraft: '1.20.1', loader: { type: 'fabric', version: '0.16.5' } });

  const res = await core.content.search('modrinth', { instanceId: inst.id, query: 'sod' });
  assert.equal(res.hits[0].title, 'Sodium');
  const searchHit = srv.hits.find((h) => h.path === '/v2/search');
  const facets = JSON.parse(new URLSearchParams(searchHit.search).get('facets'));
  assert.deepEqual(facets, [['project_type:mod'], ['versions:1.20.1'], ['categories:fabric']]);

  const r = await core.content.install(inst.id, { provider: 'modrinth', projectId: 'AAA', title: 'Sodium' });
  assert.deepEqual(r.installed.map((e) => e.fileName), ['sodium-0.5.0.jar', 'fabric-api.jar']);
  const g = (p) => path.join(core.paths.gameDir(inst.id), p);
  assert.ok(exists(g('mods/sodium-0.5.0.jar')) && exists(g('mods/fabric-api.jar')));
  const verHit = srv.hits.find((h) => h.path === '/v2/project/AAA/version');
  assert.equal(new URLSearchParams(verHit.search).get('loaders'), '["fabric"]');

  // вышла новая версия
  versionsA = [ver('a2', 'AAA', '0.6.0', 'sodium-0.6.0.jar', fileA2, '2025-06-01'), ...versionsA];
  const ups = await core.content.checkUpdates(inst.id);
  assert.equal(ups.length, 1);
  assert.equal(ups[0].latest.versionNumber, '0.6.0');
  await core.content.update(inst.id, 'modrinth', 'AAA');
  assert.ok(exists(g('mods/sodium-0.6.0.jar')) && !exists(g('mods/sodium-0.5.0.jar')), 'старая версия удалена');

  let local = await core.content.listLocal(inst.id, 'mods');
  assert.equal(local.length, 2);
  assert.equal(local.find((f) => f.fileName === 'fabric-api.jar').entry.title, 'Fabric API');
  await core.content.setEnabled(inst.id, 'mods/fabric-api.jar', false);
  local = await core.content.listLocal(inst.id, 'mods');
  assert.equal(local.find((f) => f.path === 'mods/fabric-api.jar').enabled, false);
  await core.content.setEnabled(inst.id, 'mods/fabric-api.jar', true);

  await core.content.remove(inst.id, 'modrinth', 'AAA');
  assert.ok(!exists(g('mods/sodium-0.6.0.jar')));
  assert.equal((await core.instances.get(inst.id)).content.length, 1);
});

test('импорт .mrpack и обновление модпака', async (t) => {
  const dir = tmpDir();
  const m1 = Buffer.from('create-mod');
  const m2 = Buffer.from('jei');
  const srvMod = Buffer.from('server-only');
  const srv = await startServer({ '/f/create.jar': m1, '/f/jei.jar': m2, '/f/srv.jar': srvMod });
  t.after(() => srv.close());
  const index = (files) => JSON.stringify({ formatVersion: 1, game: 'minecraft', versionId: '1.0', name: 'Test Pack', dependencies: { minecraft: '1.20.1', forge: '47.3.0' }, files });
  const fe = (p, buf, url, env) => ({ path: p, hashes: { sha1: sha1(buf) }, fileSize: buf.length, downloads: [`${srv.url}${url}`], ...(env ? { env } : {}) });
  const pack1 = makeZip(path.join(dir, 'p1.mrpack'), {
    'modrinth.index.json': index([fe('mods/create.jar', m1, '/f/create.jar'), fe('mods/jei.jar', m2, '/f/jei.jar'), fe('mods/srv.jar', srvMod, '/f/srv.jar', { client: 'unsupported', server: 'required' })]),
    'overrides/config/create.toml': 'a=1',
    'client-overrides/options.txt': 'gamma:1',
  });
  const core = await createLauncherCore({ dataDir: path.join(dir, 'data'), config: {} });
  const r = await core.modpacks.importFile(pack1);
  const inst = r.instance;
  assert.equal(inst.name, 'Test Pack');
  assert.deepEqual(inst.loader, { type: 'forge', version: '47.3.0' });
  const g = (p) => path.join(core.paths.gameDir(inst.id), p);
  assert.ok(exists(g('mods/create.jar')) && exists(g('mods/jei.jar')));
  assert.ok(!exists(g('mods/srv.jar')), 'серверный мод не скачан');
  assert.equal(fs.readFileSync(g('config/create.toml'), 'utf8'), 'a=1');
  assert.equal(fs.readFileSync(g('options.txt'), 'utf8'), 'gamma:1');

  // v2 пака без jei — при обновлении поверх jei удаляется, а мод игрока остаётся
  fs.writeFileSync(g('mods/my-own.jar'), 'mine');
  const pack2 = makeZip(path.join(dir, 'p2.mrpack'), { 'modrinth.index.json': index([fe('mods/create.jar', m1, '/f/create.jar')]), 'overrides/config/create.toml': 'a=2' });
  await core.modpacks.importMrpack(pack2, { instanceId: inst.id });
  assert.ok(!exists(g('mods/jei.jar')), 'файл старой версии пака удалён');
  assert.ok(exists(g('mods/my-own.jar')), 'мод игрока не тронут');
  assert.equal(fs.readFileSync(g('config/create.toml'), 'utf8'), 'a=2');
});

test('CurseForge: поиск, импорт zip-модпака, файлы с запретом скачивания', async (t) => {
  const dir = tmpDir();
  const modJar = Buffer.from('cf-mod');
  const rp = Buffer.from('rp-zip');
  const srv = await startServer({});
  t.after(() => srv.close());
  const U = srv.url;
  const KEY = 'test-key';
  const json = (res, data) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ data })); };
  const authed = (fn) => (req, res, body, u) => { if (req.headers['x-api-key'] !== KEY) { res.statusCode = 403; res.end('{}'); return; } fn(req, res, body, u); };
  Object.assign(srv.routes, {
    '/v1/mods/search': authed((req, res, b, u) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ data: [{ id: 238222, name: 'JEI', slug: 'jei', summary: 'items', downloadCount: 5, classId: 6, authors: [{ name: 'mezz' }], links: { websiteUrl: 'https://www.curseforge.com/minecraft/mc-mods/jei' }, _q: u.search }], pagination: { totalCount: 1 } })); }),
    'POST /v1/mods/files': authed((req, res, body) => {
      const { fileIds } = JSON.parse(body);
      const all = {
        1001: { id: 1001, modId: 11, displayName: 'Mod 1', fileName: 'cfmod-1.0.jar', releaseType: 1, fileDate: '2025-01-01', fileLength: modJar.length, downloadUrl: `${U}/cf/cfmod-1.0.jar`, gameVersions: ['1.20.1', 'Forge'], hashes: [{ value: sha1(modJar), algo: 1 }], dependencies: [] },
        1002: { id: 1002, modId: 12, displayName: 'Blocked', fileName: 'blocked.jar', releaseType: 1, fileDate: '2025-01-01', fileLength: 10, downloadUrl: null, gameVersions: ['1.20.1', 'Forge'], hashes: [], dependencies: [] },
        1003: { id: 1003, modId: 13, displayName: 'RP', fileName: 'faithful.zip', releaseType: 1, fileDate: '2025-01-01', fileLength: rp.length, downloadUrl: `${U}/cf/faithful.zip`, gameVersions: ['1.20.1'], hashes: [{ value: sha1(rp), algo: 1 }], dependencies: [] },
      };
      json(res, fileIds.map((id) => all[id]).filter(Boolean));
    }),
    'POST /v1/mods': authed((req, res) => json(res, [
      { id: 11, name: 'CF Mod', classId: 6, links: { websiteUrl: 'https://cf/mod' } },
      { id: 12, name: 'Blocked Mod', classId: 6, links: { websiteUrl: 'https://cf/blocked' } },
      { id: 13, name: 'Faithful', classId: 12, links: { websiteUrl: 'https://cf/faithful' } },
    ])),
    '/cf/cfmod-1.0.jar': modJar,
    '/cf/faithful.zip': rp,
  });

  const core = await createLauncherCore({ dataDir: path.join(dir, 'data'), config: { curseforge: { apiKey: KEY }, content: { curseforgeApi: `${U}/v1` } } });
  assert.equal(core.content.list().find((p) => p.id === 'curseforge').available, true);
  const s = await core.content.search('curseforge', { query: 'jei', mcVersion: '1.20.1', loader: 'forge' });
  assert.equal(s.hits[0].title, 'JEI');
  const q = new URLSearchParams(srv.hits.find((h) => h.path === '/v1/mods/search').search);
  assert.equal(q.get('gameId'), '432');
  assert.equal(q.get('classId'), '6');
  assert.equal(q.get('modLoaderType'), '1');

  const zip = makeZip(path.join(dir, 'cf.zip'), {
    'manifest.json': JSON.stringify({
      manifestType: 'minecraftModpack', manifestVersion: 1, name: 'CF Pack', version: '2.0', overrides: 'overrides',
      minecraft: { version: '1.20.1', modLoaders: [{ id: 'forge-47.2.0', primary: true }] },
      files: [{ projectID: 11, fileID: 1001, required: true }, { projectID: 12, fileID: 1002, required: true }, { projectID: 13, fileID: 1003, required: true }, { projectID: 99, fileID: 9999, required: false }],
    }),
    'overrides/config/pack.cfg': 'ok',
  });
  const r = await core.modpacks.importFile(zip);
  const g = (p) => path.join(core.paths.gameDir(r.instance.id), p);
  assert.deepEqual(r.instance.loader, { type: 'forge', version: '47.2.0' });
  assert.ok(exists(g('mods/cfmod-1.0.jar')));
  assert.ok(exists(g('resourcepacks/faithful.zip')), 'ресурспак по classId попал в resourcepacks');
  assert.ok(exists(g('config/pack.cfg')));
  assert.equal(r.blocked.length, 1);
  assert.equal(r.blocked[0].url, 'https://cf/blocked/files/1002');
});

test('фильтры каталога: категории Modrinth и CurseForge', async (t) => {
  const srv = await startServer({
    '/v2/tag/category': [
      { name: 'optimization', project_type: 'mod', header: 'categories' },
      { name: 'magic', project_type: 'mod', header: 'categories' },
      { name: 'realistic', project_type: 'shader', header: 'categories' },
    ],
    '/v2/search': { hits: [], total_hits: 0, offset: 0, limit: 20 },
    '/v1/categories': { data: [{ id: 6, name: 'Mods', isClass: true }, { id: 423, name: 'Map and Information' }, { id: 412, name: 'Technology' }] },
    '/v1/mods/search': { data: [], pagination: { totalCount: 0 } },
  });
  t.after(() => srv.close());
  const core = await createLauncherCore({ dataDir: path.join(tmpDir(), 'data'), config: { curseforge: { apiKey: 'k' }, content: { modrinthApi: `${srv.url}/v2`, curseforgeApi: `${srv.url}/v1` } } });

  const mr = await core.content.categories('modrinth', 'mod');
  assert.deepEqual(mr.map((c) => [c.id, c.name]), [['optimization', 'Оптимизация'], ['magic', 'Магия']]);
  await core.content.search('modrinth', { type: 'modpack', categories: ['magic', 'optimization'], mcVersion: '1.20.1', loader: 'forge' });
  const facets = JSON.parse(new URLSearchParams(srv.hits.find((x) => x.path === '/v2/search').search).get('facets'));
  assert.deepEqual(facets, [['project_type:modpack'], ['categories:magic'], ['categories:optimization'], ['versions:1.20.1'], ['categories:forge']]);

  const cf = await core.content.categories('curseforge', 'mod');
  assert.deepEqual(cf.map((c) => c.name), ['Map and Information', 'Technology'], 'класс-категория отфильтрована, сортировка по имени');
  assert.equal(new URLSearchParams(srv.hits.find((x) => x.path === '/v1/categories').search).get('classId'), '6');
  await core.content.search('curseforge', { type: 'mod', categories: ['412'] });
  assert.equal(new URLSearchParams(srv.hits.find((x) => x.path === '/v1/mods/search').search).get('categoryIds'), '[412]');
});
