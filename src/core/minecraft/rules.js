'use strict';
// Проверка "rules" из version.json (ОС, архитектура, features).
const platform = require('../util/platform');

function ruleMatches(rule, features = {}, env = {}) {
  const osName = env.osName || platform.mcOsName();
  const arch = env.arch || platform.mcArch();
  const release = env.osRelease || platform.osRelease();
  if (rule.os) {
    if (rule.os.name && rule.os.name !== osName) return false;
    if (rule.os.arch && rule.os.arch !== arch) return false;
    if (rule.os.version) {
      try { if (!new RegExp(rule.os.version).test(release)) return false; } catch { return false; }
    }
  }
  if (rule.features) {
    for (const [k, v] of Object.entries(rule.features)) if (Boolean(features[k]) !== Boolean(v)) return false;
  }
  return true;
}

/** Без правил — разрешено. С правилами — побеждает последнее совпавшее (как в лаунчере Mojang). */
function isAllowed(rules, features = {}, env = {}) {
  if (!Array.isArray(rules) || rules.length === 0) return true;
  let allowed = false;
  for (const r of rules) if (ruleMatches(r, features, env)) allowed = r.action === 'allow';
  return allowed;
}

module.exports = { isAllowed, ruleMatches };
