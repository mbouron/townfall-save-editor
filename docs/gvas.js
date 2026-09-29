// Minimal GVAS (Unreal Engine SaveGame) reader/writer for UE 5.4+ saves
// (complete property type names, tag flags byte). Works in the browser and Node.
// Anything the parser does not understand is kept as raw bytes so that
// parse -> write is byte-identical.

const NATIVE_STRUCTS = {
  Vector: ['d', 'd', 'd'], Vector2D: ['d', 'd'], Vector4: ['d', 'd', 'd', 'd'],
  Rotator: ['d', 'd', 'd'], Quat: ['d', 'd', 'd', 'd'],
  IntPoint: ['i', 'i'], IntVector: ['i', 'i', 'i'],
  LinearColor: ['f', 'f', 'f', 'f'], Color: ['B', 'B', 'B', 'B'],
  Guid: ['guid'], DateTime: ['q'], Timespan: ['q'],
};

const TAG_ARRAY_INDEX = 0x01, TAG_GUID = 0x02, TAG_EXT = 0x04, TAG_BOOL_TRUE = 0x10;

class Reader {
  constructor(buf) {
    this.u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    this.dv = new DataView(this.u8.buffer, this.u8.byteOffset, this.u8.byteLength);
    this.pos = 0;
  }
  need(n) { if (this.pos + n > this.u8.length) throw new Error(`EOF at ${this.pos} (+${n})`); }
  u8v() { this.need(1); return this.u8[this.pos++]; }
  i8() { this.need(1); return this.dv.getInt8(this.pos++); }
  i16() { this.need(2); const v = this.dv.getInt16(this.pos, true); this.pos += 2; return v; }
  u16() { this.need(2); const v = this.dv.getUint16(this.pos, true); this.pos += 2; return v; }
  i32() { this.need(4); const v = this.dv.getInt32(this.pos, true); this.pos += 4; return v; }
  u32() { this.need(4); const v = this.dv.getUint32(this.pos, true); this.pos += 4; return v; }
  i64() { this.need(8); const v = this.dv.getBigInt64(this.pos, true); this.pos += 8; return v; }
  u64() { this.need(8); const v = this.dv.getBigUint64(this.pos, true); this.pos += 8; return v; }
  f32() { this.need(4); const v = this.dv.getFloat32(this.pos, true); this.pos += 4; return v; }
  f64() { this.need(8); const v = this.dv.getFloat64(this.pos, true); this.pos += 8; return v; }
  bytes(n) { this.need(n); const b = this.u8.slice(this.pos, this.pos + n); this.pos += n; return b; }
  guid() { return hex(this.bytes(16)); }
  str() {
    const len = this.i32();
    if (len === 0) return '';
    if (len > 0) {
      const b = this.bytes(len);
      if (b[len - 1] !== 0) throw new Error(`bad string at ${this.pos}`);
      let s = '';
      for (let i = 0; i < len - 1; i++) s += String.fromCharCode(b[i]);
      return s;
    }
    const n = -len;
    this.need(n * 2);
    let s = '';
    for (let i = 0; i < n - 1; i++) s += String.fromCharCode(this.dv.getUint16(this.pos + i * 2, true));
    this.pos += n * 2;
    return s;
  }
}

class Writer {
  constructor() { this.buf = new Uint8Array(1 << 16); this.dv = new DataView(this.buf.buffer); this.pos = 0; }
  grow(n) {
    if (this.pos + n <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < this.pos + n) cap *= 2;
    const nb = new Uint8Array(cap); nb.set(this.buf); this.buf = nb; this.dv = new DataView(nb.buffer);
  }
  u8v(v) { this.grow(1); this.buf[this.pos++] = v; }
  i8(v) { this.grow(1); this.dv.setInt8(this.pos++, v); }
  i16(v) { this.grow(2); this.dv.setInt16(this.pos, v, true); this.pos += 2; }
  u16(v) { this.grow(2); this.dv.setUint16(this.pos, v, true); this.pos += 2; }
  i32(v) { this.grow(4); this.dv.setInt32(this.pos, v, true); this.pos += 4; }
  u32(v) { this.grow(4); this.dv.setUint32(this.pos, v, true); this.pos += 4; }
  i64(v) { this.grow(8); this.dv.setBigInt64(this.pos, BigInt(v), true); this.pos += 8; }
  u64(v) { this.grow(8); this.dv.setBigUint64(this.pos, BigInt(v), true); this.pos += 8; }
  f32(v) { this.grow(4); this.dv.setFloat32(this.pos, v, true); this.pos += 4; }
  f64(v) { this.grow(8); this.dv.setFloat64(this.pos, v, true); this.pos += 8; }
  bytes(b) { this.grow(b.length); this.buf.set(b, this.pos); this.pos += b.length; }
  guid(h) { this.bytes(unhex(h)); }
  str(s) {
    if (s === '' || s == null) { this.i32(0); return; }
    const wide = [...s].some(c => c.charCodeAt(0) > 127);
    if (!wide) {
      this.i32(s.length + 1); this.grow(s.length + 1);
      for (let i = 0; i < s.length; i++) this.buf[this.pos++] = s.charCodeAt(i);
      this.buf[this.pos++] = 0;
    } else {
      this.i32(-(s.length + 1)); this.grow((s.length + 1) * 2);
      for (let i = 0; i < s.length; i++) { this.dv.setUint16(this.pos, s.charCodeAt(i), true); this.pos += 2; }
      this.dv.setUint16(this.pos, 0, true); this.pos += 2;
    }
  }
  patchI32(at, v) { this.dv.setInt32(at, v, true); }
  result() { return this.buf.slice(0, this.pos); }
}

function hex(b) { return Array.from(b, x => x.toString(16).padStart(2, '0')).join(''); }
function unhex(h) { const b = new Uint8Array(h.length / 2); for (let i = 0; i < b.length; i++) b[i] = parseInt(h.substr(i * 2, 2), 16); return b; }

// ---- type names -----------------------------------------------------------

function readType(r) {
  const name = r.str();
  const n = r.i32();
  const inner = [];
  for (let i = 0; i < n; i++) inner.push(readType(r));
  return { name, inner };
}
function writeType(w, t) { w.str(t.name); w.i32(t.inner.length); for (const i of t.inner) writeType(w, i); }

// ---- values ---------------------------------------------------------------

// Reads a value of type `t`. `inTag` means the value is a top-level tagged
// property (bool lives in the tag flags; byte/enum size known from the tag).
function readValue(r, t, size) {
  switch (t.name) {
    case 'BoolProperty': return r.u8v();
    case 'IntProperty': return r.i32();
    case 'Int8Property': return r.i8();
    case 'Int16Property': return r.i16();
    case 'Int64Property': return r.i64();
    case 'UInt16Property': return r.u16();
    case 'UInt32Property': return r.u32();
    case 'UInt64Property': return r.u64();
    case 'FloatProperty': return r.f32();
    case 'DoubleProperty': return r.f64();
    case 'StrProperty': case 'NameProperty': case 'EnumProperty': case 'ObjectProperty':
      return r.str();
    case 'ByteProperty': {
      const isEnum = t.inner.length && t.inner[0].name !== 'None';
      return (size === 1 || (size === undefined && !isEnum)) ? r.u8v() : r.str();
    }
    case 'SoftObjectProperty': return { pkg: r.str(), asset: r.str(), sub: r.str() };
    case 'StructProperty': return readStruct(r, t.inner[0]?.name);
    case 'ArrayProperty': {
      const n = r.i32(); const out = [];
      for (let i = 0; i < n; i++) out.push(readValue(r, t.inner[0]));
      return out;
    }
    case 'SetProperty': {
      const removed = []; const nr = r.i32();
      for (let i = 0; i < nr; i++) removed.push(readValue(r, t.inner[0]));
      const n = r.i32(); const items = [];
      for (let i = 0; i < n; i++) items.push(readValue(r, t.inner[0]));
      return { removed, items };
    }
    case 'MapProperty': {
      const removed = []; const nr = r.i32();
      for (let i = 0; i < nr; i++) removed.push(readValue(r, t.inner[0]));
      const n = r.i32(); const entries = [];
      for (let i = 0; i < n; i++) { const k = readValue(r, t.inner[0]); const v = readValue(r, t.inner[1]); entries.push([k, v]); }
      return { removed, entries };
    }
    default: throw new Error(`unsupported type ${t.name}`);
  }
}

function writeValue(w, t, v, size) {
  switch (t.name) {
    case 'BoolProperty': return w.u8v(v ? 1 : 0);
    case 'IntProperty': return w.i32(v);
    case 'Int8Property': return w.i8(v);
    case 'Int16Property': return w.i16(v);
    case 'Int64Property': return w.i64(v);
    case 'UInt16Property': return w.u16(v);
    case 'UInt32Property': return w.u32(v);
    case 'UInt64Property': return w.u64(v);
    case 'FloatProperty': return w.f32(v);
    case 'DoubleProperty': return w.f64(v);
    case 'StrProperty': case 'NameProperty': case 'EnumProperty': case 'ObjectProperty':
      return w.str(v);
    case 'ByteProperty': return typeof v === 'number' ? w.u8v(v) : w.str(v);
    case 'SoftObjectProperty': w.str(v.pkg); w.str(v.asset); w.str(v.sub); return;
    case 'StructProperty': return writeStruct(w, t.inner[0]?.name, v);
    case 'ArrayProperty': w.i32(v.length); for (const e of v) writeValue(w, t.inner[0], e); return;
    case 'SetProperty':
      w.i32(v.removed.length); for (const e of v.removed) writeValue(w, t.inner[0], e);
      w.i32(v.items.length); for (const e of v.items) writeValue(w, t.inner[0], e);
      return;
    case 'MapProperty':
      w.i32(v.removed.length); for (const e of v.removed) writeValue(w, t.inner[0], e);
      w.i32(v.entries.length);
      for (const [k, val] of v.entries) { writeValue(w, t.inner[0], k); writeValue(w, t.inner[1], val); }
      return;
    default: throw new Error(`unsupported type ${t.name}`);
  }
}

function readStruct(r, name) {
  const layout = NATIVE_STRUCTS[name];
  if (!layout) return readProperties(r);
  return layout.map(k => k === 'd' ? r.f64() : k === 'f' ? r.f32() : k === 'i' ? r.i32()
    : k === 'B' ? r.u8v() : k === 'q' ? r.i64() : r.guid());
}
function writeStruct(w, name, v) {
  const layout = NATIVE_STRUCTS[name];
  if (!layout) return writeProperties(w, v);
  layout.forEach((k, i) => k === 'd' ? w.f64(v[i]) : k === 'f' ? w.f32(v[i]) : k === 'i' ? w.i32(v[i])
    : k === 'B' ? w.u8v(v[i]) : k === 'q' ? w.i64(v[i]) : w.guid(v[i]));
}

// ---- tagged properties ----------------------------------------------------

function readProperties(r) {
  const props = [];
  for (;;) {
    const name = r.str();
    if (name === 'None' || name === '') break;
    const type = readType(r);
    const size = r.i32();
    const flags = r.u8v();
    const p = { name, type, flags };
    if (flags & TAG_ARRAY_INDEX) p.arrayIndex = r.i32();
    if (flags & TAG_GUID) p.guid = r.guid();
    if (flags & TAG_EXT) {
      p.ext = r.u8v();
      if (p.ext & 0x02) { p.extOp = r.u8v(); p.extBool = r.u8v(); }
    }
    const start = r.pos;
    if (type.name === 'BoolProperty' && size === 0) {
      p.value = !!(flags & TAG_BOOL_TRUE);
    } else {
      try {
        p.value = readValue(r, type, size);
        if (r.pos !== start + size) throw new Error('size mismatch');
      } catch (e) {
        r.pos = start;
        p.raw = r.bytes(size);
        delete p.value;
      }
    }
    props.push(p);
  }
  return props;
}

function writeProperties(w, props) {
  for (const p of props) {
    w.str(p.name);
    writeType(w, p.type);
    let flags = p.flags;
    const isTagBool = p.type.name === 'BoolProperty' && p.raw === undefined;
    if (isTagBool) flags = p.value ? (flags | TAG_BOOL_TRUE) : (flags & ~TAG_BOOL_TRUE);
    const sizeAt = w.pos; w.i32(0);
    w.u8v(flags);
    if (flags & TAG_ARRAY_INDEX) w.i32(p.arrayIndex);
    if (flags & TAG_GUID) w.guid(p.guid);
    if (flags & TAG_EXT) { w.u8v(p.ext); if (p.ext & 0x02) { w.u8v(p.extOp); w.u8v(p.extBool); } }
    const start = w.pos;
    if (p.raw !== undefined) w.bytes(p.raw);
    else if (!isTagBool) writeValue(w, p.type, p.value);
    w.patchI32(sizeAt, w.pos - start);
  }
  w.str('None');
}

// ---- file -----------------------------------------------------------------

export function parseSave(buf) {
  const r = new Reader(buf);
  const h = {};
  h.magic = r.u32();
  if (h.magic !== 0x53415647) throw new Error('Not a GVAS save file');
  h.saveGameVersion = r.i32();
  h.ue4Version = r.i32();
  if (h.saveGameVersion >= 3) h.ue5Version = r.i32();
  h.engine = { major: r.u16(), minor: r.u16(), patch: r.u16(), changelist: r.u32(), branch: r.str() };
  h.customFormat = r.i32();
  const n = r.i32();
  h.customVersions = [];
  for (let i = 0; i < n; i++) h.customVersions.push([r.guid(), r.i32()]);
  h.saveClass = r.str();
  // UE 5.4+: EClassSerializationControlExtension byte before tagged properties
  if (h.ue5Version >= 1011) h.serializationControl = r.u8v();
  const properties = readProperties(r);
  const trailer = r.bytes(r.u8.length - r.pos);
  return { header: h, properties, trailer };
}

export function writeSave(save) {
  const w = new Writer();
  const h = save.header;
  w.u32(h.magic); w.i32(h.saveGameVersion); w.i32(h.ue4Version);
  if (h.saveGameVersion >= 3) w.i32(h.ue5Version);
  w.u16(h.engine.major); w.u16(h.engine.minor); w.u16(h.engine.patch); w.u32(h.engine.changelist); w.str(h.engine.branch);
  w.i32(h.customFormat); w.i32(h.customVersions.length);
  for (const [g, v] of h.customVersions) { w.guid(g); w.i32(v); }
  w.str(h.saveClass);
  if (h.serializationControl !== undefined) w.u8v(h.serializationControl);
  writeProperties(w, save.properties);
  w.bytes(save.trailer);
  return w.result();
}

export function typeToString(t) {
  return t.inner.length ? `${t.name}<${t.inner.map(typeToString).join(', ')}>` : t.name;
}
