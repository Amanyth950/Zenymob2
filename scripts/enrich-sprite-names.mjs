import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const DATA_PATH = process.argv.find((arg) => arg.endsWith('.json')) || path.join(root, 'public', 'data', 'monsters.json');
const CACHE_ROOT = path.join(root, '.cache');

async function exists(filePath) {
  try { await fs.access(filePath); return true; } catch { return false; }
}

async function walk(dir, acc = []) {
  if (!(await exists(dir))) return acc;
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, acc);
    else if (entry.isFile()) acc.push(full);
  }
  return acc;
}

function parseSpriteMap(text) {
  const map = new Map();
  let depth = 0;
  let id = null;
  let spriteName = null;

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (trimmed === '{') {
      depth += 1;
      if (depth === 1) {
        id = null;
        spriteName = null;
      }
      continue;
    }

    if (depth === 1) {
      const idMatch = trimmed.match(/^Id\s*:\s*(\d+)\b/);
      if (idMatch) id = Number(idMatch[1]);

      const spriteMatch = trimmed.match(/^SpriteName\s*:\s*"([^"]+)"/);
      if (spriteMatch) spriteName = spriteMatch[1];
    }

    if (trimmed === '}' || trimmed === '},') {
      if (depth === 1 && id !== null && spriteName) {
        map.set(id, spriteName);
      }
      depth = Math.max(0, depth - 1);
    }
  }

  return map;
}

async function loadSpriteMap() {
  const files = await walk(CACHE_ROOT);
  const dbMarker = path.sep + 'db' + path.sep;
  const mobDbFiles = files.filter((file) => path.basename(file) === 'mob_db.conf' && file.includes(dbMarker));
  if (!mobDbFiles.length) {
    throw new Error('Could not find Hercules mob_db.conf in .cache. Run npm run generate:data once first.');
  }

  const combined = new Map();
  for (const file of mobDbFiles) {
    const parsed = parseSpriteMap(await fs.readFile(file, 'utf8'));
    for (const [id, spriteName] of parsed) combined.set(id, spriteName);
  }

  if (!combined.size) {
    throw new Error('Found mob_db.conf but could not parse any SpriteName entries.');
  }

  return combined;
}

async function main() {
  const spriteMap = await loadSpriteMap();
  const monsters = JSON.parse(await fs.readFile(DATA_PATH, 'utf8'));
  if (!Array.isArray(monsters)) throw new Error(DATA_PATH + ' must contain an array.');

  let refreshed = 0;
  let missing = 0;
  for (const monster of monsters) {
    const spriteName = spriteMap.get(Number(monster.id));
    if (spriteName) {
      if (monster.spriteName !== spriteName) refreshed += 1;
      monster.spriteName = spriteName;
    } else {
      missing += 1;
    }
  }

  await fs.writeFile(DATA_PATH, JSON.stringify(monsters, null, 2) + '\n');
  const totalWithSpriteName = monsters.filter((monster) => typeof monster.spriteName === 'string' && monster.spriteName.trim()).length;
  console.log('Sprite map entries parsed: ' + spriteMap.size);
  console.log('Monsters with spriteName: ' + totalWithSpriteName + ' / ' + monsters.length + ' (refreshed ' + refreshed + ', missing ' + missing + ')');
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
