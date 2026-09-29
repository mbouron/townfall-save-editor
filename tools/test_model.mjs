import { readFileSync, readdirSync } from 'node:fs';
import { parseSave, writeSave } from '../docs/gvas.js';
import { SaveModel } from '../docs/model.js';
const dir = new URL('../saves/', import.meta.url);
const eq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
for (const f of readdirSync(dir).filter(f => f.startsWith('SaveGame'))) {
  const buf = readFileSync(new URL(f, dir));
  const m = new SaveModel(parseSave(buf));
  for (const p of ['TFPC_TFIC_', 'TFPC_TFIC_Temp_']) m.writeInventory(p, m.readInventory(p));
  const same = eq(writeSave(m.save), buf);
  // edit: drop first item, add a pistol, re-parse and check
  const inv = m.readInventory('TFPC_TFIC_');
  inv.shift();
  inv.push({ fields: { ID: { kind: 'String', value: '4' }, NoHeld: { kind: 'Int', value: 1 }, AmmoCount: { kind: 'Int', value: 6 } } });
  m.writeInventory('TFPC_TFIC_', inv);
  const m2 = new SaveModel(parseSave(writeSave(m.save)));
  const inv2 = m2.readInventory('TFPC_TFIC_');
  console.log(same ? 'OK  ' : 'DIFF', f, m.fileKind, inv2.length === inv.length && inv2.at(-1).fields.AmmoCount.value === 6 ? 'edit-ok' : 'EDIT-FAIL');
}
