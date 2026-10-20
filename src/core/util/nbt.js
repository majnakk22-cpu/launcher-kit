'use strict';
// Минимальный кодек NBT (несжатый, big-endian) — нужен для servers.dat (список серверов в мультиплеере).
// Значения хранятся с типом: { type: 'string', value: 'abc' }, чтобы файл можно было прочитать и записать без потерь.

const T = { end: 0, byte: 1, short: 2, int: 3, long: 4, float: 5, double: 6, byteArray: 7, string: 8, list: 9, compound: 10, intArray: 11, longArray: 12 };
const NAMES = Object.fromEntries(Object.entries(T).map(([k, v]) => [v, k]));

function read(buf) {
  let p = 0;
  const u8 = () => buf.readUInt8(p++);
  const i8 = () => buf.readInt8(p++);
  const i16 = () => { const v = buf.readInt16BE(p); p += 2; return v; };
  const u16 = () => { const v = buf.readUInt16BE(p); p += 2; return v; };
  const i32 = () => { const v = buf.readInt32BE(p); p += 4; return v; };
  const i64 = () => { const v = buf.readBigInt64BE(p); p += 8; return v; };
  const f32 = () => { const v = buf.readFloatBE(p); p += 4; return v; };
  const f64 = () => { const v = buf.readDoubleBE(p); p += 8; return v; };
  const str = () => { const n = u16(); const s = buf.toString('utf8', p, p + n); p += n; return s; };

  const payload = (t) => {
    switch (t) {
      case T.byte: return i8();
      case T.short: return i16();
      case T.int: return i32();
      case T.long: return i64();
      case T.float: return f32();
      case T.double: return f64();
      case T.byteArray: { const n = i32(); const v = [...buf.subarray(p, p + n)].map((b) => (b > 127 ? b - 256 : b)); p += n; return v; }
      case T.string: return str();
      case T.list: {
        const et = u8();
        const n = i32();
        const items = [];
        for (let i = 0; i < n; i++) items.push(payload(et));
        return { elementType: NAMES[et], items };
      }
      case T.compound: {
        const obj = {};
        for (;;) {
          const ct = u8();
          if (ct === T.end) break;
          const name = str();
          obj[name] = { type: NAMES[ct], value: payload(ct) };
        }
        return obj;
      }
      case T.intArray: { const n = i32(); const v = []; for (let i = 0; i < n; i++) v.push(i32()); return v; }
      case T.longArray: { const n = i32(); const v = []; for (let i = 0; i < n; i++) v.push(i64()); return v; }
      default: throw new Error(`NBT: неизвестный тип ${t}`);
    }
  };

  const t = u8();
  if (t !== T.compound) throw new Error('NBT: корень должен быть compound');
  const name = str();
  return { name, value: payload(t) };
}

function write(root) {
  const parts = [];
  const push = (b) => parts.push(b);
  const u8 = (v) => { const b = Buffer.alloc(1); b.writeUInt8(v); push(b); };
  const i8 = (v) => { const b = Buffer.alloc(1); b.writeInt8(v); push(b); };
  const i16 = (v) => { const b = Buffer.alloc(2); b.writeInt16BE(v); push(b); };
  const i32 = (v) => { const b = Buffer.alloc(4); b.writeInt32BE(v); push(b); };
  const i64 = (v) => { const b = Buffer.alloc(8); b.writeBigInt64BE(BigInt(v)); push(b); };
  const str = (s) => { const b = Buffer.from(String(s), 'utf8'); const l = Buffer.alloc(2); l.writeUInt16BE(b.length); push(l); push(b); };

  const payload = (type, v) => {
    switch (T[type]) {
      case T.byte: return i8(v);
      case T.short: return i16(v);
      case T.int: return i32(v);
      case T.long: return i64(v);
      case T.float: { const b = Buffer.alloc(4); b.writeFloatBE(v); return push(b); }
      case T.double: { const b = Buffer.alloc(8); b.writeDoubleBE(v); return push(b); }
      case T.byteArray: i32(v.length); return push(Buffer.from(v.map((x) => (x < 0 ? x + 256 : x))));
      case T.string: return str(v);
      case T.list: u8(v.items.length ? T[v.elementType] : (T[v.elementType] ?? T.end)); i32(v.items.length); v.items.forEach((it) => payload(v.elementType, it)); return undefined;
      case T.compound:
        for (const [name, tag] of Object.entries(v)) { u8(T[tag.type]); str(name); payload(tag.type, tag.value); }
        return u8(T.end);
      case T.intArray: i32(v.length); return v.forEach(i32);
      case T.longArray: i32(v.length); return v.forEach(i64);
      default: throw new Error(`NBT: неизвестный тип ${type}`);
    }
  };

  u8(T.compound);
  str(root.name || '');
  payload('compound', root.value);
  return Buffer.concat(parts);
}

// ---------- servers.dat ----------

/** Buffer -> [{ name, ip, ... }] */
function readServers(buf) {
  const root = read(buf);
  const list = root.value.servers?.value?.items || [];
  return list.map((c) => ({ name: c.name?.value ?? '', ip: c.ip?.value ?? '', _raw: c }));
}

/** [{ name, ip, _raw? }] -> Buffer */
function writeServers(servers) {
  return write({
    name: '',
    value: {
      servers: {
        type: 'list',
        value: {
          elementType: 'compound',
          items: servers.map((s) => ({ ...(s._raw || {}), name: { type: 'string', value: s.name || s.ip }, ip: { type: 'string', value: s.ip } })),
        },
      },
    },
  });
}

module.exports = { read, write, readServers, writeServers };
