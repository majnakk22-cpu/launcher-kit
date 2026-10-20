'use strict';
// Офлайн-аккаунт: UUID считается так же, как на сервере с online-mode=false
// (UUID.nameUUIDFromBytes("OfflinePlayer:" + name)), поэтому инвентарь на сервере не "теряется".
const crypto = require('crypto');

function offlineUuid(name) {
  const b = crypto.createHash('md5').update(`OfflinePlayer:${name}`, 'utf8').digest();
  b[6] = (b[6] & 0x0f) | 0x30;
  b[8] = (b[8] & 0x3f) | 0x80;
  return b.toString('hex');
}

function validateNickname(name) {
  if (!/^[A-Za-z0-9_]{3,16}$/.test(name || '')) {
    throw new Error('Ник должен быть 3–16 символов: латиница, цифры и "_"');
  }
}

function createOfflineAccount(name) {
  validateNickname(name);
  const uuid = offlineUuid(name);
  return { id: `offline:${uuid}`, type: 'offline', name, uuid, accessToken: '0', createdAt: Date.now() };
}

/** Делает из UUID без дефисов стандартный вид 8-4-4-4-12. */
function dashUuid(u) {
  const s = u.replace(/-/g, '');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

module.exports = { offlineUuid, createOfflineAccount, validateNickname, dashUuid };
