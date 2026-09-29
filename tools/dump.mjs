import { readFileSync } from 'node:fs';
import { parseSave } from '../docs/gvas.js';
const s = parseSave(readFileSync(process.argv[2]));
for (const p of s.properties) {
  if (p.value?.entries) for (const [k, v] of p.value.entries) console.log(`${p.name.replace('Saved','').replace('Map','')}\t${k}\t${v}`);
  else console.log(`TOP\t${p.name}\t${p.value}`);
}
