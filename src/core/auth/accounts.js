'use strict';
// Хранилище аккаунтов. Токены шифруются функциями encrypt/decrypt, которые передаёт оболочка
// (в Electron — safeStorage, привязанный к пользователю ОС). В CLI без шифрования.
const path = require('path');
const { readJson, writeJson } = require('../util/fs');
const { createOfflineAccount } = require('./offline');
const { MicrosoftAuth } = require('./microsoft');

const SECRET_FIELDS = ['accessToken', 'msRefreshToken'];

class AccountStore {
  constructor(ctx, { encrypt = (s) => s, decrypt = (s) => s, microsoftClientId } = {}) {
    this.ctx = ctx;
    this.file = path.join(ctx.paths.root, 'accounts.json');
    this.encrypt = encrypt;
    this.decrypt = decrypt;
    this.microsoft = new MicrosoftAuth({ clientId: microsoftClientId });
  }

  async _load() { return readJson(this.file, { activeId: null, accounts: [] }); }
  async _save(data) { await writeJson(this.file, data); }

  _pack(acc) {
    const pub = { ...acc };
    const secret = {};
    for (const k of SECRET_FIELDS) { if (k in pub) { secret[k] = pub[k]; delete pub[k]; } }
    pub.secret = this.encrypt(JSON.stringify(secret));
    return pub;
  }

  _unpack(stored) {
    const { secret, ...pub } = stored;
    let s = {};
    try { s = JSON.parse(this.decrypt(secret)); } catch { /* повреждено — потребуется перелогин */ }
    return { ...pub, ...s };
  }

  static publicView(a) {
    const { secret, accessToken, msRefreshToken, ...pub } = a;
    return pub;
  }

  async list() {
    const d = await this._load();
    return { activeId: d.activeId, accounts: d.accounts.map(AccountStore.publicView) };
  }

  async save(account) {
    const d = await this._load();
    const packed = this._pack(account);
    const i = d.accounts.findIndex((a) => a.id === account.id);
    if (i >= 0) d.accounts[i] = packed; else d.accounts.push(packed);
    if (!d.activeId) d.activeId = account.id;
    await this._save(d);
    return AccountStore.publicView(account);
  }

  async addOffline(name) {
    const acc = createOfflineAccount(name);
    const saved = await this.save(acc);
    await this.setActive(acc.id);
    return saved;
  }

  /** Возвращает { userCode, verificationUri, message, wait(): Promise<publicAccount>, cancel } */
  async startMicrosoftLogin() {
    const flow = await this.microsoft.startDeviceLogin();
    return {
      ...flow,
      wait: async () => {
        const acc = await flow.wait();
        const saved = await this.save(acc);
        await this.setActive(acc.id);
        return saved;
      },
    };
  }

  async remove(id) {
    const d = await this._load();
    d.accounts = d.accounts.filter((a) => a.id !== id);
    if (d.activeId === id) d.activeId = d.accounts[0]?.id || null;
    await this._save(d);
  }

  async setActive(id) {
    const d = await this._load();
    if (!d.accounts.some((a) => a.id === id)) throw new Error('Аккаунт не найден');
    d.activeId = id;
    await this._save(d);
  }

  /** Полный аккаунт с актуальным токеном — для запуска игры. */
  async getForLaunch(id) {
    const d = await this._load();
    const stored = d.accounts.find((a) => a.id === (id || d.activeId));
    if (!stored) throw new Error('Не выбран аккаунт — добавь его во вкладке «Аккаунты»');
    let acc = this._unpack(stored);
    if (acc.type === 'microsoft') {
      const fresh = await this.microsoft.ensureFresh(acc);
      if (fresh !== acc) { acc = fresh; await this.save(acc); }
    }
    return acc;
  }
}

module.exports = { AccountStore };
