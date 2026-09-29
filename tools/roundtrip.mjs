import { readFileSync, readdirSync } from 'node:fs';
import { parseSave, writeSave, typeToString } from '../docs/gvas.js';
const dir = new URL('../saves/', import.meta.url);
for (const f of readdirSync(dir).filter(f => f.endsWith('.sav'))) {
  const buf = readFileSync(new URL(f, dir));
  const s = parseSave(buf);
  const out = writeSave(s);
  const same = out.length === buf.length && out.every((b, i) => b === buf[i]);
  const summary = s.properties.map(p => {
    const t = typeToString(p.type);
    const n = p.raw ? `RAW(${p.raw.length})` : p.value?.entries ? `${p.value.entries.length} entries` : JSON.stringify(p.value, (k, v) => typeof v === 'bigint' ? v.toString() : v);
    return `  ${p.name}: ${t} = ${n}`;
  }).join('\n');
  console.log(`${same ? 'OK  ' : 'DIFF'} ${f} (${buf.length}B, trailer ${s.trailer.length}B: ${[...s.trailer].join(',')})\n${summary}`);
}
