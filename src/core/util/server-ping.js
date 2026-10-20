'use strict';
// Пинг Minecraft-сервера (Server List Ping, 1.7+): онлайн, MOTD, версия. Учитывает SRV-записи.
const net = require('net');
const dns = require('dns').promises;

function varint(n) {
  const out = [];
  let v = n >>> 0;
  do {
    let b = v & 0x7f;
    v >>>= 7;
    if (v) b |= 0x80;
    out.push(b);
  } while (v);
  return Buffer.from(out);
}

function readVarint(buf, offset) {
  let result = 0;
  let shift = 0;
  let pos = offset;
  while (true) {
    if (pos >= buf.length) return null;
    const b = buf[pos++];
    result |= (b & 0x7f) << shift;
    if (!(b & 0x80)) return { value: result, size: pos - offset };
    shift += 7;
    if (shift > 35) throw new Error('VarInt слишком длинный');
  }
}

function packet(id, payload) {
  const body = Buffer.concat([varint(id), payload]);
  return Buffer.concat([varint(body.length), body]);
}

/** Текст MOTD из chat-компонента. */
function flattenChat(c) {
  if (c == null) return '';
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map(flattenChat).join('');
  return (c.text || '') + (c.extra || []).map(flattenChat).join('');
}

async function resolveSrv(host, port) {
  if (port !== 25565 || net.isIP(host)) return { host, port };
  try {
    const [rec] = await dns.resolveSrv(`_minecraft._tcp.${host}`);
    if (rec) return { host: rec.name, port: rec.port };
  } catch { /* SRV нет — это нормально */ }
  return { host, port };
}

/** ping('play.example.com', 25565) -> { online, max, motd, version, latency, favicon } */
async function pingServer(address, port = 25565, timeout = 5000) {
  const target = await resolveSrv(address, port);
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const sock = net.createConnection({ host: target.host, port: target.port });
    let buf = Buffer.alloc(0);
    const fail = (e) => { sock.destroy(); reject(e); };
    sock.setTimeout(timeout, () => fail(new Error('Сервер не ответил')));
    sock.on('error', fail);
    sock.on('connect', () => {
      const host = Buffer.from(address, 'utf8');
      const portBuf = Buffer.alloc(2);
      portBuf.writeUInt16BE(port);
      sock.write(packet(0x00, Buffer.concat([varint(767), varint(host.length), host, portBuf, varint(1)])));
      sock.write(packet(0x00, Buffer.alloc(0)));
    });
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      try {
        const len = readVarint(buf, 0);
        if (!len || buf.length < len.size + len.value) return;
        const id = readVarint(buf, len.size);
        const strLen = readVarint(buf, len.size + id.size);
        const start = len.size + id.size + strLen.size;
        const json = JSON.parse(buf.subarray(start, start + strLen.value).toString('utf8'));
        sock.end();
        resolve({
          online: json.players?.online ?? 0,
          max: json.players?.max ?? 0,
          players: (json.players?.sample || []).map((p) => p.name),
          motd: flattenChat(json.description),
          version: json.version?.name || '',
          protocol: json.version?.protocol,
          favicon: json.favicon || null,
          latency: Date.now() - started,
        });
      } catch (e) { fail(e); }
    });
  });
}

module.exports = { pingServer, varint, readVarint, flattenChat };
