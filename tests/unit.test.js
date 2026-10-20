'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { isAllowed } = require('../src/core/minecraft/rules');
const { mavenPath, mavenKey } = require('../src/core/util/maven');
const { mergeVersions } = require('../src/core/minecraft/versions');
const { collectLibraries, fixRepoUrl } = require('../src/core/minecraft/libraries');
const { buildLaunchArguments, supportsQuickPlay } = require('../src/core/minecraft/arguments');
const { offlineUuid, validateNickname } = require('../src/core/auth/offline');
const { resolveToken } = require('../src/core/loaders/forge-installer');
const { neoforgePrefix, compareVersions } = require('../src/core/loaders/forge');
const { slugify } = require('../src/core/instances/instances');
const { safeJoin } = require('../src/core/util/fs');
const { globToRegex, validateManifest } = require('../src/core/instances/sync');
const { varint, readVarint, flattenChat } = require('../src/core/util/server-ping');
const { loaderFromCurseId, loaderFromMrpackDeps } = require('../src/core/content/modpacks');
const { pickBestVersion } = require('../src/core/content');
const { LauncherPaths } = require('../src/core/paths');
const { rewriteUrl, setMirrors } = require('../src/core/util/http');

const WIN = { osName: 'windows', arch: 'x86_64', osRelease: '10.0', archBits: '64' };
const LINUX = { osName: 'linux', arch: 'x86_64', osRelease: '6.1', archBits: '64' };
const MAC = { osName: 'osx', arch: 'arm64', osRelease: '23.0', archBits: '64' };

test('rules: ОС и features', () => {
  const rules = [{ action: 'allow' }, { action: 'disallow', os: { name: 'osx' } }];
  assert.equal(isAllowed(rules, {}, WIN), true);
  assert.equal(isAllowed(rules, {}, MAC), false);
  assert.equal(isAllowed([{ action: 'allow', os: { name: 'windows' } }], {}, LINUX), false);
  assert.equal(isAllowed([{ action: 'allow', features: { is_demo_user: true } }], {}, WIN), false);
  assert.equal(isAllowed([{ action: 'allow', features: { has_custom_resolution: true } }], { has_custom_resolution: true }, WIN), true);
  assert.equal(isAllowed([{ action: 'allow', os: { arch: 'x86' } }], {}, WIN), false);
  assert.equal(isAllowed(undefined), true);
});

test('maven: путь и ключ', () => {
  assert.equal(mavenPath('net.fabricmc:fabric-loader:0.16.5'), 'net/fabricmc/fabric-loader/0.16.5/fabric-loader-0.16.5.jar');
  assert.equal(mavenPath('org.lwjgl:lwjgl:3.3.1:natives-windows'), 'org/lwjgl/lwjgl/3.3.1/lwjgl-3.3.1-natives-windows.jar');
  assert.equal(mavenPath('de.oceanlabs.mcp:mcp_config:1.20.1-20230612.114412@zip'), 'de/oceanlabs/mcp/mcp_config/1.20.1-20230612.114412/mcp_config-1.20.1-20230612.114412.zip');
  assert.equal(mavenKey('org.ow2.asm:asm:9.6'), 'org.ow2.asm:asm');
  assert.equal(mavenKey('org.lwjgl:lwjgl:3.3.1:natives-linux'), 'org.lwjgl:lwjgl:natives-linux');
  assert.equal(fixRepoUrl('http://files.minecraftforge.net/maven/'), 'https://maven.minecraftforge.net/');
  assert.equal(fixRepoUrl('https://maven.fabricmc.net'), 'https://maven.fabricmc.net/');
});

test('mergeVersions: библиотеки ребёнка в приоритете, аргументы склеиваются', () => {
  const parent = {
    id: '1.20.1', mainClass: 'net.minecraft.client.main.Main', assetIndex: { id: '5' }, downloads: { client: { url: 'x' } },
    libraries: [{ name: 'org.ow2.asm:asm:9.3' }, { name: 'com.mojang:brigadier:1.1.8' }],
    arguments: { game: ['--username', '${auth_player_name}'], jvm: ['-cp', '${classpath}'] },
  };
  const child = {
    id: 'fabric-loader-0.16.5-1.20.1', inheritsFrom: '1.20.1', mainClass: 'net.fabricmc.loader.impl.launch.knot.KnotClient',
    libraries: [{ name: 'org.ow2.asm:asm:9.7' }, { name: 'net.fabricmc:fabric-loader:0.16.5' }],
    arguments: { game: [], jvm: ['-DFabricMcEmu= net.minecraft.client.main.Main '] },
  };
  const m = mergeVersions({ ...parent, _chain: ['1.20.1'], _vanilla: '1.20.1' }, child);
  assert.equal(m.id, child.id);
  assert.equal(m.mainClass, child.mainClass);
  assert.equal(m._vanilla, '1.20.1');
  assert.deepEqual(m.libraries.map((l) => l.name), ['org.ow2.asm:asm:9.7', 'net.fabricmc:fabric-loader:0.16.5', 'com.mojang:brigadier:1.1.8']);
  assert.deepEqual(m.arguments.jvm, ['-cp', '${classpath}', '-DFabricMcEmu= net.minecraft.client.main.Main ']);
  assert.equal(m.assetIndex.id, '5');
  assert.ok(m.downloads.client);

  // одинаковые библиотеки внутри одной версии (разные rules для разных ОС) сохраняются
  const p2 = { id: '1.12.2', libraries: [
    { name: 'org.lwjgl.lwjgl:lwjgl:2.9.4-nightly-20150209', rules: [{ action: 'allow' }, { action: 'disallow', os: { name: 'osx' } }] },
    { name: 'org.lwjgl.lwjgl:lwjgl:2.9.2-nightly-20140822', rules: [{ action: 'allow', os: { name: 'osx' } }] },
  ] };
  const m2 = mergeVersions(p2, { id: '1.12.2-forge', libraries: [{ name: 'net.minecraftforge:forge:1.12.2-14.23.5.2860' }] });
  assert.equal(m2.libraries.length, 3);
});

test('collectLibraries: artifact, maven-стиль, legacy natives, сгенерированные', () => {
  const paths = new LauncherPaths('/data');
  const v = {
    libraries: [
      { name: 'a:b:1', downloads: { artifact: { path: 'a/b/1/b-1.jar', url: 'https://x/b.jar', sha1: 'aa', size: 1 } } },
      { name: 'net.fabricmc:fabric-loader:0.16.5', url: 'https://maven.fabricmc.net/' },
      { name: 'org.lwjgl.lwjgl:lwjgl-platform:2.9.4', natives: { linux: 'natives-linux', windows: 'natives-windows-${arch}' }, extract: { exclude: ['META-INF/'] },
        downloads: { classifiers: { 'natives-linux': { path: 'l/lin.jar', url: 'https://x/lin.jar', sha1: 'bb', size: 2 }, 'natives-windows-64': { path: 'l/win64.jar', url: 'https://x/win.jar', sha1: 'cc', size: 3 } } } },
      { name: 'net.minecraftforge:forge:1.20.1-47.3.0:client', downloads: { artifact: { path: 'f/client.jar', url: '', sha1: 'dd', size: 4 } } },
      { name: 'only:windows:1', rules: [{ action: 'allow', os: { name: 'windows' } }], downloads: { artifact: { path: 'w.jar', url: 'https://x/w.jar' } } },
    ],
  };
  const lin = collectLibraries(v, paths, { env: LINUX });
  assert.equal(lin.classpath.length, 3);
  assert.ok(lin.classpath.includes(paths.library('net/fabricmc/fabric-loader/0.16.5/fabric-loader-0.16.5.jar')));
  assert.equal(lin.natives.length, 1);
  assert.equal(lin.natives[0].path, paths.library('l/lin.jar'));
  assert.deepEqual(lin.generated, [paths.library('f/client.jar')]);
  assert.ok(lin.downloads.some((d) => d.url === 'https://maven.fabricmc.net/net/fabricmc/fabric-loader/0.16.5/fabric-loader-0.16.5.jar'));
  const win = collectLibraries(v, paths, { env: WIN });
  assert.equal(win.natives[0].path, paths.library('l/win64.jar'));
  assert.ok(win.classpath.includes(paths.library('w.jar')));
});

test('аргументы: новый формат с rules и features', () => {
  const v = {
    mainClass: 'Main',
    arguments: {
      jvm: ['-Djava.library.path=${natives_directory}', { rules: [{ action: 'allow', os: { name: 'osx' } }], value: ['-XstartOnFirstThread'] }, '-cp', '${classpath}'],
      game: ['--username', '${auth_player_name}', '--uuid', '${auth_uuid}',
        { rules: [{ action: 'allow', features: { has_custom_resolution: true } }], value: ['--width', '${resolution_width}', '--height', '${resolution_height}'] },
        { rules: [{ action: 'allow', features: { is_quick_play_multiplayer: true } }], value: ['--quickPlayMultiplayer', '${quickPlayMultiplayer}'] }],
    },
    logging: { client: { argument: '-Dlog4j.configurationFile=${path}' } },
  };
  const vars = { natives_directory: '/n', classpath: 'a:b', auth_player_name: 'Steve', auth_uuid: 'u', resolution_width: 800, resolution_height: 600, quickPlayMultiplayer: 'host:25565' };
  assert.equal(supportsQuickPlay(v), true);
  const args = buildLaunchArguments(v, { vars, features: { has_custom_resolution: true, is_quick_play_multiplayer: true }, env: LINUX, memory: { min: 512, max: 2048 }, logConfigPath: '/l.xml', server: { address: 'host', port: 25565 } });
  assert.deepEqual(args, ['-Xms512M', '-Xmx2048M', '-Dlog4j.configurationFile=/l.xml', '-Djava.library.path=/n', '-cp', 'a:b', 'Main',
    '--username', 'Steve', '--uuid', 'u', '--width', '800', '--height', '600', '--quickPlayMultiplayer', 'host:25565']);
  const mac = buildLaunchArguments(v, { vars, env: MAC });
  assert.ok(mac.includes('-XstartOnFirstThread'));
});

test('аргументы: старый формат minecraftArguments + --server', () => {
  const v = { mainClass: 'net.minecraft.launchwrapper.Launch', minecraftArguments: '--username ${auth_player_name} --session ${auth_session} --tweakClass cpw.mods.fml.common.launcher.FMLTweaker' };
  const args = buildLaunchArguments(v, {
    vars: { auth_player_name: 'Alex', auth_session: 'token:0:u', natives_directory: '/n', classpath: 'c', launcher_name: 'L', launcher_version: '1' },
    env: WIN,
    server: { address: 'mc.example.com', port: 25570 },
  });
  assert.equal(args[0], '-XX:HeapDumpPath=MojangTricksIntelDriversForPerformance_javaw.exe_minecraft.exe.heapdump');
  assert.ok(args.includes('-Djava.library.path=/n'));
  const i = args.indexOf('net.minecraft.launchwrapper.Launch');
  assert.deepEqual(args.slice(i + 1), ['--username', 'Alex', '--session', 'token:0:u', '--tweakClass', 'cpw.mods.fml.common.launcher.FMLTweaker', '--server', 'mc.example.com', '--port', '25570']);
});

test('офлайн UUID совпадает с Java UUID.nameUUIDFromBytes', () => {
  // значения получены из Java: UUID.nameUUIDFromBytes(("OfflinePlayer:" + name).getBytes(UTF_8))
  assert.equal(offlineUuid('Notch'), 'b50ad385829d3141a2167e7d7539ba7f');
  assert.equal(offlineUuid('Steve'), '5627dd98e6be3c21b8a8e92344183641');
  assert.throws(() => validateNickname('ab'));
  assert.throws(() => validateNickname('Ник'));
  validateNickname('Majn_22');
});

test('forge: токены процессоров и версии', () => {
  const lib = (c) => `/lib/${mavenPath(c)}`;
  const data = { SIDE: 'client', MAPPINGS: '/tmp/m.txt' };
  assert.equal(resolveToken('{SIDE}', data, lib), 'client');
  assert.equal(resolveToken('[net.minecraft:client:1.20.1:srg]', data, lib), '/lib/net/minecraft/client/1.20.1/client-1.20.1-srg.jar');
  assert.equal(resolveToken("'abc'", data, lib), 'abc');
  assert.equal(resolveToken('--x={MAPPINGS}', data, lib), '--x=/tmp/m.txt');
  assert.throws(() => resolveToken('{NOPE}', data, lib));
  assert.equal(neoforgePrefix('1.21.1'), '21.1.');
  assert.equal(neoforgePrefix('1.21'), '21.0.');
  assert.equal(neoforgePrefix('1.20.4'), '20.4.');
  assert.ok(compareVersions('47.3.10', '47.3.2') > 0);
  assert.ok(compareVersions('10.13.4.1614-1.7.10', '10.13.4.1558-1.7.10') > 0);
});

test('утилиты: slugify, safeJoin, glob, varint, chat', () => {
  assert.equal(slugify('Нулевая Зона 2'), 'nulevaya-zona-2');
  assert.equal(slugify('My Pack!!'), 'my-pack');
  assert.throws(() => safeJoin('/base', '../etc/passwd'));
  assert.throws(() => safeJoin('/base', '/abs'));
  assert.throws(() => safeJoin('/base', 'C:/win'));
  assert.equal(safeJoin('/base', 'mods/a.jar'), path.resolve('/base/mods/a.jar'));
  assert.ok(globToRegex('mods/optifine*.jar').test('mods/OptiFine_1.20.1.jar'));
  assert.ok(!globToRegex('mods/*.jar').test('mods/sub/x.jar'));
  assert.ok(globToRegex('config/**').test('config/a/b.toml'));
  for (const n of [0, 1, 127, 128, 300, 25565, 767, 2097151]) assert.equal(readVarint(varint(n), 0).value, n);
  assert.equal(flattenChat({ text: 'Hi ', extra: [{ text: 'there' }, '!'] }), 'Hi there!');
  assert.throws(() => validateManifest({ minecraft: '1.20.1', files: [{ path: '../x' }] }));
});

test('модпаки: определение модлоадера', () => {
  assert.deepEqual(loaderFromCurseId('forge-47.2.0'), { type: 'forge', version: '47.2.0' });
  assert.deepEqual(loaderFromCurseId('fabric-0.15.11'), { type: 'fabric', version: '0.15.11' });
  assert.deepEqual(loaderFromCurseId('neoforge-47.1.106', '1.20.1'), { type: 'neoforge', version: '1.20.1-47.1.106' });
  assert.deepEqual(loaderFromMrpackDeps({ minecraft: '1.21.1', neoforge: '21.1.72' }), { type: 'neoforge', version: '21.1.72' });
  assert.deepEqual(loaderFromMrpackDeps({ minecraft: '1.20.1', 'fabric-loader': '0.16.5' }), { type: 'fabric', version: '0.16.5' });
  assert.deepEqual(loaderFromMrpackDeps({ minecraft: '1.20.1' }), { type: 'vanilla', version: null });
});

test('выбор лучшей версии: релиз важнее свежей беты', () => {
  const v = (id, releaseType, date) => ({ id, releaseType, date, files: [{}] });
  assert.equal(pickBestVersion([v('b', 'beta', '2026-02-01'), v('r1', 'release', '2025-01-01'), v('r2', 'release', '2025-06-01')]).id, 'r2');
  assert.equal(pickBestVersion([v('a', 'alpha', '2026-01-01'), v('b', 'beta', '2025-01-01')]).id, 'b');
  assert.equal(pickBestVersion([]), null);
});

test('зеркала: замена префикса URL', () => {
  setMirrors({ 'https://libraries.minecraft.net/': 'https://mirror.example/libs/' });
  assert.equal(rewriteUrl('https://libraries.minecraft.net/a/b.jar'), 'https://mirror.example/libs/a/b.jar');
  assert.equal(rewriteUrl('https://other/a'), 'https://other/a');
  setMirrors({});
});

test('пинг сервера: Server List Ping на локальном TCP', async () => {
  const net = require('net');
  const { pingServer } = require('../src/core/util/server-ping');
  const server = net.createServer((sock) => {
    let got = Buffer.alloc(0);
    sock.on('data', (d) => {
      got = Buffer.concat([got, d]);
      // ждём handshake + status request, затем отвечаем
      if (got.length < 5) return;
      const json = Buffer.from(JSON.stringify({ version: { name: '1.20.1', protocol: 763 }, players: { online: 3, max: 20, sample: [{ name: 'Majn' }] }, description: { text: '§aНулевая ', extra: [{ text: 'зона' }] } }));
      const body = Buffer.concat([varint(0), varint(json.length), json]);
      sock.write(Buffer.concat([varint(body.length), body]));
    });
    sock.on('error', () => {});
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const r = await pingServer('127.0.0.1', server.address().port);
  server.close();
  assert.equal(r.online, 3);
  assert.equal(r.max, 20);
  assert.deepEqual(r.players, ['Majn']);
  assert.equal(r.motd, '§aНулевая зона');
  assert.equal(r.version, '1.20.1');
});
