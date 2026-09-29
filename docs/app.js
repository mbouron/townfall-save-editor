import { parseSave, writeSave } from './gvas.js';
import { SaveModel, KINDS, ticksToDate, formatDuration, humanize, enumOptions } from './model.js';

const $ = sel => document.querySelector(sel);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

let ITEMS = {}, MISSIONS = {};
const state = { model: null, fileName: '', dirty: false, tab: null };

const INVENTORIES = [
  { prefix: 'TFPC_TFIC_', title: 'Main inventory', equipped: 'TFPC_TFIC_EquippedItem' },
  { prefix: 'TFPC_TFIC_Temp_', title: 'Secondary inventory', equipped: 'TFPC_TFIC_Temp_EquippedItem' },
];
const STAT_RE = /^(TFPC_(Num|Distance|TimeSpent)|Deaths_|Total_|TimePlayed_)/;

// ---- boot -----------------------------------------------------------------

Promise.all([
  fetch('data/items.json').then(r => r.json()),
  fetch('data/missions.json').then(r => r.json()),
]).then(([items, missions]) => { ITEMS = items; MISSIONS = missions; })
  .catch(() => status('Could not load the item database: names will show as IDs.', 'error'));

const dropzone = $('#dropzone');
$('#fileInput').addEventListener('change', e => e.target.files[0] && openFile(e.target.files[0]));
for (const ev of ['dragenter', 'dragover']) document.addEventListener(ev, e => { e.preventDefault(); dropzone.classList.add('over'); });
for (const ev of ['dragleave', 'drop']) document.addEventListener(ev, e => { e.preventDefault(); dropzone.classList.remove('over'); });
document.addEventListener('drop', e => e.dataTransfer.files[0] && openFile(e.dataTransfer.files[0]));
$('#downloadBtn').addEventListener('click', download);
$('#closeBtn').addEventListener('click', () => {
  if (state.dirty && !confirm('Discard your unsaved changes?')) return;
  state.model = null; state.dirty = false;
  $('#fileInput').value = '';
  showEditor(false);
});
window.addEventListener('beforeunload', e => { if (state.dirty) e.preventDefault(); });

function status(msg, cls = '') { const s = $('#status'); s.textContent = msg; s.className = cls; }

async function openFile(file) {
  if (state.dirty && !confirm('Discard your unsaved changes?')) return;
  try {
    const buf = new Uint8Array(await file.arrayBuffer());
    const save = parseSave(buf);
    // Refuse to edit anything we can't reproduce exactly.
    const again = writeSave(save);
    if (again.length !== buf.length || again.some((b, i) => b !== buf[i])) throw new Error('This file uses a layout the editor does not fully understand yet, so it was not opened.');
    state.model = new SaveModel(save);
    state.fileName = file.name;
    state.dirty = false;
    const kind = state.model.fileKind;
    state.tab = kind === 'game' ? 'overview' : kind === 'profile' ? 'stats' : 'all';
    showEditor(true);
    status(`Loaded ${file.name} (${(buf.length / 1024).toFixed(0)} KB)`, 'ok');
  } catch (err) {
    console.error(err);
    status(err.message, 'error');
  }
}

function showEditor(on) {
  $('#drop').hidden = on;
  $('#editor').hidden = !on;
  $('#actions').hidden = !on;
  if (on) render();
}

function markDirty() {
  state.dirty = true;
  updateFileLabel();
}
function updateFileLabel() {
  $('#fileLabel').innerHTML = esc(state.fileName) + (state.dirty ? ' <span class="dirty">• edited</span>' : '');
}

function download() {
  const bytes = writeSave(state.model.save);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
  a.download = state.fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  state.dirty = false;
  updateFileLabel();
  status(`Saved ${state.fileName}. Replace the file in your SaveGames folder (keep a backup).`, 'ok');
}

// ---- tabs -----------------------------------------------------------------

function tabsFor(kind) {
  if (kind === 'game') return [['overview', 'Overview'], ['inventory', 'Inventory'], ['stats', 'Stats'], ['missions', 'Missions'], ['all', 'All values']];
  if (kind === 'profile') return [['stats', 'Lifetime stats'], ['all', 'All values']];
  return [['all', 'All values']];
}

function render() {
  updateFileLabel();
  const tabs = tabsFor(state.model.fileKind);
  $('#tabs').innerHTML = tabs.map(([id, label]) =>
    `<button role="tab" type="button" data-tab="${id}" aria-selected="${id === state.tab}">${label}</button>`).join('');
  $('#tabs').onclick = e => {
    const t = e.target.closest('[data-tab]');
    if (t) { state.tab = t.dataset.tab; render(); }
  };
  const panel = $('#panel');
  panel.innerHTML = '';
  ({ overview: renderOverview, inventory: renderInventory, stats: renderStats, missions: renderMissions, all: renderAll })[state.tab](panel);
}

// ---- inputs ---------------------------------------------------------------

function parseTyped(kind, raw) {
  if (kind === 'Bool') return raw ? 1 : 0;
  if (kind === 'Int') { const n = Math.trunc(Number(raw)); return Number.isFinite(n) ? Math.max(-2147483648, Math.min(2147483647, n)) : null; }
  if (kind === 'Float') { const n = Number(raw); return Number.isFinite(n) ? n : null; }
  return String(raw);
}

// Input bound to a key of one of the saved maps. Enum-like strings get a
// dropdown restricted to the values the game defines.
function valueInput(kind, key, opts = {}) {
  const m = state.model;
  const v = m.get(kind, key);
  const options = kind === 'String' && (isMissionIdKey(key) ? missionOptions() : enumOptions(key, v));
  let el;
  if (kind === 'Bool') {
    el = document.createElement('input'); el.type = 'checkbox'; el.checked = !!v;
  } else if (options) {
    el = document.createElement('select');
    // Options are values or [value, label] pairs. An unexpected current value
    // stays visible but can't be picked again.
    const pairs = options.map(o => Array.isArray(o) ? o : [o, o]);
    const extra = pairs.some(([val]) => val === v) ? [] : [`<option selected disabled>${esc(v)}</option>`];
    el.innerHTML = extra.concat(pairs.map(([val, label]) =>
      `<option value="${esc(val)}" ${val === v ? 'selected' : ''}>${esc(label)}</option>`)).join('');
  } else {
    el = document.createElement('input');
    el.type = kind === 'String' ? 'text' : 'number';
    if (kind === 'Float') el.step = 'any';
    el.value = kind === 'Float' ? +v.toPrecision(7) : v;
  }
  el.setAttribute('aria-label', opts.label || key);
  el.addEventListener('change', () => {
    const nv = parseTyped(kind, kind === 'Bool' ? el.checked : el.value);
    if (nv === null) { el.value = m.get(kind, key); return; }
    m.set(kind, key, nv);
    el.classList.add('changed');
    markDirty();
    opts.onChange?.(nv);
  });
  return el;
}

function field(label, control, hint) {
  const wrap = document.createElement('label');
  wrap.className = 'field';
  wrap.innerHTML = `<span>${esc(label)}</span>`;
  wrap.append(control);
  if (hint) { const s = document.createElement('small'); s.textContent = hint; wrap.append(s); }
  return wrap;
}

function card(title, hint) {
  const c = document.createElement('section');
  c.className = 'card';
  c.innerHTML = `<h2>${esc(title)}</h2>` + (hint ? `<p class="hint">${hint}</p>` : '');
  return c;
}

const missionName = id => MISSIONS[id]?.name || `Mission ${id}`;
const missionOrder = id => (MISSIONS[id]?.order > 0 && !/test/i.test(MISSIONS[id].name) ? MISSIONS[id].order : 9999);
const isMissionIdKey = key => key === 'TimePlayed_CurrentMissionID' || /^TimePlayed_MissionRecord\d+_MID$/.test(key);
const missionOptions = () => Object.keys(MISSIONS).sort((a, b) => missionOrder(a) - missionOrder(b))
  .map(id => [id, `${missionName(id)} (#${id})`]);
const itemInfo = id => ITEMS[id] || { name: `Unknown item ${id}`, type: '?' };

// ---- overview -------------------------------------------------------------

function renderOverview(panel) {
  const m = state.model;
  const c = card('Save summary');
  const g = document.createElement('div'); g.className = 'grid';

  const ro = v => { const i = document.createElement('input'); i.type = 'text'; i.readOnly = true; i.value = v; return i; };
  const ticks = m.top.SaveDateTimeTicks?.value;
  if (ticks !== undefined) g.append(field('Saved on', ro(ticksToDate(ticks).toLocaleString())));
  if (m.has('String', 'TimePlayed_CurrentMissionID')) {
    g.append(field('Current mission', valueInput('String', 'TimePlayed_CurrentMissionID', { label: 'Current mission' }),
      'Story progress is set in the Missions tab.'));
  }
  if (m.has('String', 'TFPC_PlayerCharacterType')) {
    g.append(field('Playing as', valueInput('String', 'TFPC_PlayerCharacterType', { label: 'Playing as' })));
  }

  const ttp = m.top.TotalTimePlayed;
  if (ttp) {
    const i = document.createElement('input'); i.type = 'number'; i.step = 'any'; i.value = ttp.value.toFixed(0);
    const f = field('Total time played (seconds)', i, formatDuration(ttp.value));
    i.addEventListener('change', () => {
      const n = Number(i.value);
      if (!Number.isFinite(n) || n < 0) { i.value = ttp.value.toFixed(0); return; }
      ttp.value = n; i.classList.add('changed'); f.querySelector('small').textContent = formatDuration(n); markDirty();
    });
    g.append(f);
  }
  const simple = [
    ['Float', 'TFPC_Health', 'Health'], ['Float', 'TFPC_MaxHealth', 'Max health'],
    ['Int', 'Deaths_CurrentPlaythrough', 'Deaths (this playthrough)'], ['Int', 'Deaths_CurrentAutosave', 'Deaths (since autosave)'],
    ['Int', 'TFPC_NumSavesCreated', 'Saves created'],
    ['String', 'LowestDifficulty_CurrentPlaythrough', 'Lowest difficulty'], ['String', 'LowestPuzzleDifficulty_CurrentPlaythrough', 'Lowest puzzle difficulty'],
  ];
  for (const [kind, key, label] of simple) if (m.has(kind, key)) g.append(field(label, valueInput(kind, key, { label })));
  c.append(g);
  panel.append(c);

  const pos = ['X', 'Y', 'Z'].map(a => `CPM_CurrentLoadInLocation_${a}`);
  if (pos.every(k => m.has('Float', k))) {
    const c2 = card('Load-in position', 'Where the player spawns when this save is loaded (Unreal units, 1 = 1 cm).');
    const g2 = document.createElement('div'); g2.className = 'grid';
    for (const k of [...pos, 'CPM_CurrentLoadInRotation_Yaw']) if (m.has('Float', k)) g2.append(field(k.replace('CPM_CurrentLoadIn', ''), valueInput('Float', k)));
    c2.append(g2);
    panel.append(c2);
  }
}

// ---- inventory ------------------------------------------------------------

function renderInventory(panel) {
  const m = state.model;
  const n = document.createElement('p'); n.className = 'notice';
  n.innerHTML = 'Counts, ammo and durability are the safest edits. Removing quest items or documents you still need may block progress.';
  panel.append(n);
  for (const inv of INVENTORIES) {
    if (!m.readInventory(inv.prefix).length && inv.prefix.includes('Temp')) continue;
    panel.append(inventoryCard(inv));
  }
}

function inventoryCard(inv) {
  const m = state.model;
  let items = m.readInventory(inv.prefix);
  const last = m.get('String', 'TFIC_TempInventoryLastCharacter');
  const hint = inv.prefix.includes('Temp')
    ? `Stored as <code>${inv.prefix}…</code>. The game uses it when switching characters${last ? ` (last character: <b>${esc(last)}</b>)` : ''}.`
    : `Stored as <code>${inv.prefix}InventoryItemN_…</code>.`;
  const c = card(inv.title, hint);
  const toolbar = document.createElement('div'); toolbar.className = 'toolbar';
  const types = [...new Set(items.map(it => itemInfo(it.fields.ID?.value).type))].sort();
  toolbar.innerHTML = `<input type="search" placeholder="Filter items…" aria-label="Filter items">
    <select aria-label="Item type"><option value="">All types</option>${types.map(t => `<option>${esc(t)}</option>`).join('')}</select>
    <span class="count"></span>`;
  const [filter, typeSel, count] = toolbar.children;
  c.append(toolbar);

  const wrap = document.createElement('div'); wrap.className = 'table-wrap';
  const table = document.createElement('table');
  table.innerHTML = `<thead><tr><th>Item</th><th>Type</th><th>Count</th><th>Ammo</th><th>Durability</th><th></th></tr></thead><tbody></tbody>`;
  wrap.append(table); c.append(wrap);
  const tbody = table.tBodies[0];

  const commit = () => { m.writeInventory(inv.prefix, items); markDirty(); };

  function numCell(it, fieldName, kind) {
    const td = document.createElement('td'); td.className = 'num';
    const f = it.fields[fieldName];
    if (!f) { td.innerHTML = '<span class="id">–</span>'; return td; }
    const i = document.createElement('input'); i.type = 'number'; i.step = kind === 'Float' ? 'any' : '1';
    i.value = kind === 'Float' ? +f.value.toPrecision(7) : f.value;
    i.setAttribute('aria-label', fieldName);
    i.addEventListener('change', () => {
      const v = parseTyped(kind, i.value);
      if (v === null) { i.value = f.value; return; }
      f.value = v; i.classList.add('changed'); commit();
    });
    td.append(i);
    return td;
  }

  function draw() {
    const q = filter.value.trim().toLowerCase(), t = typeSel.value;
    const equipped = m.get('String', inv.equipped);
    tbody.innerHTML = '';
    let shown = 0;
    items.forEach((it, idx) => {
      const id = it.fields.ID?.value ?? '?';
      const info = itemInfo(id);
      if (t && info.type !== t) return;
      if (q && !`${info.name} ${humanize(info.name)} ${id}`.toLowerCase().includes(q)) return;
      shown++;
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${esc(humanize(info.name))} <span class="id">#${esc(id)}</span>${id === equipped ? ' <span class="badge equipped">equipped</span>' : ''}</td>
        <td><span class="badge">${esc(info.type)}</span></td>`;
      tr.append(numCell(it, 'NoHeld', 'Int'), numCell(it, 'AmmoCount', 'Int'), numCell(it, 'Durability', 'Float'));
      const td = document.createElement('td');
      const del = document.createElement('button');
      del.type = 'button'; del.className = 'icon danger'; del.textContent = '✕';
      del.title = del.ariaLabel = `Remove ${humanize(info.name)}`;
      del.addEventListener('click', () => { items.splice(idx, 1); commit(); draw(); });
      td.append(del); tr.append(td);
      tbody.append(tr);
    });
    count.textContent = `${shown} of ${items.length} items`;
  }
  filter.addEventListener('input', draw);
  typeSel.addEventListener('change', draw);
  draw();

  // Add item
  const add = document.createElement('div'); add.className = 'add-row';
  const listId = `items-${inv.prefix}`;
  const options = Object.entries(ITEMS).sort((a, b) => a[1].name.localeCompare(b[1].name))
    .map(([id, it]) => `<option value="${esc(humanize(it.name))} #${id}">${esc(it.type)}</option>`).join('');
  add.innerHTML = `<input type="search" list="${listId}" placeholder="Add an item: type to search…" aria-label="Item to add">
    <datalist id="${listId}">${options}</datalist>
    <input type="number" value="1" min="1" aria-label="Count">
    <button type="button" class="primary">Add item</button>`;
  const [pick, , qty, btn] = add.children;
  btn.addEventListener('click', () => {
    const id = /#([0-9a-f]+)\s*$/i.exec(pick.value)?.[1]?.toLowerCase();
    if (!id || !ITEMS[id]) { status('Pick an item from the list first.', 'error'); return; }
    const count = parseTyped('Int', qty.value) || 1;
    const existing = items.find(it => it.fields.ID?.value === id);
    if (existing && existing.fields.NoHeld) {
      existing.fields.NoHeld.value += count;
    } else {
      items.push(newItem(id, count));
    }
    commit(); draw();
    status(`Added ${count} × ${humanize(ITEMS[id].name)}.`, 'ok');
    pick.value = '';
  });
  c.append(add);
  return c;
}

// New item fields: copy the optional fields another instance of the same item
// uses anywhere in this save, otherwise use sensible defaults per type.
function newItem(id, count) {
  const fields = { ID: { kind: 'String', value: id }, NoHeld: { kind: 'Int', value: count } };
  const m = state.model;
  const template = INVENTORIES.flatMap(inv => m.readInventory(inv.prefix)).find(it => it.fields.ID?.value === id);
  if (template) {
    for (const [k, f] of Object.entries(template.fields)) if (!(k in fields)) fields[k] = { ...f };
  } else {
    const info = ITEMS[id];
    if (['Pistol', 'Shotgun', 'FlareGun'].includes(info.name)) fields.AmmoCount = { kind: 'Int', value: 0 };
    if (info.type === 'QuickItem') fields.MeshVariant = { kind: 'Int', value: 0 };
  }
  return { fields };
}

// ---- stats ----------------------------------------------------------------

function renderStats(panel) {
  const m = state.model;
  const c = card(m.fileKind === 'profile' ? 'Lifetime stats' : 'Playthrough stats',
    'Counters the game uses for achievements and the end-of-game results screen.');
  const g = document.createElement('div'); g.className = 'grid';
  for (const kind of ['Int', 'Float']) {
    for (const [key] of m.maps[kind] || []) {
      if (!STAT_RE.test(key) || /Bitmask|Record\d+_MID/.test(key)) continue;
      const typeKey = key.replace(/_Count$/, '_Type');
      const label = typeKey !== key && m.has('String', typeKey)
        ? `${key.includes('Richard') ? 'Richard' : 'Simon'}: ${m.get('String', typeKey)} kills`
        : humanize(key.replace(/^(TFPC_|Total_)/, ''));
      const hint = /Time|Hiding/.test(key) && kind === 'Float' ? formatDuration(m.get(kind, key)) : /Distance/.test(key) ? `${(m.get(kind, key) / 100000).toFixed(2)} km` : undefined;
      g.append(field(label, valueInput(kind, key, { label }), hint));
    }
  }
  c.append(g);
  panel.append(c);

  const flags = (m.maps.Bool || []).filter(([k]) => /^TFPC_(Killed|Used|Landed|Shot|Waited|SetOff|Completed)/.test(k));
  if (flags.length) {
    const c2 = card('Achievement flags', 'One-off feats tracked for achievements.');
    const g2 = document.createElement('div'); g2.className = 'grid';
    for (const [key] of flags) {
      const lab = document.createElement('label'); lab.className = 'field';
      lab.style.flexDirection = 'row'; lab.style.alignItems = 'center'; lab.style.gap = '8px';
      lab.append(valueInput('Bool', key), humanize(key.replace('TFPC_', '')));
      g2.append(lab);
    }
    c2.append(g2);
    panel.append(c2);
  }
}

// ---- missions -------------------------------------------------------------

function renderMissions(panel) {
  const m = state.model;
  const n = document.createElement('p'); n.className = 'notice';
  n.innerHTML = '<b>Advanced.</b> Mission states drive the story scripting. Changing them can leave the world in an inconsistent state. Keep a backup.';
  panel.append(n);
  const c = card('Missions');
  const list = document.createElement('div'); list.className = 'missions';
  const ids = [];
  for (const [key] of m.maps.String || []) {
    const r = /^TFMM_Mission(\d+)_SaveState$/.exec(key);
    if (r) ids.push(r[1]);
  }
  ids.sort((a, b) => missionOrder(a) - missionOrder(b));
  for (const id of ids) {
    const info = MISSIONS[id] || {};
    const el = document.createElement('article'); el.className = 'mission';
    const h = document.createElement('header');
    h.innerHTML = `<div><h3>${esc(missionName(id))} <span class="id">#${id}</span></h3>${info.description ? `<div class="desc">${esc(info.description)}</div>` : ''}</div>`;
    h.append(valueInput('String', `TFMM_Mission${id}_SaveState`, { label: `${missionName(id)} state` }));
    el.append(h);
    const objs = document.createElement('div'); objs.className = 'objectives';
    for (const [key] of m.maps.String) {
      const r = new RegExp(`^TFMM_Mission${id}_Objective([0-9a-f]+)_State$`).exec(key);
      if (!r) continue;
      const row = document.createElement('div'); row.className = 'objective';
      const name = info.objectives?.[r[1]] || `Objective ${r[1]}`;
      const current = m.get('String', `TFMM_Mission${id}_CurrentObjectiveID`) === r[1];
      row.innerHTML = `<span>${esc(name)}${current ? ' <span class="badge equipped">current</span>' : ''}</span>`;
      row.append(valueInput('String', key, { label: name }));
      objs.append(row);
    }
    if (objs.children.length) el.append(objs);
    list.append(el);
  }
  c.append(list);
  panel.append(c);
}

// ---- all values -----------------------------------------------------------

function renderAll(panel) {
  const m = state.model;
  const c = card('All saved values', 'Every key in the save. Only the first 300 matches are shown, so narrow it down with the search.');
  const toolbar = document.createElement('div'); toolbar.className = 'toolbar';
  const kinds = KINDS.filter(k => m.maps[k]);
  toolbar.innerHTML = `<input type="search" placeholder="Search keys or values… (e.g. Health, Door, Ammo)" aria-label="Search">
    <select aria-label="Type"><option value="">All types</option>${kinds.map(k => `<option>${k}</option>`).join('')}</select>
    <span class="count"></span>`;
  const [search, kindSel, count] = toolbar.children;
  c.append(toolbar);
  const wrap = document.createElement('div'); wrap.className = 'table-wrap';
  const table = document.createElement('table');
  table.innerHTML = '<thead><tr><th>Key</th><th>Type</th><th>Value</th></tr></thead><tbody></tbody>';
  wrap.append(table); c.append(wrap);
  const more = document.createElement('div'); more.className = 'more'; c.append(more);
  const LIMIT = 300;

  function draw() {
    const terms = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const tbody = table.tBodies[0];
    tbody.innerHTML = '';
    let total = 0;
    const frag = document.createDocumentFragment();
    for (const kind of kinds) {
      if (kindSel.value && kind !== kindSel.value) continue;
      for (const [key, value] of m.maps[kind]) {
        const hay = `${key} ${value}`.toLowerCase();
        if (!terms.every(t => hay.includes(t))) continue;
        total++;
        if (total > LIMIT) continue;
        const tr = document.createElement('tr');
        tr.innerHTML = `<td class="key">${esc(key)}</td><td><span class="kind">${kind}</span></td>`;
        const td = document.createElement('td'); td.className = 'val';
        td.append(valueInput(kind, key));
        tr.append(td);
        frag.append(tr);
      }
    }
    tbody.append(frag);
    const all = kinds.reduce((n, k) => n + m.maps[k].length, 0);
    count.textContent = `${total} of ${all} values`;
    more.textContent = total > LIMIT ? `Showing the first ${LIMIT}. Refine your search to see more.` : '';
  }
  let timer;
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(draw, 150); });
  kindSel.addEventListener('change', draw);
  draw();
  panel.append(c);
}
