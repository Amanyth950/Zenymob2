import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

const DATA_PATH = process.argv[2] && !process.argv[2].startsWith('--')
  ? process.argv[2]
  : path.join(process.cwd(), 'public', 'data', 'monsters.json');
const OUT_DIR = path.join(process.cwd(), 'public', 'sprites', 'monsters');
const SOURCE_BASE = 'https://nn.ai4rei.net/dev/npclist';
const IMAGE_BASE = SOURCE_BASE + '/i';
const FORCE = process.argv.includes('--force');
const ALL = process.argv.includes('--all');
const NO_CATALOG = process.argv.includes('--no-catalog');
const LIMIT = numberArg('--limit=');
const DELAY_MS = numberArg('--delay=') ?? 125;

function numberArg(prefix) {
  const raw = process.argv.find((arg) => arg.startsWith(prefix));
  if (!raw) return null;
  const parsed = Number(raw.slice(prefix.length));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function spriteNameFor(monster) {
  return typeof monster.spriteName === 'string' ? monster.spriteName.trim() : '';
}

function safeFileName(spriteName) {
  return spriteName.replace(/[^A-Za-z0-9_.-]/g, '_') + '.gif';
}

function absoluteUrl(src) {
  return new URL(src.replace(/&amp;/g, '&'), SOURCE_BASE + '/').href;
}

async function cleanupZeroByteGifs() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const files = await fs.readdir(OUT_DIR).catch(() => []);
  let removed = 0;
  for (const file of files) {
    if (!file.toLowerCase().endsWith('.gif')) continue;
    const filePath = path.join(OUT_DIR, file);
    const stat = await fs.stat(filePath).catch(() => null);
    if (stat && stat.size === 0) {
      await fs.unlink(filePath);
      removed += 1;
    }
  }
  if (removed) console.log('Removed ' + removed + ' zero-byte GIF files.');
}

async function readMonsters() {
  const raw = await fs.readFile(DATA_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error(DATA_PATH + ' must contain a monster array.');
  return parsed;
}

function uniqueMonstersWithSprites(monsters) {
  const bySprite = new Map();
  for (const monster of monsters) {
    const spriteName = spriteNameFor(monster);
    if (!spriteName) continue;
    const key = spriteName + ':' + monster.id;
    if (!bySprite.has(key)) bySprite.set(key, monster);
  }
  return [...bySprite.values()].sort((a, b) => spriteNameFor(a).localeCompare(spriteNameFor(b)) || a.id - b.id);
}

async function fetchCatalogById() {
  if (NO_CATALOG) return new Map();
  const url = SOURCE_BASE + '/?q=type%3Amonster';
  console.log('Fetching nn.ai4rei monster catalog for ID-to-image mapping...');
  const response = await fetch(url, {
    headers: {
      'user-agent': 'zenymob2-sprite-sync/1.0 (+https://github.com/Amanyth950/Zenymob2)',
      'accept': 'text/html,application/xhtml+xml',
    },
  });
  if (!response.ok) {
    console.warn('Could not fetch catalog: HTTP ' + response.status + ' ' + response.statusText);
    return new Map();
  }

  const html = await response.text();
  const catalog = new Map();
  const pieces = html.split(/<img\b/i).slice(1);
  for (const piece of pieces) {
    const srcMatch = piece.match(/src=["']([^"']+\.gif(?:\?[^"']*)?)["']/i);
    const idMatch = piece.match(/ID:\s*(\d+)\s*\(/i);
    if (!srcMatch || !idMatch) continue;
    catalog.set(Number(idMatch[1]), absoluteUrl(srcMatch[1]));
  }
  console.log('Catalog contains ' + catalog.size.toLocaleString() + ' monster image mappings.');
  return catalog;
}

function directUrl(spriteName) {
  return IMAGE_BASE + '/' + encodeURIComponent(spriteName) + '.gif';
}

function candidateUrls(monster, catalogById) {
  const spriteName = spriteNameFor(monster);
  const urls = [];
  const catalogUrl = catalogById.get(Number(monster.id));
  if (catalogUrl) urls.push({ source: 'catalog-id', url: catalogUrl });
  urls.push({ source: 'sprite-name', url: directUrl(spriteName) });
  return [...new Map(urls.map((candidate) => [candidate.url, candidate])).values()];
}

function isGif(buffer) {
  if (!buffer || buffer.length < 6) return false;
  const signature = buffer.subarray(0, 6).toString('ascii');
  return signature === 'GIF87a' || signature === 'GIF89a';
}

async function tryDownload(url) {
  const response = await fetch(url, {
    headers: {
      'user-agent': 'zenymob2-sprite-sync/1.0 (+https://github.com/Amanyth950/Zenymob2)',
      'referer': SOURCE_BASE + '/',
      'accept': 'image/gif,image/*;q=0.9,*/*;q=0.1',
    },
  });

  if (!response.ok) {
    return { ok: false, reason: 'HTTP ' + response.status + ' ' + response.statusText };
  }

  const contentType = response.headers.get('content-type') || '';
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!contentType.toLowerCase().includes('image') && !isGif(bytes)) {
    return { ok: false, reason: 'non-image response (' + (contentType || 'no content-type') + ')' };
  }
  if (!isGif(bytes)) {
    return { ok: false, reason: 'response is not a GIF (' + bytes.length + ' bytes)' };
  }
  return { ok: true, bytes };
}

async function syncSprite(monster, catalogById) {
  const spriteName = spriteNameFor(monster);
  const target = path.join(OUT_DIR, safeFileName(spriteName));
  if (!FORCE && existsSync(target)) {
    const stat = await fs.stat(target).catch(() => null);
    if (stat && stat.size > 0) return { status: 'skipped', spriteName };
  }

  const errors = [];
  for (const candidate of candidateUrls(monster, catalogById)) {
    const result = await tryDownload(candidate.url);
    if (result.ok) {
      await fs.writeFile(target, result.bytes);
      console.log('wrote ' + path.relative(process.cwd(), target) + ' (' + result.bytes.length.toLocaleString() + ' bytes, ' + candidate.source + ')');
      return { status: 'written', spriteName };
    }
    errors.push(candidate.source + ': ' + result.reason);
    await sleep(DELAY_MS);
  }

  console.warn('miss ' + spriteName + ' [ID ' + monster.id + ']: ' + errors.join('; '));
  return { status: 'missing', spriteName };
}

async function main() {
  await cleanupZeroByteGifs();
  const monsters = uniqueMonstersWithSprites(await readMonsters());
  if (!monsters.length) {
    console.log('No spriteName values found. Run npm run generate:data and confirm public/data/monsters.json contains "spriteName".');
    return;
  }

  const pending = FORCE ? monsters : monsters.filter((monster) => {
    const target = path.join(OUT_DIR, safeFileName(spriteNameFor(monster)));
    if (!existsSync(target)) return true;
    return false;
  });

  const selected = LIMIT ? pending.slice(0, LIMIT) : pending;
  const catalogById = await fetchCatalogById();

  console.log('Found ' + monsters.length.toLocaleString() + ' monster sprite names in the dataset.');
  console.log((monsters.length - pending.length).toLocaleString() + ' already have local GIF files.');
  console.log('Syncing ' + selected.length.toLocaleString() + ' missing monster sprites from nn.ai4rei.net...');
  if (LIMIT && pending.length > LIMIT) console.log('Limited mode. Remaining missing after this run: ' + (pending.length - LIMIT).toLocaleString());
  if (!LIMIT && !ALL && selected.length > 200) console.log('Large run. Add --limit=25 for a small test or Ctrl+C to stop.');

  const results = [];
  for (const monster of selected) {
    results.push(await syncSprite(monster, catalogById));
    await sleep(DELAY_MS);
  }

  const counts = results.reduce((acc, result) => {
    acc[result.status] = (acc[result.status] || 0) + 1;
    return acc;
  }, {});
  console.log('Done. ' + JSON.stringify(counts));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
