'use strict';
// Сквозной тест конвейера запуска на фейковой версии Minecraft:
// локальный HTTP-сервер отдаёт version.json-файлы, библиотеки, нативы, ассеты и установщик "Forge",
// а вместо игры запускается маленький Java-класс, который записывает полученные аргументы.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { createLauncherCore } = require('../src/core');
const { installFromInstaller } = require('../src/core/loaders/forge-installer');
const { makeZip, startServer, compileJar, sha1, tmpDir } = require('./helpers');

let javaPath;
try { javaPath = execFileSync(process.platform === 'win32' ? 'where' : 'which', ['java']).toString().split(/\r?\n/)[0].trim(); } catch { javaPath = null; }

const FAKE_MAIN = `
package fake;
import java.io.*;
import java.util.*;
public class Main {
  public static void main(String[] args) throws Exception {
    StringBuilder sb = new StringBuilder();
    for (String a : args) sb.append("ARG ").append(a).append('\\n');
    sb.append("CP ").append(System.getProperty("java.class.path")).append('\\n');
    sb.append("LIBPATH ").append(System.getProperty("java.library.path")).append('\\n');
    sb.append("LOG4J ").append(System.getProperty("log4j.configurationFile")).append('\\n');
    sb.append("IGNORE ").append(System.getProperty("ignoreList")).append('\\n');
    sb.append("HELLO ").append(Class.forName("lib.Hello").getMethod("msg").invoke(null)).append('\\n');
    File nat = new File(System.getProperty("java.library.path"));
    String[] list = nat.list();
    if (list != null) { Arrays.sort(list); for (String n : list) sb.append("NATIVE ").append(n).append('\\n'); }
    try (Writer w = new OutputStreamWriter(new FileOutputStream("launch-result.txt"), "UTF-8")) { w.write(sb.toString()); }
    System.out.println("[fake] game started");
    System.err.println("[fake] stderr works");
    int code = Integer.getInteger("fake.exit", 0);
    System.exit(code);
  }
}`;

const HELLO = 'package lib; public class Hello { public static String msg() { return "hello-from-lib"; } }';

const PROC = `
package proc;
import java.io.*;
import java.nio.file.*;
public class Copy {
  public static void main(String[] a) throws Exception {
    String in = null, out = null, mc = null;
    for (int i = 0; i < a.length; i++) {
      if (a[i].equals("--in")) in = a[++i];
      else if (a[i].equals("--out")) out = a[++i];
      else if (a[i].equals("--mc")) mc = a[++i];
    }
    if (!new File(mc).isFile()) throw new RuntimeException("no minecraft jar " + mc);
    new File(out).getParentFile().mkdirs();
    Files.copy(Paths.get(in), Paths.get(out), StandardCopyOption.REPLACE_EXISTING);
    System.out.println("processed " + out);
  }
}`;

function parseResult(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  const args = lines.filter((l) => l.startsWith('ARG ')).map((l) => l.slice(4));
  const get = (k) => lines.find((l) => l.startsWith(`${k} `))?.slice(k.length + 1);
  return { args, cp: get('CP'), libpath: get('LIBPATH'), log4j: get('LOG4J'), ignore: get('IGNORE'), hello: get('HELLO'), natives: lines.filter((l) => l.startsWith('NATIVE ')).map((l) => l.slice(7)) };
}

test('полный запуск фейковой версии + установка "Forge" через процессоры', { skip: !javaPath && 'нет java в PATH', timeout: 120000 }, async (t) => {
  const work = tmpDir('mlk-e2e-');
  const dataDir = path.join(work, 'data');

  // ---------- артефакты ----------
  const clientJar = compileJar(path.join(work, 'build/client.jar'), { 'fake/Main.java': FAKE_MAIN });
  const libJar = compileJar(path.join(work, 'build/hello.jar'), { 'lib/Hello.java': HELLO });
  const procJar = compileJar(path.join(work, 'build/proc.jar'), { 'proc/Copy.java': PROC }, 'proc.Copy');
  const nativesJar = fs.readFileSync(makeZip(path.join(work, 'build/natives.jar'), { 'libfake.so': 'ELF', 'META-INF/MANIFEST.MF': 'Manifest-Version: 1.0\n' }));
  const assetData = Buffer.from('{"menu.play":"Играть"}');
  const assetHash = sha1(assetData);
  const assetIndex = Buffer.from(JSON.stringify({ objects: { 'minecraft/lang/ru_ru.json': { hash: assetHash, size: assetData.length } } }));
  const logXml = Buffer.from('<Configuration/>');

  const srv = await startServer({
    '/client.jar': clientJar,
    '/hello.jar': libJar,
    '/natives.jar': nativesJar,
    '/proc.jar': procJar,
    '/index.json': assetIndex,
    '/log.xml': logXml,
    [`/assets/${assetHash.slice(0, 2)}/${assetHash}`]: assetData,
  });
  t.after(() => srv.close());
  const U = srv.url;

  const vanilla = {
    id: 'fake-1.0',
    type: 'release',
    mainClass: 'fake.Main',
    javaVersion: { component: 'jre-legacy', majorVersion: 8 },
    downloads: { client: { url: `${U}/client.jar`, sha1: sha1(clientJar), size: clientJar.length } },
    assetIndex: { id: 'fake', url: `${U}/index.json`, sha1: sha1(assetIndex), size: assetIndex.length },
    assets: 'fake',
    libraries: [
      { name: 'lib:hello:1.0', downloads: { artifact: { path: 'lib/hello/1.0/hello-1.0.jar', url: `${U}/hello.jar`, sha1: sha1(libJar), size: libJar.length } } },
      { name: 'lib:fake-natives:1.0', natives: { linux: 'natives-linux', windows: 'natives-linux', osx: 'natives-linux' }, extract: { exclude: ['META-INF/'] },
        downloads: { classifiers: { 'natives-linux': { path: 'lib/fake-natives/1.0/fake-natives-1.0-natives.jar', url: `${U}/natives.jar`, sha1: sha1(nativesJar), size: nativesJar.length } } } },
      { name: 'lib:only-on-mars:1.0', rules: [{ action: 'allow', os: { name: 'mars' } }], downloads: { artifact: { path: 'x.jar', url: `${U}/missing.jar` } } },
    ],
    arguments: {
      game: ['--username', '${auth_player_name}', '--uuid', '${auth_uuid}', '--accessToken', '${auth_access_token}', '--userType', '${user_type}',
        '--version', '${version_name}', '--gameDir', '${game_directory}', '--assetsDir', '${assets_root}', '--assetIndex', '${assets_index_name}',
        { rules: [{ action: 'allow', features: { has_custom_resolution: true } }], value: ['--width', '${resolution_width}', '--height', '${resolution_height}'] },
        { rules: [{ action: 'allow', features: { is_demo_user: true } }], value: '--demo' }],
      jvm: ['-Djava.library.path=${natives_directory}', '-cp', '${classpath}'],
    },
    logging: { client: { argument: '-Dlog4j.configurationFile=${path}', file: { id: 'client-fake.xml', url: `${U}/log.xml`, sha1: sha1(logXml), size: logXml.length }, type: 'log4j2-xml' } },
  };
  fs.mkdirSync(path.join(dataDir, 'versions/fake-1.0'), { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'versions/fake-1.0/fake-1.0.json'), JSON.stringify(vanilla));

  const core = await createLauncherCore({
    dataDir,
    config: { id: 'test-launcher', launcherBrand: 'test-launcher', mirrors: { 'https://resources.download.minecraft.net/': `${U}/assets/` } },
  });
  const logs = [];
  core.on('log', (l) => logs.push(l));
  const account = await core.accounts.addOffline('Tester');

  const runGame = (instanceId) => new Promise((resolve, reject) => {
    const gameLog = [];
    const offLog = core.on('game-log', (l) => { if (l.instanceId === instanceId) gameLog.push(l); });
    const offExit = core.on('game-exit', (e) => { if (e.instanceId === instanceId) { offLog(); offExit(); resolve({ ...e, gameLog }); } });
    core.launcher.launch(instanceId).catch((e) => { offLog(); offExit(); reject(e); });
  });

  // ---------- 1. Ванильная фейковая версия ----------
  const inst = await core.instances.create({ name: 'E2E Vanilla', minecraft: 'fake-1.0', java: { path: javaPath, maxMemory: 768 }, window: { width: 1000, height: 700 } });
  const exit = await runGame(inst.id);
  assert.equal(exit.code, 0, `игра завершилась с ошибкой: ${JSON.stringify(exit.tail)}\n${logs.map((l) => l.message).join('\n')}`);
  assert.ok(exit.gameLog.some((l) => l.line.includes('[fake] game started') && l.stream === 'stdout'));
  assert.ok(exit.gameLog.some((l) => l.line.includes('[fake] stderr works') && l.stream === 'stderr'));

  const gameDir = core.paths.gameDir(inst.id);
  const r = parseResult(path.join(gameDir, 'launch-result.txt'));
  const argVal = (k) => r.args[r.args.indexOf(k) + 1];
  assert.equal(argVal('--username'), 'Tester');
  assert.equal(argVal('--uuid'), account.uuid);
  assert.equal(argVal('--userType'), 'legacy');
  assert.equal(argVal('--version'), 'fake-1.0');
  assert.equal(argVal('--gameDir'), gameDir);
  assert.equal(argVal('--assetIndex'), 'fake');
  assert.equal(argVal('--width'), '1000');
  assert.ok(!r.args.includes('--demo'));
  assert.equal(r.hello, 'hello-from-lib');
  assert.ok(r.cp.endsWith(path.join('versions', 'fake-1.0', 'fake-1.0.jar')), 'client jar последний в classpath');
  assert.ok(!r.cp.includes('x.jar'), 'библиотека с чужой ОС не попала в classpath');
  assert.deepEqual(r.natives, ['libfake.so'], 'нативы распакованы, META-INF исключён');
  assert.equal(r.log4j, core.paths.logConfig('client-fake.xml'));
  assert.ok(fs.existsSync(core.paths.assetObject(assetHash)), 'ассет скачан');
  const updated = await core.instances.get(inst.id);
  assert.ok(updated.lastPlayed > 0);

  // повторный запуск не качает заново
  const hitsBefore = srv.hits.length;
  const exit2 = await runGame(inst.id);
  assert.equal(exit2.code, 0);
  assert.equal(srv.hits.length, hitsBefore, 'второй запуск без сетевых запросов');

  // вылет: код выхода + хвост лога
  await core.instances.update(inst.id, { java: { args: ['-Dfake.exit=3'] } });
  const crash = await runGame(inst.id);
  assert.equal(crash.code, 3);
  assert.ok(crash.tail.some((l) => l.includes('game started')));
  await core.instances.update(inst.id, { java: { args: [] } });

  // ---------- 2. "Forge" через installer + processors ----------
  const patched = Buffer.from('PATCHED-CLIENT-CONTENT');
  const bundled = compileJar(path.join(work, 'build/bundled.jar'), { 'bundled/B.java': 'package bundled; public class B {}' });
  const forgeVersion = {
    id: 'fake-1.0-forge-1',
    inheritsFrom: 'fake-1.0',
    mainClass: 'fake.Main',
    libraries: [
      { name: 'com.test:patched:1.0:client', downloads: { artifact: { path: 'com/test/patched/1.0/patched-1.0-client.jar', url: '', sha1: sha1(patched), size: patched.length } } },
      { name: 'com.test:bundled:1.0', downloads: { artifact: { path: 'com/test/bundled/1.0/bundled-1.0.jar', url: '', sha1: sha1(bundled), size: bundled.length } } },
    ],
    arguments: { game: ['--fml.forgeVersion', '1'], jvm: ['-DignoreList=client-extra,${version_name}.jar'] },
  };
  const profile = {
    spec: 1,
    profile: 'forge',
    version: 'fake-1.0-forge-1',
    minecraft: 'fake-1.0',
    json: '/version.json',
    data: {
      BINPATCH: { client: '/data/client.lzma', server: '/data/server.lzma' },
      PATCHED: { client: '[com.test:patched:1.0:client]', server: '[x:y:1]' },
      PATCHED_SHA: { client: `'${sha1(patched)}'`, server: "'0'" },
    },
    processors: [
      { sides: ['client'], jar: 'com.test:proc:1.0', classpath: [], args: ['--in', '{BINPATCH}', '--out', '{PATCHED}', '--mc', '{MINECRAFT_JAR}'], outputs: { '{PATCHED}': '{PATCHED_SHA}' } },
      { sides: ['server'], jar: 'does.not:exist:1', classpath: [], args: [] },
    ],
    libraries: [{ name: 'com.test:proc:1.0', downloads: { artifact: { path: 'com/test/proc/1.0/proc-1.0.jar', url: `${U}/proc.jar`, sha1: sha1(procJar), size: procJar.length } } }],
  };
  const installerPath = makeZip(path.join(work, 'build/forge-installer.jar'), {
    'install_profile.json': JSON.stringify(profile),
    'version.json': JSON.stringify(forgeVersion),
    'data/client.lzma': patched,
    'maven/com/test/bundled/1.0/bundled-1.0.jar': bundled,
  });
  let installs = 0;
  core.loaders.register({
    id: 'testforge',
    name: 'TestForge',
    listVersions: async () => [{ version: '1', stable: true }],
    install: (ctx, mc, v, opts) => { installs++; return installFromInstaller(ctx, { installerPath, getJava: opts.getJava, onProgress: opts.onProgress }); },
  });

  const fi = await core.instances.create({ name: 'E2E Forge', minecraft: 'fake-1.0', loader: { type: 'testforge', version: 'latest' }, java: { path: javaPath } });
  const fexit = await runGame(fi.id);
  assert.equal(fexit.code, 0, JSON.stringify(fexit.tail));
  const fr = parseResult(path.join(core.paths.gameDir(fi.id), 'launch-result.txt'));
  assert.ok(fr.args.includes('--fml.forgeVersion'), 'аргументы ребёнка добавлены');
  assert.ok(fr.args.includes('--username'), 'аргументы родителя сохранены');
  assert.equal(fr.ignore, 'client-extra,fake-1.0-forge-1.jar');
  assert.ok(fr.cp.includes(path.join('versions', 'fake-1.0-forge-1', 'fake-1.0-forge-1.jar')), 'jar скопирован под имя версии модлоадера');
  assert.ok(fr.cp.includes('patched-1.0-client.jar') && fr.cp.includes('bundled-1.0.jar'));
  assert.equal(fs.readFileSync(core.paths.library('com/test/patched/1.0/patched-1.0-client.jar'), 'utf8'), patched.toString());
  assert.equal((await core.instances.get(fi.id)).loader.version, '1', '"latest" зафиксирован в конкретную версию');

  // второй запуск — без переустановки
  const fexit2 = await runGame(fi.id);
  assert.equal(fexit2.code, 0);
  assert.equal(installs, 1, 'модлоадер установлен один раз');

  // если сгенерированный файл пропал — переустановка
  fs.rmSync(core.paths.library('com/test/patched/1.0/patched-1.0-client.jar'));
  const fexit3 = await runGame(fi.id);
  assert.equal(fexit3.code, 0);
  assert.equal(installs, 2, 'переустановка при потере файлов');

  fs.rmSync(work, { recursive: true, force: true });
});
