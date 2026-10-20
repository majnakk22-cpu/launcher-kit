'use strict';
// Тонкая обёртка над встроенным fetch (Node 18+ / Electron): таймауты, повторы, понятные ошибки.

class HttpError extends Error {
  constructor(url, status, body) {
    super(`HTTP ${status} при запросе ${url}${body ? `: ${String(body).slice(0, 300)}` : ''}`);
    this.url = url;
    this.status = status;
    this.body = body;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let defaultUserAgent = 'mc-launcher-kit/0.1';
let mirrors = [];

/**
 * Зеркала: замена префиксов URL для всех запросов ядра, например
 * { "https://libraries.minecraft.net/": "https://my-mirror.example.com/libraries/" }
 */
function setMirrors(map) { mirrors = Object.entries(map || {}); }
function rewriteUrl(url) {
  for (const [from, to] of mirrors) if (url.startsWith(from)) return to + url.slice(from.length);
  return url;
}
function setUserAgent(ua) { defaultUserAgent = ua; }
function getUserAgent() { return defaultUserAgent; }

/**
 * request(url, { method, headers, body, json, timeout, retries })
 * json — объект, будет отправлен как application/json.
 * Повторяет запрос при сетевых ошибках и 5xx/429.
 */
async function request(url, opts = {}) {
  const { method = 'GET', headers = {}, json, form, timeout = 30000, retries = 2, signal } = opts;
  url = rewriteUrl(url);
  let body = opts.body;
  const h = { 'User-Agent': defaultUserAgent, ...headers };
  if (json !== undefined) { body = JSON.stringify(json); h['Content-Type'] = 'application/json'; }
  if (form !== undefined) { body = new URLSearchParams(form).toString(); h['Content-Type'] = 'application/x-www-form-urlencoded'; }

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      if (signal?.aborted) throw signal.reason || new Error('Отменено');
      const sig = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout);
      const res = await fetch(url, { method, headers: h, body, signal: sig, redirect: 'follow' });
      if (res.status === 429 || res.status >= 500) {
        lastErr = new HttpError(url, res.status, await res.text().catch(() => ''));
        if (attempt < retries) { await sleep(1000 * (attempt + 1)); continue; }
        throw lastErr;
      }
      return res;
    } catch (e) {
      lastErr = e;
      if (e instanceof HttpError || signal?.aborted) throw e;
      if (attempt < retries) { await sleep(700 * (attempt + 1)); continue; }
    }
  }
  throw lastErr;
}

async function ensureOk(res, url) {
  if (!res.ok) throw new HttpError(url, res.status, await res.text().catch(() => ''));
  return res;
}

async function getJson(url, opts) {
  const res = await ensureOk(await request(url, opts), url);
  return res.json();
}

async function getText(url, opts) {
  const res = await ensureOk(await request(url, opts), url);
  return res.text();
}

async function postJson(url, json, opts = {}) {
  const res = await ensureOk(await request(url, { ...opts, method: 'POST', json }), url);
  return res.json();
}

module.exports = { HttpError, request, ensureOk, getJson, getText, postJson, setUserAgent, getUserAgent, setMirrors, rewriteUrl, sleep };
