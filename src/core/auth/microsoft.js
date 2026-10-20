'use strict';
// Вход через Microsoft (лицензия Minecraft) по схеме Device Code:
// пользователь открывает microsoft.com/link и вводит код — не нужен встроенный браузер и redirect URI.
//
// Цепочка: Microsoft OAuth -> Xbox Live -> XSTS -> Minecraft Services -> профиль.
// Нужен свой client id из Azure (см. README, раздел "Microsoft вход").
const { request, HttpError, sleep } = require('../util/http');

const MS_BASE = 'https://login.microsoftonline.com/consumers/oauth2/v2.0';
const SCOPE = 'XboxLive.signin offline_access';

const XSTS_ERRORS = {
  2148916233: 'У этого Microsoft-аккаунта нет профиля Xbox. Зайди на xbox.com и создай его.',
  2148916235: 'Xbox Live недоступен в твоей стране.',
  2148916236: 'Аккаунту нужна верификация возраста (Южная Корея).',
  2148916237: 'Аккаунту нужна верификация возраста (Южная Корея).',
  2148916238: 'Детский аккаунт: его нужно добавить в семью Microsoft взрослым.',
};

async function jsonOrThrow(res, url) {
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  if (!res.ok) { const e = new HttpError(url, res.status, text); e.json = body; throw e; }
  return body;
}

class MicrosoftAuth {
  constructor({ clientId }) {
    this.clientId = clientId;
  }

  _assertConfigured() {
    if (!this.clientId || this.clientId.includes('YOUR')) {
      throw new Error('Не задан microsoft.clientId в launcher.config.json — см. README, раздел "Microsoft вход".');
    }
  }

  /**
   * Шаг 1. Возвращает данные для показа пользователю и функцию wait(), которая ждёт подтверждения.
   * { userCode, verificationUri, expiresIn, message, wait(): Promise<Account>, cancel() }
   */
  async startDeviceLogin() {
    this._assertConfigured();
    const url = `${MS_BASE}/devicecode`;
    const dc = await jsonOrThrow(await request(url, { method: 'POST', form: { client_id: this.clientId, scope: SCOPE } }), url);
    let cancelled = false;
    const wait = async () => {
      let interval = (dc.interval || 5) * 1000;
      const deadline = Date.now() + (dc.expires_in || 900) * 1000;
      while (!cancelled && Date.now() < deadline) {
        await sleep(interval);
        if (cancelled) break;
        const tokenUrl = `${MS_BASE}/token`;
        const res = await request(tokenUrl, {
          method: 'POST',
          form: { grant_type: 'urn:ietf:params:oauth:grant-type:device_code', client_id: this.clientId, device_code: dc.device_code },
        });
        const body = await res.json().catch(() => ({}));
        if (res.ok) return this.loginWithMsToken(body);
        if (body.error === 'authorization_pending') continue;
        if (body.error === 'slow_down') { interval += 5000; continue; }
        if (body.error === 'authorization_declined') throw new Error('Вход отклонён пользователем');
        if (body.error === 'expired_token') break;
        throw new Error(`Ошибка входа Microsoft: ${body.error_description || body.error || res.status}`);
      }
      throw new Error(cancelled ? 'Вход отменён' : 'Время на ввод кода истекло');
    };
    return {
      userCode: dc.user_code,
      verificationUri: dc.verification_uri,
      expiresIn: dc.expires_in,
      message: dc.message,
      wait,
      cancel: () => { cancelled = true; },
    };
  }

  /** Шаги 2–5: из токена Microsoft получаем аккаунт Minecraft. */
  async loginWithMsToken(ms) {
    // Xbox Live
    const xblUrl = 'https://user.auth.xboxlive.com/user/authenticate';
    const xbl = await jsonOrThrow(await request(xblUrl, {
      method: 'POST',
      headers: { Accept: 'application/json' },
      json: { Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: `d=${ms.access_token}` }, RelyingParty: 'http://auth.xboxlive.com', TokenType: 'JWT' },
    }), xblUrl);
    const uhs = xbl.DisplayClaims?.xui?.[0]?.uhs;

    // XSTS
    const xstsUrl = 'https://xsts.auth.xboxlive.com/xsts/authorize';
    const xstsRes = await request(xstsUrl, {
      method: 'POST',
      headers: { Accept: 'application/json' },
      json: { Properties: { SandboxId: 'RETAIL', UserTokens: [xbl.Token] }, RelyingParty: 'rp://api.minecraftservices.com/', TokenType: 'JWT' },
    });
    if (xstsRes.status === 401) {
      const b = await xstsRes.json().catch(() => ({}));
      throw new Error(XSTS_ERRORS[b.XErr] || `Xbox отказал во входе (XErr ${b.XErr})`);
    }
    const xsts = await jsonOrThrow(xstsRes, xstsUrl);

    // Minecraft
    const mcUrl = 'https://api.minecraftservices.com/authentication/login_with_xbox';
    const mcRes = await request(mcUrl, { method: 'POST', json: { identityToken: `XBL3.0 x=${uhs};${xsts.Token}` } });
    if (mcRes.status === 403) {
      throw new Error('Minecraft API отклонил вход. Скорее всего твой Azure client id ещё не одобрен Mojang — см. README.');
    }
    const mc = await jsonOrThrow(mcRes, mcUrl);

    // Профиль
    const profUrl = 'https://api.minecraftservices.com/minecraft/profile';
    const profRes = await request(profUrl, { headers: { Authorization: `Bearer ${mc.access_token}` } });
    if (profRes.status === 404) throw new Error('На этом аккаунте не куплен Minecraft Java Edition');
    const profile = await jsonOrThrow(profRes, profUrl);
    const skin = (profile.skins || []).find((s) => s.state === 'ACTIVE');

    return {
      id: `msa:${profile.id}`,
      type: 'microsoft',
      name: profile.name,
      uuid: profile.id,
      accessToken: mc.access_token,
      expiresAt: Date.now() + (mc.expires_in || 86400) * 1000,
      msRefreshToken: ms.refresh_token,
      xuid: xsts.DisplayClaims?.xui?.[0]?.xid || '0',
      skinUrl: skin?.url || null,
      updatedAt: Date.now(),
    };
  }

  /** Обновляет токен, если он истёк или истечёт в ближайшие 10 минут. */
  async ensureFresh(account) {
    if (account.type !== 'microsoft') return account;
    if (account.expiresAt && account.expiresAt - Date.now() > 10 * 60 * 1000) return account;
    this._assertConfigured();
    if (!account.msRefreshToken) throw new Error('Сессия Microsoft истекла — войди заново');
    const url = `${MS_BASE}/token`;
    const res = await request(url, {
      method: 'POST',
      form: { grant_type: 'refresh_token', client_id: this.clientId, refresh_token: account.msRefreshToken, scope: SCOPE },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Сессия Microsoft истекла — войди заново (${body.error || res.status})`);
    return this.loginWithMsToken(body);
  }
}

module.exports = { MicrosoftAuth };
