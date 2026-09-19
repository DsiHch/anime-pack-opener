#!/usr/bin/env node
/**
 * Ship a PARTIAL catalog ASAP from anime that Jikan can serve right now.
 * Then enrich legendaries with Giphy (GIPHY_API_KEY from .env).
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT = join(ROOT, 'public', 'catalog.json');

function loadEnv() {
  const p = join(ROOT, '.env');
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}
loadEnv();

const JIKAN = 'https://api.jikan.moe/v4';
const GIPHY = 'https://api.giphy.com/v1/gifs/search';

// Prefer known-good + a few high-value retries with SHORT patience
const PRIORITY = [
  { id: 21, title: 'One Piece' },
  { id: 20, title: 'Naruto' },
  { id: 28755, title: 'Boruto' },
  { id: 1535, title: 'Death Note' },
  { id: 1, title: 'Cowboy Bebop' },
  { id: 9253, title: 'Steins;Gate' },
  { id: 38000, title: 'Demon Slayer' },
  { id: 40748, title: 'Jujutsu Kaisen' },
  { id: 30276, title: 'One Punch Man' },
  { id: 5114, title: 'Fullmetal Alchemist: Brotherhood' },
  { id: 16498, title: 'Attack on Titan' },
  { id: 11061, title: 'Hunter x Hunter' },
  { id: 31964, title: 'My Hero Academia' },
  { id: 50265, title: 'Spy x Family' },
  { id: 44511, title: 'Chainsaw Man' },
];

const RARITIES = [
  { id: 'commun', label: 'Commun', color: '#94a3b8' },
  { id: 'peu-commun', label: 'Peu commun', color: '#22c55e' },
  { id: 'rare', label: 'Rare', color: '#3b82f6' },
  { id: 'epique', label: 'Épique', color: '#a855f7' },
  { id: 'legendaire', label: 'Légendaire', color: '#f59e0b' },
];
const byId = Object.fromEntries(RARITIES.map((r) => [r.id, r]));

function assignRarity(c) {
  const fav = Number(c.favorites) || 0;
  let id;
  if (fav >= 50000) id = 'legendaire';
  else if (fav >= 15000) id = 'epique';
  else if (fav >= 4000) id = 'rare';
  else if (fav >= 800) id = 'peu-commun';
  else id = 'commun';
  const m = byId[id];
  return { ...c, rarity: id, rarityLabel: m.label, rarityColor: m.color };
}

function formatName(name) {
  if (!name) return 'Inconnu';
  if (name.includes(',')) {
    const [last, first] = name.split(',').map((s) => s.trim());
    return first ? `${first} ${last}` : last;
  }
  return name;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastAt = 0;

async function jikanGet(path) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const wait = Math.max(0, 500 - (Date.now() - lastAt));
    if (wait) await sleep(wait);
    lastAt = Date.now();
    try {
      const res = await fetch(`${JIKAN}${path}`, {
        headers: { Accept: 'application/json', 'User-Agent': 'anime-pack-opener-ship/1.0' },
        signal: AbortSignal.timeout(20000),
      });
      if (res.status === 429 || res.status === 504 || res.status === 502 || res.status === 503) {
        if (attempt === 0) {
          console.warn(`  ↻ ${res.status}, wait 8s`);
          await sleep(8000);
          continue;
        }
        throw new Error(`Jikan ${res.status}`);
      }
      if (!res.ok) throw new Error(`Jikan ${res.status}`);
      return await res.json();
    } catch (e) {
      if (attempt === 0) {
        console.warn(`  ↻ ${e.message}, wait 5s`);
        await sleep(5000);
        continue;
      }
      throw e;
    }
  }
}

function merge(merged, c, anime) {
  const prev = merged.get(c.id);
  if (!prev) {
    merged.set(c.id, { ...c, animeTitle: anime.title, animeId: anime.id });
    return;
  }
  const prevMain = (prev.role || '').toLowerCase() === 'main';
  const nextMain = (c.role || '').toLowerCase() === 'main';
  if ((nextMain && !prevMain) || (c.favorites || 0) > (prev.favorites || 0)) {
    merged.set(c.id, {
      ...c,
      role: nextMain ? c.role : prev.role,
      favorites: Math.max(c.favorites || 0, prev.favorites || 0),
      animeTitle: anime.title,
      animeId: anime.id,
    });
  } else {
    prev.favorites = Math.max(prev.favorites || 0, c.favorites || 0);
  }
}

function tokens(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

let lastGiphy = 0;
async function giphySearch(name, animeTitle) {
  const key = process.env.GIPHY_API_KEY;
  if (!key) return null;
  const queries = [`${name} ${animeTitle} anime`, `${name} ${animeTitle}`, `${name} anime`];
  for (const q of queries) {
    const w = Math.max(0, 300 - (Date.now() - lastGiphy));
    if (w) await sleep(w);
    lastGiphy = Date.now();
    const url = new URL(GIPHY);
    url.searchParams.set('api_key', key);
    url.searchParams.set('q', q);
    url.searchParams.set('limit', '8');
    url.searchParams.set('rating', 'g');
    const res = await fetch(url);
    if (res.status === 429) {
      await sleep(4000);
      continue;
    }
    if (!res.ok) continue;
    const data = await res.json();
    const results = data.data || [];
    if (!results.length) continue;
    const nameTok = tokens(name);
    const animeTok = tokens(animeTitle);
    const ranked = results
      .map((item) => {
        const hay = `${item.title || ''} ${item.slug || ''}`.toLowerCase();
        let score = 0;
        for (const t of nameTok) if (hay.includes(t)) score += 3;
        for (const t of animeTok) if (hay.includes(t)) score += 2;
        return { item, score, hay };
      })
      .sort((a, b) => b.score - a.score);
    const pick =
      ranked.find((r) => r.score >= 3 && nameTok.some((t) => r.hay.includes(t))) ||
      (ranked[0]?.score >= 2 ? ranked[0] : null);
    if (!pick) continue;
    const imgs = pick.item.images || {};
    return imgs.fixed_height?.url || imgs.original?.url || imgs.downsized?.url || null;
  }
  return null;
}

async function main() {
  const merged = new Map();
  const ok = [];
  const fail = [];

  console.log(`Shipping partial catalog from ${PRIORITY.length} priority anime…`);
  for (let i = 0; i < PRIORITY.length; i++) {
    const anime = PRIORITY[i];
    process.stdout.write(`[${i + 1}/${PRIORITY.length}] ${anime.title}… `);
    try {
      const data = await jikanGet(`/anime/${anime.id}/characters`);
      const chars = (data.data || [])
        .filter((row) => row.character?.images?.jpg?.image_url)
        .map((row) => ({
          id: row.character.mal_id,
          name: formatName(row.character.name),
          image: row.character.images.jpg.image_url,
          role: row.role || 'Supporting',
          favorites: row.favorites ?? 0,
        }))
        .filter((c) => c.image && !c.image.includes('questionmark'));
      for (const c of chars) merge(merged, c, anime);
      console.log(`${chars.length} (pool ${merged.size})`);
      ok.push(anime.title);
      // If we already have a solid pool, we can stop early after a few more successes
      if (merged.size >= 2500 && ok.length >= 5) {
        console.log('Pool large enough — stopping early to ship.');
        break;
      }
    } catch (e) {
      console.log(`SKIP (${e.message})`);
      fail.push(anime.title);
    }
  }

  if (merged.size < 200) {
    console.error(`Pool too small (${merged.size}) — abort`);
    process.exit(1);
  }

  let cards = [...merged.values()]
    .map(assignRarity)
    .map((c) => ({
      id: c.id,
      name: c.name,
      image: c.image,
      imageStill: c.image,
      role: c.role,
      favorites: c.favorites ?? 0,
      animeTitle: c.animeTitle,
      animeId: c.animeId,
      rarity: c.rarity,
      rarityLabel: c.rarityLabel,
      rarityColor: c.rarityColor,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const legends = cards.filter((c) => c.rarity === 'legendaire');
  console.log(`\nGiphy: ${legends.length} legendaries…`);
  let gifOk = 0;
  for (let i = 0; i < legends.length; i++) {
    const c = legends[i];
    process.stdout.write(`  [${i + 1}/${legends.length}] ${c.name}… `);
    try {
      const gif = await giphySearch(c.name, c.animeTitle || '');
      if (gif) {
        c.imageGif = gif;
        gifOk += 1;
        console.log('ok');
      } else console.log('no match');
    } catch (e) {
      console.log(`err ${e.message}`);
    }
  }

  const byRarity = Object.fromEntries(RARITIES.map((r) => [r.id, 0]));
  for (const c of cards) byRarity[c.rarity] += 1;

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(cards));
  console.log(`\nWrote ${cards.length} chars → ${OUT}`);
  console.log('Rarity:', byRarity);
  console.log(`Giphy GIFs: ${gifOk}/${legends.length}`);
  console.log('OK anime:', ok.join(', '));
  if (fail.length) console.log('Skipped:', fail.join(', '));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
