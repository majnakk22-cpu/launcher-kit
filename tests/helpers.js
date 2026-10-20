'use strict';
// Вспомогательные функции тестов: ZIP-писатель, локальный HTTP-сервер, компиляция Java.
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const zlib = require('zlib');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** entries: { 'path/in/zip': Buffer|string } ; store=true — без сжатия */
function makeZip(file, entries, { store = false } = {}) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content);
    const comp = store ? data : zlib.deflateRawSync(data);
    const method = store ? 0 : 8;
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x800, 6); lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nameBuf.length, 26);
    locals.push(lh, nameBuf, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x800, 8); ch.writeUInt16LE(method, 10);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, nameBuf);
    offset += 30 + nameBuf.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  const count = Object.keys(entries).length;
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(count, 8); eocd.writeUInt16LE(count, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat([...locals, cd, eocd]));
  return file;
}

const sha1 = (buf) => crypto.createHash('sha1').update(buf).digest('hex');

/**
 * Локальный HTTP-сервер. routes: { '/path': Buffer | string | object(JSON) | (req, res, body) => void }
 * Возвращает { url, port, hits, close, routes }
 */
async function startServer(routes = {}) {
  const hits = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      const u = new URL(req.url, 'http://x');
      hits.push({ method: req.method, path: u.pathname, search: u.search, headers: req.headers, body });
      const r = routes[u.pathname] ?? routes[`${req.method} ${u.pathname}`];
      if (r === undefined) { res.statusCode = 404; res.end('not found'); return; }
      if (typeof r === 'function') { r(req, res, body, u); return; }
      if (Buffer.isBuffer(r) || typeof r === 'string') { res.end(r); return; }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(r));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  return { url: `http://127.0.0.1:${port}`, port, hits, routes, close: () => new Promise((r) => server.close(r)) };
}

/** Компилирует java-исходники { 'pkg/Name.java': src } в jar. mainClass — для манифеста. */
function compileJar(outJar, sources, mainClass = null) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mlk-java-'));
  const src = path.join(dir, 'src');
  const cls = path.join(dir, 'classes');
  const files = [];
  for (const [rel, code] of Object.entries(sources)) {
    const f = path.join(src, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, code);
    files.push(f);
  }
  fs.mkdirSync(cls, { recursive: true });
  execFileSync('javac', ['--release', '8', '-nowarn', '-d', cls, ...files], { stdio: 'pipe' });
  fs.mkdirSync(path.dirname(outJar), { recursive: true });
  const args = mainClass ? ['cfe', outJar, mainClass, '-C', cls, '.'] : ['cf', outJar, '-C', cls, '.'];
  execFileSync('jar', args, { stdio: 'pipe' });
  fs.rmSync(dir, { recursive: true, force: true });
  return fs.readFileSync(outJar);
}

function tmpDir(prefix = 'mlk-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

module.exports = { makeZip, startServer, compileJar, sha1, tmpDir, crc32 };
