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

function parseIntLike(value) {
  if (!value) return null;
  const trimmed = value.trim();
  const parsed = Number.parseInt(trimmed, trimmed.startsWith('0x') ? 16 : 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function parseExperienceMap(text) {
  const map = new Map();
  let depth = 0;
  let id = null;
  let baseExp = null;
  let jobExp = null;

  function commit() {
    if (id === null) return;
    const previous = map.get(id) || {};
    map.set(id, {
      baseExp: baseExp ?? previous.baseExp ?? 0,
      jobExp: jobExp ?? previous.jobExp ?? 0,
    });
  }

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (trimmed === '{') {
      depth += 1;
      if (depth === 1) {
        id = null;
        baseExp = null;
        jobExp = null;
      }
      continue;
    }

    if (depth === 1) {
      const idMatch = trimmed.match(/^Id\s*:\s*(-?\d+)\b/);
      if (idMatch) id = parseIntLike(idMatch[1]);

      const expMatch = trimmed.match(/^(?:Exp|BaseExp)\s*:\s*(-?\d+)\b/);
      if (expMatch) baseExp = parseIntLike(expMatch[1]) ?? 0;

      const jobExpMatch = trimmed.match(/^(?:JExp|JobExp)\s*:\s*(-?\d+)\b/);
      if (jobExpMatch) jobExp = parseIntLike(jobExpMatch[1]) ?? 0;
    }

    if (trimmed === '}' || trimmed === '},') {
      if (depth === 1) commit();
      depth = Math.max(0, depth - 1);
    }
  }

  return map;
}

async function loadExperienceMap() {
  const files = await walk(CACHE_ROOT);
  const dbMarker = path.sep + 'db' + path.sep;
  const mobDbFiles = files.filter((file) => /^mob_db2?\.conf$/.test(path.basename(file)) && file.includes(dbMarker));
  if (!mobDbFiles.length) {
    throw new Error('Could not find Hercules mob_db.conf files in .cache. Run npm run generate:data first.');
  }

  const combined = new Map();
  for (const file of mobDbFiles) {
    const parsed = parseExperienceMap(await fs.readFile(file, 'utf8'));
    for (const [id, exp] of parsed) combined.set(id, exp);
  }

  if (!combined.size) {
    throw new Error('Found mob_db.conf files but could not parse any experience entries.');
  }

  return combined;
}

async function main() {
  const experienceMap = await loadExperienceMap();
  const monsters = JSON.parse(await fs.readFile(DATA_PATH, 'utf8'));
  if (!Array.isArray(monsters)) throw new Error(DATA_PATH + ' must contain an array.');

  let updated = 0;
  let missing = 0;
  for (const monster of monsters) {
    const exp = experienceMap.get(Number(monster.id));
    if (exp) {
      const nextBase = exp.baseExp ?? 0;
      const nextJob = exp.jobExp ?? 0;
      if (monster.baseExp !== nextBase || monster.jobExp !== nextJob) updated += 1;
      monster.baseExp = nextBase;
      monster.jobExp = nextJob;
    } else {
      monster.baseExp = Number.isFinite(Number(monster.baseExp)) ? Number(monster.baseExp) : 0;
      monster.jobExp = Number.isFinite(Number(monster.jobExp)) ? Number(monster.jobExp) : 0;
      missing += 1;
    }
  }

  await fs.writeFile(DATA_PATH, JSON.stringify(monsters, null, 2) + '\n');
  const withExperience = monsters.filter((monster) => Number(monster.baseExp) > 0 || Number(monster.jobExp) > 0).length;
  console.log('Experience map entries parsed: ' + experienceMap.size.toLocaleString());
  console.log('Monsters with base/job EXP: ' + withExperience.toLocaleString() + ' / ' + monsters.length.toLocaleString() + ' (updated ' + updated.toLocaleString() + ', missing ' + missing.toLocaleString() + ')');
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
