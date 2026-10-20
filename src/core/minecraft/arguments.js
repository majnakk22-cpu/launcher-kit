'use strict';
// Сборка аргументов JVM и игры из version.json (новый формат "arguments" и старый "minecraftArguments").
const { isAllowed } = require('./rules');
const platform = require('../util/platform');

function substitute(str, vars) {
  return String(str).replace(/\$\{([a-zA-Z0-9_]+)\}/g, (m, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m));
}

function expandList(list, vars, features, env) {
  const out = [];
  for (const a of list || []) {
    if (typeof a === 'string') { out.push(substitute(a, vars)); continue; }
    if (!a || !isAllowed(a.rules, features, env)) continue;
    const vals = Array.isArray(a.value) ? a.value : [a.value];
    for (const v of vals) out.push(substitute(v, vars));
  }
  return out;
}

function supportsQuickPlay(version) {
  return JSON.stringify(version.arguments?.game || []).includes('is_quick_play_multiplayer');
}

/**
 * opts: {
 *   vars: { auth_player_name, auth_uuid, ... },
 *   features: { has_custom_resolution, is_quick_play_multiplayer, ... },
 *   memory: { min, max } (МБ), extraJvm: [], extraGame: [],
 *   logConfigPath, server: { address, port }
 * }
 * Возвращает массив аргументов для java: [...jvm, mainClass, ...game]
 */
function buildLaunchArguments(version, opts) {
  const { vars, features = {}, env = {}, memory = {}, extraJvm = [], extraGame = [], server = null, logConfigPath = null } = opts;
  const osName = env.osName || platform.mcOsName();
  let jvm;
  let game;

  if (version.arguments) {
    jvm = expandList(version.arguments.jvm, vars, features, env);
    game = expandList(version.arguments.game, vars, features, env);
  } else {
    jvm = [];
    if (osName === 'osx') jvm.push('-XstartOnFirstThread');
    if (osName === 'windows') jvm.push('-XX:HeapDumpPath=MojangTricksIntelDriversForPerformance_javaw.exe_minecraft.exe.heapdump');
    jvm.push(
      substitute('-Djava.library.path=${natives_directory}', vars),
      substitute('-Dminecraft.launcher.brand=${launcher_name}', vars),
      substitute('-Dminecraft.launcher.version=${launcher_version}', vars),
      '-cp', substitute('${classpath}', vars),
    );
    game = String(version.minecraftArguments || '').split(/\s+/).filter(Boolean).map((a) => substitute(a, vars));
    if (features.has_custom_resolution) game.push('--width', String(vars.resolution_width), '--height', String(vars.resolution_height));
  }

  // Подключение к серверу: quickPlay (1.20+) уже добавлен через features; иначе старые --server/--port
  if (server?.address && !features.is_quick_play_multiplayer) {
    game.push('--server', server.address, '--port', String(server.port || 25565));
  }

  const pre = [];
  if (memory.min) pre.push(`-Xms${memory.min}M`);
  if (memory.max) pre.push(`-Xmx${memory.max}M`);
  if (logConfigPath && version.logging?.client?.argument) {
    pre.push(version.logging.client.argument.replace('${path}', logConfigPath));
  }

  return [...pre, ...extraJvm, ...jvm, version.mainClass, ...game, ...extraGame];
}

module.exports = { buildLaunchArguments, substitute, expandList, supportsQuickPlay };
