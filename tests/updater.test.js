'use strict';
// Самообновление лаунчера: сравнение версий и проверка по JSON.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Updater, compareSemver } = require('../src/main/updater');
const { startServer } = require('./helpers');

test('сравнение версий', () => {
  assert.ok(compareSemver('0.2.0', '0.1.9') > 0);
  assert.ok(compareSemver('v1.10.0', '1.9.3') > 0);
  assert.equal(compareSemver('1.0.0', '1.0'), 0);
  assert.ok(compareSemver('0.1.0', '0.1.1') < 0);
});

test('проверка обновления по JSON', async (t) => {
  const srv = await startServer({ '/u.json': { version: '0.3.0', notes: 'Новое', page: 'https://example.com/rel', windows: { url: 'https://example.com/s.exe' }, linux: { url: 'https://example.com/a.AppImage' }, mac: { url: 'https://example.com/a.dmg' } } });
  t.after(() => srv.close());
  const opened = [];
  const u = new Updater({ config: { updates: { url: `${srv.url}/u.json` } }, currentVersion: '0.2.0', core: {}, app: { isPackaged: true, quit() {} }, shell: { openExternal: async (x) => opened.push(x) } });
  const info = await u.check();
  assert.equal(info.available, true);
  assert.equal(info.latest, '0.3.0');
  assert.equal(info.canInstall, process.platform === 'win32');
  if (process.platform !== 'win32') {
    const r = await u.install();
    assert.equal(r.opened, true);
    assert.equal(opened[0], 'https://example.com/rel');
  }
  const same = new Updater({ config: { updates: { url: `${srv.url}/u.json` } }, currentVersion: '0.3.0', core: {}, app: { isPackaged: true }, shell: {} });
  assert.equal((await same.check()).available, false);
  const none = new Updater({ config: {}, currentVersion: '0.1.0', core: {}, app: {}, shell: {} });
  assert.equal((await none.check()).available, false);
});
