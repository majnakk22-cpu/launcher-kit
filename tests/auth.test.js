'use strict';
// Вход через Microsoft: вся цепочка (device code -> Xbox -> XSTS -> Minecraft -> профиль) на mock-сервере.
// Реальные адреса подменяются через механизм зеркал (config.mirrors).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createLauncherCore } = require('../src/core');
const { startServer, tmpDir } = require('./helpers');

test('Microsoft device code: вход, хранение токенов, обновление', async (t) => {
  let polls = 0;
  let tokenCalls = 0;
  const srv = await startServer({});
  t.after(() => srv.close());
  const json = (res, data, status = 200) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data)); };
  Object.assign(srv.routes, {
    'POST /ms/consumers/oauth2/v2.0/devicecode': (req, res, body) => {
      const f = new URLSearchParams(body);
      assert.equal(f.get('client_id'), 'test-client');
      json(res, { device_code: 'DEV', user_code: 'ABCD-1234', verification_uri: 'https://microsoft.com/link', expires_in: 60, interval: 0.01 });
    },
    'POST /ms/consumers/oauth2/v2.0/token': (req, res, body) => {
      tokenCalls++;
      const f = new URLSearchParams(body);
      if (f.get('grant_type') === 'refresh_token') { assert.equal(f.get('refresh_token'), 'MS_REFRESH'); json(res, { access_token: 'MS_ACCESS_2', refresh_token: 'MS_REFRESH_2', expires_in: 3600 }); return; }
      if (++polls < 2) { json(res, { error: 'authorization_pending' }, 400); return; }
      json(res, { access_token: 'MS_ACCESS', refresh_token: 'MS_REFRESH', expires_in: 3600 });
    },
    'POST /xbl/user/authenticate': (req, res, body) => {
      const b = JSON.parse(body);
      assert.ok(b.Properties.RpsTicket.startsWith('d=MS_ACCESS'));
      json(res, { Token: 'XBL', DisplayClaims: { xui: [{ uhs: 'UHS' }] } });
    },
    'POST /xsts/xsts/authorize': (req, res) => json(res, { Token: 'XSTS', DisplayClaims: { xui: [{ uhs: 'UHS', xid: '2535' }] } }),
    'POST /mcs/authentication/login_with_xbox': (req, res, body) => {
      assert.equal(JSON.parse(body).identityToken, 'XBL3.0 x=UHS;XSTS');
      json(res, { access_token: `MC_TOKEN_${tokenCalls}`, expires_in: 86400 });
    },
    '/mcs/minecraft/profile': (req, res) => {
      assert.match(req.headers.authorization, /^Bearer MC_TOKEN_/);
      json(res, { id: '069a79f444e94726a5befca90e38aaf5', name: 'Notch', skins: [{ state: 'ACTIVE', url: 'http://textures/skin' }] });
    },
  });

  const U = srv.url;
  const core = await createLauncherCore({
    dataDir: path.join(tmpDir(), 'data'),
    config: {
      microsoft: { clientId: 'test-client' },
      mirrors: {
        'https://login.microsoftonline.com/': `${U}/ms/`,
        'https://user.auth.xboxlive.com/': `${U}/xbl/`,
        'https://xsts.auth.xboxlive.com/': `${U}/xsts/`,
        'https://api.minecraftservices.com/': `${U}/mcs/`,
      },
    },
    encrypt: (s) => Buffer.from(s).toString('base64'),
    decrypt: (s) => Buffer.from(s, 'base64').toString(),
  });

  const flow = await core.accounts.startMicrosoftLogin();
  assert.equal(flow.userCode, 'ABCD-1234');
  const acc = await flow.wait();
  assert.equal(acc.name, 'Notch');
  assert.equal(acc.accessToken, undefined, 'публичный вид без токенов');
  assert.ok(polls >= 2);

  // токены на диске зашифрованы
  const raw = require('fs').readFileSync(path.join(core.paths.root, 'accounts.json'), 'utf8');
  assert.ok(!raw.includes('MC_TOKEN') && !raw.includes('MS_REFRESH'));

  const full = await core.accounts.getForLaunch();
  assert.match(full.accessToken, /^MC_TOKEN_/);
  assert.equal(full.xuid, '2535');

  // истёкший токен обновляется через refresh_token
  const store = JSON.parse(raw);
  store.accounts[0].expiresAt = Date.now() - 1000;
  require('fs').writeFileSync(path.join(core.paths.root, 'accounts.json'), JSON.stringify(store));
  const refreshed = await core.accounts.getForLaunch();
  assert.notEqual(refreshed.accessToken, full.accessToken);
  assert.equal(refreshed.msRefreshToken, 'MS_REFRESH_2');

  // офлайн-аккаунт рядом
  await core.accounts.addOffline('Steve');
  const { accounts, activeId } = await core.accounts.list();
  assert.equal(accounts.length, 2);
  assert.equal(accounts.find((a) => a.id === activeId).name, 'Steve');
});

test('Microsoft: понятная ошибка без client id', async () => {
  const core = await createLauncherCore({ dataDir: path.join(tmpDir(), 'data'), config: { microsoft: { clientId: 'YOUR_AZURE_CLIENT_ID' } } });
  await assert.rejects(core.accounts.startMicrosoftLogin(), /clientId/);
});
