// convert_pbs.js
// Converts Universal Gold's Pokémon Essentials v21.1 PBS files into data for the damage calc.
//
// Usage (run from the calc folder):
//   node tools/convert_pbs.js "C:\path\to\Universal Gold\PBS"
//
// It writes two files:
//   src/js/data/sets/gen8.js        trainer sets (the "Opposing Team" list), in trainers.txt order
//   calc/src/data/species_ug.ts     base stats, types, abilities, weight for every species and form
//
// It reads these PBS files (names are taken from them, so U-turn, Farfetch'd, Gym Leader... come out right):
//   pokemon.txt, pokemon_forms.txt, trainers.txt, moves.txt, abilities.txt, items.txt, trainer_types.txt, types.txt

const fs = require('fs');
const path = require('path');

// ---------------- Settings ----------------

// Universal Gold: trainer Pokémon have perfect IVs and no EVs unless trainers.txt says otherwise.
const TRAINER_IV = 31;
const TRAINER_EV = 0;

const SETDEX_FILE = path.join('src', 'js', 'data', 'sets', 'gen8.js');
const SETDEX_VAR = 'SETDEX_SS';
const SPECIES_FILE = path.join('calc', 'src', 'data', 'species_ug.ts');

// Form names that the general rules below would get wrong (Essentials FormName -> calc suffix).
const FORM_OVERRIDES = {
  'Female': 'F', 'Male': 'M',
  'Crowned Sword': 'Crowned', 'Crowned Shield': 'Crowned',
  'Rapid Strike Style': 'Rapid-Strike', 'Ice Rider': 'Ice', 'Shadow Rider': 'Shadow',
  'Galarian Standard Mode': 'Galar', 'Galarian Zen Mode': 'Galar-Zen',
  'Paldean (Combat Breed)': 'Paldea-Combat', 'Paldean (Blaze Breed)': 'Paldea-Blaze', 'Paldean (Aqua Breed)': 'Paldea-Aqua',
  'Family of Three': 'Three', 'Low Key Form': 'Low-Key', 'Ash-Greninja': 'Ash', 'Noice Face': 'Noice',
};

// Species names the calc spells differently from Essentials (its sprites are looked up by these names).
// Forms follow automatically: Farfetch'd -> Farfetch’d also gives Farfetch’d-Galar.
const SPECIES_OVERRIDES = {
  "Farfetch'd": 'Farfetch’d',
  "Sirfetch'd": 'Sirfetch’d',
  'Nidoran♀': 'Nidoran-F',
  'Nidoran♂': 'Nidoran-M',
};

// ---------------- PBS reading ----------------

const pbsDir = process.argv[2];
if (!pbsDir || !fs.existsSync(pbsDir)) {
  console.error(pbsDir ? `PBS folder not found: ${pbsDir}` : 'Usage: node tools/convert_pbs.js "<path to PBS folder>"');
  process.exit(1);
}

const warnings = new Set();
const warn = (msg) => warnings.add(msg);

// Every "<base>.txt" plus "<base>_*.txt" (v21 lets you split PBS files), main file first.
function pbsFiles(base, exclude = []) {
  return fs.readdirSync(pbsDir)
    .filter((f) => new RegExp(`^${base}(_.*)?\\.txt$`, 'i').test(f))
    .filter((f) => !exclude.some((ex) => f.toLowerCase().startsWith(ex)))
    .sort((a, b) => (a.toLowerCase() === `${base}.txt` ? -1 : b.toLowerCase() === `${base}.txt` ? 1 : a.localeCompare(b)))
    .map((f) => path.join(pbsDir, f));
}

// A PBS file as a list of { header, lines: [[key, value], ...] }, in file order.
function parseSections(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  const sections = [];
  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const header = line.match(/^\[(.+)\]$/);
    if (header) {
      current = { header: header[1].replace(/\s+/g, ''), lines: [] };
      sections.push(current);
      continue;
    }
    const eq = line.indexOf('=');
    if (eq < 0 || !current) continue;
    current.lines.push([line.slice(0, eq).trim(), line.slice(eq + 1).trim()]);
  }
  return sections;
}

// { ID: { Key: value } }, keeping the order IDs first appear.
function loadTable(base, exclude) {
  const table = {};
  for (const file of pbsFiles(base, exclude)) {
    for (const sec of parseSections(file)) {
      table[sec.header] = Object.assign(table[sec.header] || {}, Object.fromEntries(sec.lines));
    }
  }
  return table;
}

const speciesPBS = loadTable('pokemon', ['pokemon_forms', 'pokemon_metrics']);
const formsPBS = loadTable('pokemon_forms');
const movesPBS = loadTable('moves');
const abilitiesPBS = loadTable('abilities');
const itemsPBS = loadTable('items');
const trainerTypesPBS = loadTable('trainer_types');
const typesPBS = loadTable('types');

if (!Object.keys(speciesPBS).length) {
  console.error(`No pokemon.txt found in ${pbsDir}`);
  process.exit(1);
}
for (const [file, table] of Object.entries({ 'moves.txt': movesPBS, 'abilities.txt': abilitiesPBS, 'items.txt': itemsPBS, 'trainer_types.txt': trainerTypesPBS })) {
  if (!Object.keys(table).length) warn(`${file} not found in the PBS folder, so those names are guessed from IDs.`);
}

// "ORANBERRY" -> "Oranberry". Only used when a name is missing from the PBS.
const guess = (id) => id.toLowerCase().split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');

function nameOf(table, id, kind) {
  if (table[id] && table[id].Name) return table[id].Name;
  if (Object.keys(table).length) warn(`${kind} ${id} has no Name in the PBS, so it was guessed as "${guess(id)}".`);
  return guess(id);
}

const list = (v) => (v || '').split(',').map((s) => s.trim()).filter(Boolean);

function typeName(id) {
  if (id === 'QMARKS') return '???';
  return (typesPBS[id] && typesPBS[id].Name) || guess(id);
}

// ---------------- Species and forms ----------------

// Essentials FormName -> the calc's suffix ("Alolan" -> "Alola", "Mega Charizard X" -> "Mega-X").
function formSuffix(baseName, formName, isMega) {
  if (FORM_OVERRIDES[formName]) return FORM_OVERRIDES[formName];
  let words = formName.replace(/[()]/g, ' ').split(/\s+/).filter(Boolean);
  words = words.filter((w) => w.toLowerCase() !== baseName.toLowerCase());

  const regions = { Alolan: 'Alola', Galarian: 'Galar', Hisuian: 'Hisui', Paldean: 'Paldea' };
  let prefix = '';
  if (regions[words[0]]) prefix = regions[words.shift()];
  else if (words[0] === 'Mega') { prefix = 'Mega'; words.shift(); }
  else if (words[0] === 'Giga') { prefix = 'Gmax'; words.shift(); }
  else if (words[0] === 'Primal') { prefix = 'Primal'; words.shift(); }

  const filler = /^(Form|Forme|Mode|Style|Size|Cloak|Pattern|Type|Type:|Trim|Flower|Drive|Core|Plumage|Mask|Breed|Rider|Standard)$/i;
  words = words.filter((w) => !filler.test(w));
  if (isMega && !prefix && words.length === 1 && /^[XYZ]$/.test(words[0])) prefix = 'Mega';
  return [prefix, ...words].filter(Boolean).join('-');
}

function evolves(data) {
  const evo = list(data.Evolutions);
  for (let i = 0; i + 1 < evo.length; i += 3) if (evo[i + 1] !== 'None') return true;
  return false;
}

// PBS stat order is HP, Atk, Def, Spe, SpA, SpD.
function baseStats(value) {
  const v = list(value).map(Number);
  return { hp: v[0], at: v[1], df: v[2], sa: v[4], sd: v[5], sp: v[3] };
}

function abilitySlots(data) {
  const normal = list(data.Abilities);
  const hidden = list(data.HiddenAbilities);
  const slots = {};
  if (normal[0]) slots[0] = nameOf(abilitiesPBS, normal[0], 'Ability');
  if (normal[1] && normal[1] !== normal[0]) slots[1] = nameOf(abilitiesPBS, normal[1], 'Ability');
  if (hidden[0] && !normal.includes(hidden[0])) slots.H = nameOf(abilitiesPBS, hidden[0], 'Ability');
  return slots;
}

const GENDER = { Genderless: 'N', AlwaysMale: 'M', AlwaysFemale: 'F' };
const BATTLE_KEYS = ['Types', 'BaseStats', 'Abilities', 'HiddenAbilities'];

const species = {};        // calc name -> species data
const formNames = {};      // "ID,form" -> calc name, only for forms that change battle stats
const baseNames = {};      // ID -> calc name
const formNameOf = {};     // calc name -> the Essentials FormName it came from

for (const [id, data] of Object.entries(speciesPBS)) {
  const name = SPECIES_OVERRIDES[data.Name] || data.Name || guess(id);
  baseNames[id] = name;
  const entry = {
    types: list(data.Types).map(typeName),
    bs: baseStats(data.BaseStats),
    weightkg: Number(data.Weight) || 0,
  };
  if (evolves(data)) entry.nfe = true;
  if (GENDER[data.GenderRatio]) entry.gender = GENDER[data.GenderRatio];
  entry.abilities = abilitySlots(data);
  species[name] = entry;
}

for (const [key, form] of Object.entries(formsPBS)) {
  const [id, num] = key.split(',');
  const base = speciesPBS[id];
  if (!base || !num || num === '0') continue;
  // Skip look-only forms (Unown letters, Vivillon patterns...) and duplicate copies of another form.
  if (!BATTLE_KEYS.some((k) => form[k])) continue;
  if (!form.FormName && form.PokedexForm) continue;

  const baseName = baseNames[id];
  const isMega = Boolean(form.MegaStone || form.MegaMove);
  let name = `${baseName}-${form.FormName ? formSuffix(baseName, form.FormName, isMega) : num}`;
  name = SPECIES_OVERRIDES[name] || name;
  if (species[name]) {
    if (form.FormName && formNameOf[name] === form.FormName) {
      // Same FormName as an earlier form (e.g. Ogerpon's duplicate masks): reuse it.
      formNames[key] = name;
      continue;
    }
    name = `${name}-${num}`;
  }
  formNameOf[name] = form.FormName;

  const merged = Object.assign({}, base, form);
  const entry = {
    types: list(merged.Types).map(typeName),
    bs: baseStats(merged.BaseStats),
    weightkg: Number(merged.Weight) || 0,
  };
  if (!isMega && evolves(form.Evolutions !== undefined ? form : base)) entry.nfe = true;
  if (GENDER[base.GenderRatio]) entry.gender = GENDER[base.GenderRatio];
  entry.abilities = abilitySlots({
    Abilities: form.Abilities || base.Abilities,
    HiddenAbilities: form.HiddenAbilities || (form.Abilities ? '' : base.HiddenAbilities),
  });
  entry.baseSpecies = baseName;
  species[name] = entry;
  formNames[key] = name;
  (species[baseName].otherFormes = species[baseName].otherFormes || []).push(name);
}

function speciesName(id, form) {
  if (!speciesPBS[id]) {
    warn(`Species ${id} isn't in pokemon.txt, so it was guessed as "${guess(id)}".`);
    return guess(id);
  }
  return (form > 0 && formNames[`${id},${form}`]) || baseNames[id];
}

// ---------------- Trainers ----------------

function defaultAbility(id, form, abilityIndex) {
  const data = Object.assign({}, speciesPBS[id] || {}, formsPBS[`${id},${form}`] || {});
  const normal = list(data.Abilities);
  const hidden = list(data.HiddenAbilities);
  return (abilityIndex >= 2 ? hidden[abilityIndex - 2] : normal[abilityIndex || 0]) || normal[0];
}

// Essentials' default moveset: the last 4 level-up moves at or below the Pokémon's level.
function defaultMoves(id, form, level) {
  const formData = formsPBS[`${id},${form}`] || {};
  const moves = list(formData.Moves || (speciesPBS[id] || {}).Moves);
  const known = [];
  for (let i = 0; i + 1 < moves.length; i += 2) {
    if (parseInt(moves[i], 10) > level) continue;
    const at = known.indexOf(moves[i + 1]);
    if (at >= 0) known.splice(at, 1);
    known.push(moves[i + 1]);
  }
  return known.slice(-4);
}

function statSpread(value, fallback) {
  const v = value ? list(value).map(Number) : [fallback];
  const s = v.length === 1 ? Array(6).fill(v[0]) : v;
  return { hp: s[0], at: s[1], df: s[2], sa: s[4], sd: s[5], sp: s[3] };
}

const POKEMON_KEYS = new Set(['Form', 'Name', 'Moves', 'Ability', 'AbilityIndex', 'Item', 'Gender', 'Nature',
  'IV', 'EV', 'Happiness', 'Shiny', 'SuperShiny', 'Shadow', 'Ball']);

const setdex = {};
let index = 0;
let trainerCount = 0;

for (const file of pbsFiles('trainers')) {
  for (const sec of parseSections(file)) {
    const [typeId, trainerName, versionStr] = sec.header.split(',');
    const version = parseInt(versionStr || '0', 10);
    let label = `${nameOf(trainerTypesPBS, typeId, 'Trainer type')} ${trainerName}`;
    if (version > 0) label += ` [${version}]`;
    trainerCount++;

    // Pokémon properties follow their "Pokemon =" line; trainer-level lines (LoseText...) are skipped.
    const team = [];
    for (const [key, value] of sec.lines) {
      if (key === 'Pokemon') {
        const [spec, lvl] = list(value);
        team.push({ spec, level: parseInt(lvl, 10), props: {} });
      } else if (POKEMON_KEYS.has(key) && team.length) {
        team[team.length - 1].props[key] = value;
      }
    }

    for (const mon of team) {
      // Species can be written GRIMER_1 instead of using a Form line.
      let id = mon.spec;
      let form = parseInt(mon.props.Form || '0', 10);
      const inline = id.match(/^(.+)_(\d+)$/);
      if (inline && !speciesPBS[id]) {
        id = inline[1];
        if (!mon.props.Form) form = parseInt(inline[2], 10);
      }

      const abilityId = mon.props.Ability ||
        defaultAbility(id, form, mon.props.AbilityIndex ? parseInt(mon.props.AbilityIndex, 10) : 0);
      const moveIds = mon.props.Moves ? list(mon.props.Moves) : defaultMoves(id, form, mon.level);
      if (!mon.props.Moves) warn(`${label}'s ${id} has no Moves line, so its level-up moves were used.`);
      if (!mon.props.Nature) warn(`${label}'s ${id} has no Nature line, so the calc's default nature is used.`);

      const set = { level: mon.level };
      if (abilityId) set.ability = nameOf(abilitiesPBS, abilityId, 'Ability');
      set.moves = moveIds.map((m) => nameOf(movesPBS, m, 'Move'));
      if (mon.props.Nature) set.nature = guess(mon.props.Nature);
      if (mon.props.Item) set.item = nameOf(itemsPBS, mon.props.Item, 'Item');
      set.ivs = statSpread(mon.props.IV, TRAINER_IV);
      set.evs = statSpread(mon.props.EV, TRAINER_EV);
      set.index = index++;

      const spName = speciesName(id, form);
      setdex[spName] = setdex[spName] || {};
      let setName = label;
      for (let n = 2; setdex[spName][setName]; n++) setName = `${label} (${n})`;
      setdex[spName][setName] = set;
    }
  }
}

// ---------------- Write files ----------------

for (const file of [SETDEX_FILE, SPECIES_FILE]) {
  if (!fs.existsSync(path.dirname(file))) {
    console.error(`Folder ${path.dirname(file)} not found. Run this from your calc folder (universalgoldcalc).`);
    process.exit(1);
  }
}

const setLines = Object.keys(setdex).sort().map((sp) => `${JSON.stringify(sp)}:${JSON.stringify(setdex[sp])}`);
fs.writeFileSync(SETDEX_FILE, `var ${SETDEX_VAR} = {${setLines.join(',\n')}};\n`);

// Every ability name: all of abilities.txt plus any used by species or trainers.
const abilityNames = new Set(Object.keys(abilitiesPBS).map((id) => nameOf(abilitiesPBS, id, 'Ability')));
for (const data of Object.values(species)) Object.values(data.abilities).forEach((a) => abilityNames.add(a));
for (const sets of Object.values(setdex)) Object.values(sets).forEach((s) => s.ability && abilityNames.add(s.ability));

const speciesLines = Object.entries(species).map(([name, data]) => `  ${JSON.stringify(name)}: ${JSON.stringify(data)},`);
fs.writeFileSync(SPECIES_FILE,
  '// Generated by tools/convert_pbs.js from Universal Gold\'s PBS files. Don\'t edit by hand: rerun the script.\n' +
  'export const UG_SPECIES: {[name: string]: any} = {\n' + speciesLines.join('\n') + '\n};\n\n' +
  `export const UG_ABILITIES: string[] = ${JSON.stringify([...abilityNames].sort())};\n`);

console.log(`Wrote ${index} Pokémon from ${trainerCount} trainers to ${SETDEX_FILE}`);
console.log(`Wrote ${Object.keys(species).length} species and forms to ${SPECIES_FILE}`);
if (warnings.size) {
  console.log(`\n${warnings.size} warning(s):`);
  [...warnings].slice(0, 40).forEach((w) => console.log(`  - ${w}`));
  if (warnings.size > 40) console.log(`  ...and ${warnings.size - 40} more.`);
}
