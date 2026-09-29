// Townfall-specific view over a parsed GVAS save.
// All game state lives in four top-level maps keyed by name:
// SavedBoolMap, SavedIntMap, SavedFloatMap, SavedStringMap.

export const KINDS = ['Bool', 'Int', 'Float', 'String'];

export class SaveModel {
  constructor(save) {
    this.save = save;
    this.maps = {};
    for (const p of save.properties) {
      const m = /^Saved(\w+)Map$/.exec(p.name);
      if (m && p.value?.entries) this.maps[m[1]] = p.value.entries;
    }
    this.top = Object.fromEntries(save.properties.filter(p => !p.value?.entries).map(p => [p.name, p]));
    this.index = {};
    for (const k of Object.keys(this.maps)) this.reindex(k);
  }

  reindex(kind) {
    const idx = new Map();
    this.maps[kind].forEach((e, i) => idx.set(e[0], i));
    this.index[kind] = idx;
  }

  has(kind, key) { return !!this.index[kind]?.has(key); }
  get(kind, key) {
    const i = this.index[kind]?.get(key);
    return i === undefined ? undefined : this.maps[kind][i][1];
  }
  set(kind, key, value) {
    if (!this.maps[kind]) throw new Error(`This save has no Saved${kind}Map`);
    const i = this.index[kind].get(key);
    if (i === undefined) { this.index[kind].set(key, this.maps[kind].length); this.maps[kind].push([key, value]); }
    else this.maps[kind][i][1] = value;
  }

  // Which of the known file types this is.
  get fileKind() {
    if (this.top.TotalTimePlayed || this.has('String', 'TFPC_PlayerCharacterType')) return 'game';
    if (this.has('Int', 'Total_NumSavesCreated') || this.has('String', 'DifficultyType')) return 'profile';
    if (this.has('String', 'WindowMode') || this.has('String', 'r.setres')) return 'display';
    return 'unknown';
  }

  // ---- inventory ----------------------------------------------------------
  // Items are stored as TFPC_TFIC_[Temp_]InventoryItem<N>_<Field>, where
  // _ID (String, hex item id) and _NoHeld (Int, count) are always present and
  // _AmmoCount / _MeshVariant (Int) and _Durability (Float) are optional.

  readInventory(prefix) {
    const re = new RegExp(`^${prefix}InventoryItem(\\d+)_(.+)$`);
    const byIndex = new Map();
    for (const kind of KINDS) {
      for (const [key, value] of this.maps[kind] || []) {
        const m = re.exec(key);
        if (!m) continue;
        const n = +m[1];
        if (!byIndex.has(n)) byIndex.set(n, { fields: {} });
        byIndex.get(n).fields[m[2]] = { kind, value };
      }
    }
    return [...byIndex.entries()].sort((a, b) => a[0] - b[0]).map(([, it]) => it);
  }

  writeInventory(prefix, items) {
    const re = new RegExp(`^${prefix}InventoryItem\\d+_`);
    const insertAt = {};
    for (const kind of KINDS) {
      const entries = this.maps[kind];
      if (!entries) continue;
      const first = entries.findIndex(e => re.test(e[0]));
      insertAt[kind] = first === -1 ? null : first;
      if (first !== -1) this.maps[kind] = entries.filter(e => !re.test(e[0]));
    }
    const fresh = Object.fromEntries(KINDS.map(k => [k, []]));
    items.forEach((it, n) => {
      for (const [field, { kind, value }] of Object.entries(it.fields)) {
        fresh[kind].push([`${prefix}InventoryItem${n}_${field}`, value]);
      }
    });
    for (const kind of KINDS) {
      if (!fresh[kind].length || !this.maps[kind]) continue;
      const at = insertAt[kind] ?? this.maps[kind].length;
      this.maps[kind].splice(at, 0, ...fresh[kind]);
    }
    // Entry arrays were replaced: point the save's properties at the new arrays.
    for (const p of this.save.properties) {
      const m = /^Saved(\w+)Map$/.exec(p.name);
      if (m && this.maps[m[1]]) p.value.entries = this.maps[m[1]];
    }
    for (const kind of Object.keys(this.maps)) this.reindex(kind);
  }
}

// .NET ticks (100ns since 0001-01-01) <-> JS Date
const EPOCH_TICKS = 621355968000000000n;
export const ticksToDate = t => new Date(Number((BigInt(t) - EPOCH_TICKS) / 10000n));
export const dateToTicks = d => BigInt(d.getTime()) * 10000n + EPOCH_TICKS;

export function formatDuration(sec) {
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = sec % 60;
  return `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
}

export function humanize(name) {
  return name.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
}

// String values that are really Unreal enums, with the values the game
// defines (from the reflected enum names in Townfall-Win64-Shipping.exe).
const LANGUAGES = ['English', 'French', 'German', 'Italian', 'Spanish',
  'LatinAmericanSpanish', 'Portuguese', 'BrazilianPortuguese', 'Polish',
  'Russian', 'Turkish', 'Japanese', 'Korean', 'SimplifiedChinese',
  'TraditionalChinese', 'Thai', 'Vietnamese', 'Indonesian', 'Malay', 'Hindi'];
const ENUMS = [
  [/^(DifficultyType|LowestDifficulty_CurrentPlaythrough)$/, ['StoryMode', 'Normal', 'Nightmare']],
  [/^(PuzzleDifficultyType|LowestPuzzleDifficulty_CurrentPlaythrough)$/, ['Hinted', 'Normal']],
  [/^TFMM_Mission\d+_SaveState$/, ['NotStarted', 'Active', 'Completed', 'Failed', 'Abandoned']],
  [/^TFMM_Mission\d+_Objective[0-9a-f]+_State$/, ['NotStarted', 'InProgress', 'Completed', 'Failed']],
  [/^(TFPC_PlayerCharacterType|TFIC_TempInventoryLastCharacter)$/,
    ['Simon', 'Zoe', 'Richard', 'SimonFinalStage', 'SimonFlashback', 'SimonFlashSideways']],
  [/^TFPC_IVBagEquipState(_Temporary)?$/, ['None', 'IVBagEquipped', 'EnhancedIVBagEquipped']],
  [/^TFPC_Stance$/, ['PlayerStance_Standing', 'PlayerStance_Crouching']],
  [/^NC\.Dialoc\.(TextLanguage|AudioLanguage)$/, LANGUAGES],
];

export function enumOptions(key, value) {
  for (const [re, options] of ENUMS) if (re.test(key)) return options;
  if (value === 'True' || value === 'False') return ['True', 'False'];
  return null;
}
