import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

const HERCULES_REF = process.env.HERCULES_REF || 'master';
const ARCHIVE_URL = `https://github.com/HerculesWS/Hercules/archive/refs/heads/${HERCULES_REF}.tar.gz`;
const CACHE_DIR = path.join(process.cwd(), '.cache');
const ARCHIVE_PATH = path.join(CACHE_DIR, `hercules-${HERCULES_REF}.tar.gz`);
const SOURCE_DIR = path.join(CACHE_DIR, `hercules-${HERCULES_REF}`);
const OUTPUT_PATH = path.join(process.cwd(), 'public', 'data', 'monsters.json');
const METADATA_PATH = path.join(process.cwd(), 'public', 'data', 'metadata.json');

class DuplicateValues {
  constructor(values) {
    this.values = values;
  }
}

function isDuplicate(value) {
  return value instanceof DuplicateValues;
}

function clone(value) {
  if (isDuplicate(value)) return new DuplicateValues(value.values.map(clone));
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]));
  }
  return value;
}

class HerculesConfParser {
  constructor(text, source) {
    this.text = text;
    this.source = source;
    this.tokens = [...this.tokenize(text)];
    this.pos = 0;
  }

  static parse(text, source) {
    return new HerculesConfParser(text, source).parse();
  }

  *tokenize(text) {
    let i = 0;
    const n = text.length;
    const punct = new Set(['{', '}', '(', ')', '[', ']', ':', ',', ';']);

    while (i < n) {
      const ch = text[i];
      const next = i + 1 < n ? text[i + 1] : '';

      if (/\s/.test(ch)) {
        i += 1;
        continue;
      }

      if (ch === '/' && next === '/') {
        i += 2;
        while (i < n && !'\r\n'.includes(text[i])) i += 1;
        continue;
      }

      if (ch === '/' && next === '*') {
        const end = text.indexOf('*/', i + 2);
        i = end === -1 ? n : end + 2;
        continue;
      }

      if (ch === '<' && next === '"') {
        i += 2;
        const buffer = [];
        while (i < n) {
          if (text[i] === '"' && i + 1 < n && text[i + 1] === '>') {
            i += 2;
            break;
          }
          if (text[i] === '\\' && i + 1 < n) {
            buffer.push(text[i + 1]);
            i += 2;
            continue;
          }
          buffer.push(text[i]);
          i += 1;
        }
        yield ['STRING', buffer.join('')];
        continue;
      }

      if (ch === '"') {
        i += 1;
        const buffer = [];
        while (i < n) {
          if (text[i] === '"') {
            i += 1;
            break;
          }
          if (text[i] === '\\' && i + 1 < n) {
            const esc = text[i + 1];
            buffer.push(esc === 'n' ? '\n' : esc === 't' ? '\t' : esc);
            i += 2;
            continue;
          }
          buffer.push(text[i]);
          i += 1;
        }
        yield ['STRING', buffer.join('')];
        continue;
      }

      if (punct.has(ch)) {
        yield [ch, ch];
        i += 1;
        continue;
      }

      if (ch === '-' || /\d/.test(ch)) {
        const start = i;
        if (ch === '-') i += 1;
        if (i + 1 < n && text[i] === '0' && ['x', 'X'].includes(text[i + 1])) {
          i += 2;
          while (i < n && /[0-9a-fA-F]/.test(text[i])) i += 1;
          yield ['NUMBER', Number.parseInt(text.slice(start, i), 16)];
          continue;
        }
        while (i < n && /\d/.test(text[i])) i += 1;
        if (i < n && text[i] === '.') {
          i += 1;
          while (i < n && /\d/.test(text[i])) i += 1;
          yield ['NUMBER', Number.parseFloat(text.slice(start, i))];
        } else {
          yield ['NUMBER', Number.parseInt(text.slice(start, i), 10)];
        }
        continue;
      }

      if (/[A-Za-z_]/.test(ch)) {
        const start = i;
        i += 1;
        while (i < n && /[A-Za-z0-9_]/.test(text[i])) i += 1;
        const ident = text.slice(start, i);
        if (ident === 'true') yield ['BOOL', true];
        else if (ident === 'false') yield ['BOOL', false];
        else yield ['IDENT', ident];
        continue;
      }

      throw new Error(`Unexpected character ${JSON.stringify(ch)} in ${this.source} at offset ${i}`);
    }
  }

  parse() {
    if (this.tokens.length === 0) return {};
    if (this.peekType() === 'IDENT' && this.peekType(1) === ':') {
      const key = String(this.advance()[1]);
      this.expect(':');
      return { [key]: this.parseValue() };
    }
    return { _root: this.parseValue() };
  }

  peek(offset = 0) {
    return this.tokens[this.pos + offset];
  }

  peekType(offset = 0) {
    const token = this.peek(offset);
    return token ? token[0] : undefined;
  }

  advance() {
    if (this.pos >= this.tokens.length) throw new Error(`Unexpected end of input in ${this.source}`);
    const token = this.tokens[this.pos];
    this.pos += 1;
    return token;
  }

  expect(type) {
    const token = this.advance();
    if (token[0] !== type) throw new Error(`Expected ${type}, got ${token[0]} in ${this.source}`);
    return token;
  }

  consumeIf(type) {
    if (this.peekType() === type) {
      this.pos += 1;
      return true;
    }
    return false;
  }

  parseValue() {
    const [type, value] = this.advance();
    if (type === '{') return this.parseObject();
    if (type === '(') return this.parseSequence(')');
    if (type === '[') return this.parseSequence(']');
    if (['STRING', 'NUMBER', 'BOOL'].includes(type)) return value;
    if (type === 'IDENT') return value;
    throw new Error(`Unexpected token ${type} in ${this.source}`);
  }

  parseSequence(endType) {
    const values = [];
    while (this.peekType() !== endType) {
      if (!this.peekType()) throw new Error(`Unclosed sequence in ${this.source}`);
      if (this.consumeIf(',') || this.consumeIf(';')) continue;
      values.push(this.parseValue());
      this.consumeIf(',');
      this.consumeIf(';');
    }
    this.expect(endType);
    return values;
  }

  parseObject() {
    const object = {};
    while (this.peekType() !== '}') {
      if (!this.peekType()) throw new Error(`Unclosed object in ${this.source}`);
      if (this.consumeIf(',') || this.consumeIf(';')) continue;

      const keyToken = this.advance();
      if (!['IDENT', 'STRING', 'NUMBER'].includes(keyToken[0])) {
        throw new Error(`Expected object key, got ${keyToken[0]} in ${this.source}`);
      }
      const key = String(keyToken[1]);
      const value = this.consumeIf(':') ? this.parseValue() : true;

      if (Object.prototype.hasOwnProperty.call(object, key)) {
        if (isDuplicate(object[key])) object[key].values.push(value);
        else object[key] = new DuplicateValues([object[key], value]);
      } else {
        object[key] = value;
      }

      this.consumeIf(',');
      this.consumeIf(';');
    }
    this.expect('}');
    return object;
  }
}

function asInt(value, defaultValue = null) {
  if (value === null || value === undefined || value === '') return defaultValue;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number') return Number.isFinite(value) ? Math.trunc(value) : defaultValue;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return defaultValue;
    const parsed = Number.parseInt(trimmed, trimmed.startsWith('0x') ? 16 : 10);
    return Number.isFinite(parsed) ? parsed : defaultValue;
  }
  return defaultValue;
}

function asBool(value, defaultValue = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return ['true', 'yes', '1'].includes(value.toLowerCase());
  if (typeof value === 'number') return value !== 0;
  return defaultValue;
}

function firstInt(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (Array.isArray(value) && value.length > 0) return firstInt(value[0]);
  return asInt(value, null);
}

function valueToString(value) {
  if (value === null || value === undefined) return null;
  return String(value);
}

function enumLabel(value) {
  return String(value || '')
    .replace(/^Ele_/, '')
    .replace(/^RC_/, '')
    .replace(/^Size_/, '')
    .replaceAll('_', ' ')
    .trim();
}

function elementLabel(type, level) {
  const base = enumLabel(type);
  return base && level ? `${base} ${level}` : base;
}

async function readText(filePath) {
  return fs.readFile(filePath, 'utf8');
}

async function loadDbEntries(filePath, rootKey) {
  if (!existsSync(filePath)) return [];
  const parsed = HerculesConfParser.parse(await readText(filePath), filePath);
  const root = parsed[rootKey];
  if (!Array.isArray(root)) return [];
  return root.filter((entry) => entry && typeof entry === 'object');
}

function normalizeItem(raw, existingById, existingByAegis, source) {
  const itemId = asInt(raw.Id, null);
  if (itemId === null) return null;

  let base = {};
  if (asBool(raw.Inherit, false) && existingById.has(itemId)) base = clone(existingById.get(itemId));

  if (raw.CloneItem !== undefined) {
    let cloned = null;
    const cloneId = asInt(raw.CloneItem, null);
    if (cloneId !== null) cloned = existingById.get(cloneId);
    if (!cloned) cloned = existingByAegis.get(String(raw.CloneItem));
    if (cloned) base = { ...clone(cloned), ...base };
  }

  const item = { ...base, ...raw };
  const aegisName = valueToString(item.AegisName) || `ITEM_${itemId}`;
  const displayName = valueToString(item.Name) || aegisName;
  let buy = asInt(item.Buy, null);
  let sell = asInt(item.Sell, null);
  if (sell === null && buy !== null) sell = Math.floor(buy / 2);
  if (buy === null && sell !== null) buy = sell * 2;

  return {
    id: itemId,
    aegisName,
    name: displayName,
    type: valueToString(item.Type) || 'IT_ETC',
    buy: buy ?? 0,
    sell: sell ?? 0,
    ignoreOvercharge: asBool(item.IgnoreOvercharge, false),
    source,
  };
}

async function loadItems(sourceDir) {
  const byId = new Map();
  const byAegis = new Map();
  const paths = [
    path.join(sourceDir, 'db', 'pre-re', 'item_db.conf'),
    path.join(sourceDir, 'db', 'pre-re', 'item_db2.conf'),
    path.join(sourceDir, 'db', 'import', 'item_db.conf'),
    path.join(sourceDir, 'db', 'import', 'item_db2.conf'),
  ];

  for (const filePath of paths) {
    const entries = await loadDbEntries(filePath, 'item_db');
    for (const raw of entries) {
      const item = normalizeItem(raw, byId, byAegis, filePath);
      if (!item) continue;
      byId.set(item.id, item);
      byAegis.set(item.aegisName, item);
    }
  }
  return { byId, byAegis };
}

function iterDropSlots(rawChance) {
  if (isDuplicate(rawChance)) return rawChance.values;
  return [rawChance];
}

function normalizeDrops(rawDrops) {
  if (!rawDrops || typeof rawDrops !== 'object') return [];
  const drops = [];
  for (const [aegisName, rawChance] of Object.entries(rawDrops)) {
    for (const slot of iterDropSlots(rawChance)) {
      const chance = firstInt(slot);
      if (!chance || chance <= 0) continue;
      drops.push({ aegisName, chance });
    }
  }
  return drops.sort((a, b) => b.chance - a.chance || a.aegisName.localeCompare(b.aegisName));
}

function normalizeMonster(raw, existingById, source) {
  const id = asInt(raw.Id, null);
  if (id === null) return null;

  let base = {};
  if (asBool(raw.Inherit, false) && existingById.has(id)) base = clone(existingById.get(id));
  const mob = { ...base, ...raw };
  const mode = mob.Mode && typeof mob.Mode === 'object' ? mob.Mode : {};
  const element = mob.Element;
  let elementType = null;
  let elementLevel = null;
  if (Array.isArray(element)) {
    elementType = valueToString(element[0]);
    elementLevel = asInt(element[1], null);
  } else if (typeof element === 'string') {
    elementType = element;
  }

  const spriteName = valueToString(mob.SpriteName) || valueToString(mob.Name) || String(id);
  const internalName = valueToString(mob.Name) || spriteName;
  const displayName = valueToString(mob.JName) || internalName;
  const mvpDrops = normalizeDrops(mob.MvpDrops);
  const mvpExp = asInt(mob.MvpExp, 0) || 0;

  return {
    id,
    spriteName,
    internalName,
    name: displayName,
    level: asInt(mob.Lv, 1) || 1,
    hp: asInt(mob.Hp, 1) || 1,
    race: enumLabel(valueToString(mob.Race) || 'RC_Formless'),
    size: enumLabel(valueToString(mob.Size) || 'Size_Medium'),
    element: elementLabel(elementType, elementLevel),
    isBoss: asBool(mode.Boss, false),
    hasMvpDrops: mvpDrops.length > 0 || mvpExp > 0,
    drops: normalizeDrops(mob.Drops),
    mvpDrops,
    source,
  };
}

async function loadMonsters(sourceDir) {
  const monsters = new Map();
  const paths = [
    path.join(sourceDir, 'db', 'pre-re', 'mob_db.conf'),
    path.join(sourceDir, 'db', 'pre-re', 'mob_db2.conf'),
    path.join(sourceDir, 'db', 'import', 'mob_db.conf'),
    path.join(sourceDir, 'db', 'import', 'mob_db2.conf'),
  ];

  for (const filePath of paths) {
    const entries = await loadDbEntries(filePath, 'mob_db');
    for (const raw of entries) {
      const monster = normalizeMonster(raw, monsters, filePath);
      if (!monster) continue;
      monsters.set(monster.id, monster);
    }
  }
  return monsters;
}

function stripScriptComments(text) {
  let out = '';
  let i = 0;
  let inString = false;
  while (i < text.length) {
    const ch = text[i];
    const next = i + 1 < text.length ? text[i + 1] : '';
    if (inString) {
      out += ch;
      if (ch === '\\' && i + 1 < text.length) {
        out += text[i + 1];
        i += 2;
        continue;
      }
      if (ch === '"') inString = false;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '/') {
      while (i < text.length && !'\r\n'.includes(text[i])) i += 1;
      if (i < text.length) out += text[i++];
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i + 1 < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
        if ('\r\n'.includes(text[i])) out += text[i];
        i += 1;
      }
      i += i + 1 < text.length ? 2 : 0;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

const SPAWN_RE = /^\s*([A-Za-z0-9_]+),[^\r\n\t]*[\t ]+monster[\t ]+(.+?)[\t ]+(-?\d+)\s*,\s*(\d+)\b/i;

async function walkFiles(root) {
  if (!existsSync(root)) return [];
  const found = [];
  async function walk(current) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(fullPath);
      else if (entry.isFile() && ['.txt', '.conf'].includes(path.extname(entry.name).toLowerCase())) found.push(fullPath);
    }
  }
  await walk(root);
  return found;
}

async function loadSpawns(sourceDir) {
  const spawnCounts = new Map();
  const roots = [path.join(sourceDir, 'npc', 'pre-re', 'mobs'), path.join(sourceDir, 'npc', 'mobs')];
  const files = (await Promise.all(roots.map(walkFiles))).flat();
  let matched = 0;

  for (const filePath of files) {
    const text = stripScriptComments(await readText(filePath));
    for (const line of text.split(/\r?\n/)) {
      const match = SPAWN_RE.exec(line);
      if (!match) continue;
      const mapName = match[1];
      const mobId = Number.parseInt(match[3], 10);
      const amount = Number.parseInt(match[4], 10);
      if (!mobId || mobId <= 0 || !amount || amount <= 0) continue;
      if (!spawnCounts.has(mobId)) spawnCounts.set(mobId, new Map());
      const maps = spawnCounts.get(mobId);
      maps.set(mapName, (maps.get(mapName) || 0) + amount);
      matched += 1;
    }
  }

  console.log(`Scanned ${files.length} spawn files and matched ${matched} permanent spawn lines.`);
  return spawnCounts;
}

function spawnList(spawnMap) {
  if (!spawnMap) return [];
  return [...spawnMap.entries()]
    .map(([map, count]) => ({ map, count }))
    .sort((a, b) => b.count - a.count || a.map.localeCompare(b.map));
}

function itemDrop(drop, item, type) {
  return {
    itemId: item?.id,
    itemKey: drop.aegisName,
    name: item?.name || drop.aegisName,
    chance: drop.chance,
    baseSellPrice: item?.sell || 0,
    ignoreOvercharge: item?.ignoreOvercharge || false,
    type,
  };
}

function frontendMonster(monster, items, spawns) {
  const normalDrops = monster.drops.map((drop) => itemDrop(drop, items.byAegis.get(drop.aegisName), 'normal'));
  const mvpDrops = monster.mvpDrops.map((drop) => itemDrop(drop, items.byAegis.get(drop.aegisName), 'mvp'));
  return {
    id: monster.id,
    name: monster.name,
    level: monster.level,
    hp: monster.hp,
    element: monster.element,
    race: monster.race,
    size: monster.size,
    isBoss: monster.isBoss,
    hasMvpDrops: monster.hasMvpDrops,
    spawns: spawnList(spawns.get(monster.id)),
    drops: [...normalDrops, ...mvpDrops],
  };
}

async function downloadArchive() {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  if (!existsSync(ARCHIVE_PATH)) {
    console.log(`Downloading Hercules ${HERCULES_REF} archive...`);
    const response = await fetch(ARCHIVE_URL, { headers: { 'user-agent': 'zenymob2-data-generator' } });
    if (!response.ok) throw new Error(`Failed to download ${ARCHIVE_URL}: ${response.status} ${response.statusText}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    await fs.writeFile(ARCHIVE_PATH, buffer);
  }

  if (!existsSync(SOURCE_DIR)) {
    await fs.mkdir(SOURCE_DIR, { recursive: true });
    console.log('Extracting Hercules archive...');
    execFileSync('tar', ['-xzf', ARCHIVE_PATH, '-C', SOURCE_DIR, '--strip-components=1'], { stdio: 'inherit' });
  }
}

async function main() {
  await downloadArchive();
  const items = await loadItems(SOURCE_DIR);
  const monsters = await loadMonsters(SOURCE_DIR);
  const spawns = await loadSpawns(SOURCE_DIR);

  const rows = [...monsters.values()]
    .sort((a, b) => a.id - b.id)
    .map((monster) => frontendMonster(monster, items, spawns));

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(rows, null, 2));
  await fs.writeFile(
    METADATA_PATH,
    JSON.stringify(
      {
        name: 'Zenymob2 generated Hercules data',
        generatedAt: new Date().toISOString(),
        herculesRef: HERCULES_REF,
        dropChanceScale: 10000,
        monsterCount: rows.length,
        itemCount: items.byId.size,
        notes: 'Generated during build from Hercules pre-renewal database files.',
      },
      null,
      2,
    ),
  );

  console.log(`Wrote ${rows.length} monsters to ${OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
