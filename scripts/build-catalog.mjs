#!/usr/bin/env node
/**
 * Builds public/catalog.json from Jikan, then enriches legendaries with Giphy GIFs.
 * GIPHY_API_KEY is read from .env (never bundled into the client).
 *
 * Usage: npm run build:catalog
 */

import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT = join(ROOT, 'public', 'catalog.json');

function loadEnv() {
  const envPath = join(ROOT, '.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!process.env[k]) process.env[k] = v;
  }
}
loadEnv();

const JIKAN = 'https://api.jikan.moe/v4';
const GIPHY = 'https://api.giphy.com/v1/gifs/search';
const MIN_INTERVAL_MS = 750;
const RETRY_BACKOFF_MS = [3000, 8000, 18000, 35000, 60000];
const RETRY_STATUSES = new Set([429, 504, 502, 503]);
const GIPHY_INTERVAL_MS = 350;
const MAX_PASSES = 6;

/** Aligned with src/jikan.js GLOBAL_ANIME_IDS */
const GLOBAL_ANIME_IDS = [
  { id: 21, title: 'One Piece' },
  { id: 20, title: 'Naruto' },
  { id: 1735, title: 'Naruto Shippuden' },
  { id: 28755, title: 'Boruto' },
  { id: 269, title: 'Bleach' },
  { id: 223, title: 'Dragon Ball' },
  { id: 813, title: 'Dragon Ball Z' },
  { id: 30694, title: 'Dragon Ball Super' },
  { id: 5114, title: 'Fullmetal Alchemist: Brotherhood' },
  { id: 16498, title: 'Attack on Titan' },
  { id: 1535, title: 'Death Note' },
  { id: 38000, title: 'Demon Slayer' },
  { id: 11061, title: 'Hunter x Hunter' },
  { id: 40748, title: 'Jujutsu Kaisen' },
  { id: 30276, title: 'One Punch Man' },
  { id: 22319, title: 'Tokyo Ghoul' },
  { id: 31964, title: 'My Hero Academia' },
  { id: 1, title: 'Cowboy Bebop' },
  { id: 44511, title: 'Chainsaw Man' },
  { id: 50265, title: 'Spy x Family' },
  { id: 52299, title: 'Solo Leveling' },
  { id: 52991, title: 'Frieren' },
  { id: 32182, title: 'Mob Psycho 100' },
  { id: 14719, title: "JoJo's Bizarre Adventure" },
  { id: 34572, title: 'Black Clover' },
  { id: 6702, title: 'Fairy Tail' },
  { id: 11757, title: 'Sword Art Online' },
  { id: 31240, title: 'Re:Zero' },
  { id: 9253, title: 'Steins;Gate' },
  { id: 37521, title: 'Vinland Saga' },
  { id: 20583, title: 'Haikyuu!!' },
  { id: 49596, title: 'Blue Lock' },
  { id: 30, title: 'Neon Genesis Evangelion' },
  { id: 1575, title: 'Code Geass' },
  { id: 19815, title: 'No Game No Life' },
  { id: 24833, title: 'Assassination Classroom' },
  { id: 38691, title: 'Dr. Stone' },
];

const RARITIES = [
  { id: 'commun', label: 'Commun', color: '#94a3b8' },
  { id: 'peu-commun', label: 'Peu commun', color: '#22c55e' },
  { id: 'rare', label: 'Rare', color: '#3b82f6' },
  { id: 'epique', label: 'Épique', color: '#a855f7' },
  { id: 'legendaire', label: 'Légendaire', color: '#f59e0b' },
];
const byId = Object.fromEntries(RARITIES.map((r) => [r.id, r]));

function assignRarity(character) {
  const fav = Number(character.favorites) || 0;
  let id;
  if (fav >= 50000) id = 'legendaire';
  else if (fav >= 15000) id = 'epique';
  else if (fav >= 4000) id = 'rare';
  else if (fav >= 800) id = 'peu-commun';
  else id = 'commun';
  const meta = byId[id];
  return { ...character, rarity: id, rarityLabel: meta.label, rarityColor: meta.color };
}

function formatName(name) {
  if (!name) return 'Inconnu';
  if (name.includes(',')) {
    const [last, first] = name.split(',').map((s) => s.trim());
    return first ? `${first} ${last}` : last;
  }
  return name;
}

function isQuestionMark(url) {
  return !url || url.includes('questionmark');
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

let lastRequestAt = 0;
let consecutive504 = 0;

async function jikanFetch(path) {
  const maxAttempts = 1 + RETRY_BACKOFF_MS.length;
  let lastErr;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const wait = Math.max(0, MIN_INTERVAL_MS - (Date.now() - lastRequestAt));
    if (wait) await sleep(wait);
    // Extra cool-down after a streak of gateway errors
    if (consecutive504 >= 2) {
      const cool = Math.min(45000, 8000 * consecutive504);
      console.warn(`  … cool-down ${cool}ms after ${consecutive504}×504`);
      await sleep(cool);
      consecutive504 = 0;
    }
    lastRequestAt = Date.now();

    try {
      const res = await fetch(`${JIKAN}${path}`, {
        headers: { Accept: 'application/json', 'User-Agent': 'anime-pack-opener-catalog/1.1' },
      });
      if (RETRY_STATUSES.has(res.status)) {
        lastErr = new Error(`Jikan ${res.status}`);
        if (res.status === 504 || res.status === 502 || res.status === 503) consecutive504 += 1;
        if (attempt < RETRY_BACKOFF_MS.length) {
          const backoff = RETRY_BACKOFF_MS[attempt];
          console.warn(`  ↻ ${res.status} → retry in ${backoff}ms (${path})`);
          await sleep(backoff);
          lastRequestAt = Date.now();
          continue;
        }
        throw lastErr;
      }
      if (!res.ok) throw new Error(`Jikan ${res.status}`);
      consecutive504 = 0;
      return await res.json();
    } catch (e) {
      lastErr = e;
      const msg = String(e?.message || '');
      const retryable =
        e instanceof TypeError || /Jikan (429|504|502|503)/.test(msg) || /fetch failed/i.test(msg);
      if (retryable && attempt < RETRY_BACKOFF_MS.length) {
        const backoff = RETRY_BACKOFF_MS[attempt];
        console.warn(`  ↻ ${msg} → retry in ${backoff}ms (${path})`);
        await sleep(backoff);
        lastRequestAt = Date.now();
        continue;
      }
      throw e;
    }
  }
  throw lastErr || new Error('Jikan request failed');
}

async function getAnimeCharacters(animeId) {
  const data = await jikanFetch(`/anime/${animeId}/characters`);
  return (data.data || [])
    .filter((row) => row.character?.images?.jpg?.image_url)
    .map((row) => ({
      id: row.character.mal_id,
      name: formatName(row.character.name),
      image: row.character.images.jpg.image_url,
      role: row.role || 'Supporting',
      favorites: row.favorites ?? 0,
    }))
    .filter((c) => !isQuestionMark(c.image));
}

function mergeCharacter(merged, c, anime) {
  const prev = merged.get(c.id);
  if (!prev) {
    merged.set(c.id, { ...c, animeTitle: anime.title, animeId: anime.id });
    return;
  }
  const prevMain = (prev.role || '').toLowerCase() === 'main';
  const nextMain = (c.role || '').toLowerCase() === 'main';
  const betterRole = nextMain && !prevMain;
  const betterFav = (c.favorites || 0) > (prev.favorites || 0);
  const keepGif = prev.imageGif;
  const keepStill = prev.imageStill || prev.image;
  if (betterRole || (!prevMain && betterFav) || (prevMain === nextMain && betterFav)) {
    merged.set(c.id, {
      ...c,
      role: nextMain ? c.role : prev.role,
      favorites: Math.max(c.favorites || 0, prev.favorites || 0),
      animeTitle: anime.title,
      animeId: anime.id,
      imageGif: keepGif || c.imageGif,
      imageStill: keepStill || c.imageStill || c.image,
    });
  } else {
    prev.favorites = Math.max(prev.favorites || 0, c.favorites || 0);
    if (nextMain) {
      prev.role = c.role;
      prev.animeTitle = anime.title;
      prev.animeId = anime.id;
    }
    if (c.image && !isQuestionMark(c.image)) prev.image = c.image;
  }
}

/** Seed merged map from existing public/catalog.json so successes are not wiped. */
function loadExistingCatalog(merged) {
  if (!existsSync(OUT)) {
    console.log('No existing catalog — starting fresh');
    return;
  }
  try {
    const raw = JSON.parse(readFileSync(OUT, 'utf8'));
    const list = Array.isArray(raw) ? raw : [];
    for (const c of list) {
      if (!c?.id) continue;
      merged.set(c.id, { ...c });
    }
    console.log(`Loaded existing catalog: ${merged.size} characters (will merge, not wipe)`);
  } catch (e) {
    console.warn(`Could not load existing catalog: ${e.message}`);
  }
}

async function fetchPass(animeList, merged, label) {
  const failed = [];
  const total = animeList.length;
  for (let i = 0; i < total; i++) {
    const anime = animeList[i];
    process.stdout.write(`${label} [${i + 1}/${total}] ${anime.title} (${anime.id})… `);
    try {
      const chars = await getAnimeCharacters(anime.id);
      for (const c of chars) mergeCharacter(merged, c, anime);
      console.log(`${chars.length} chars (pool ${merged.size})`);
    } catch (e) {
      console.log(`FAIL: ${e.message}`);
      failed.push(anime);
    }
  }
  return failed;
}

function tokenize(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

function scoreGiphyResult(item, name, animeTitle) {
  const hay = `${item.title || ''} ${item.slug || ''}`.toLowerCase();
  const nameTokens = tokenize(name);
  const animeTokens = tokenize(animeTitle);
  let score = 0;
  for (const t of nameTokens) if (hay.includes(t)) score += 3;
  for (const t of animeTokens) if (hay.includes(t)) score += 2;
  // Prefer anime-tagged results
  if ((item.title || '').toLowerCase().includes('anime')) score += 1;
  return score;
}

let lastGiphyAt = 0;

async function searchGiphy(name, animeTitle) {
  const key = process.env.GIPHY_API_KEY;
  if (!key) throw new Error('GIPHY_API_KEY missing in .env');

  const queries = [
    `${name} ${animeTitle} anime`,
    `${name} ${animeTitle}`,
    `${name} anime`,
  ];

  for (const q of queries) {
    const wait = Math.max(0, GIPHY_INTERVAL_MS - (Date.now() - lastGiphyAt));
    if (wait) await sleep(wait);
    lastGiphyAt = Date.now();

    const url = new URL(GIPHY);
    url.searchParams.set('api_key', key);
    url.searchParams.set('q', q);
    url.searchParams.set('limit', '8');
    url.searchParams.set('rating', 'g');
    url.searchParams.set('lang', 'en');

    const res = await fetch(url);
    if (res.status === 429) {
      console.warn('  Giphy 429 — backing off 5s');
      await sleep(5000);
      continue;
    }
    if (!res.ok) {
      console.warn(`  Giphy ${res.status} for query`);
      continue;
    }
    const data = await res.json();
    const results = data.data || [];
    if (!results.length) continue;

    const ranked = results
      .map((item) => ({ item, score: scoreGiphyResult(item, name, animeTitle) }))
      .sort((a, b) => b.score - a.score);

    // Require at least one name token match when possible
    const nameTokens = tokenize(name);
    const good = ranked.find((r) => {
      if (r.score < 3) return false;
      const hay = `${r.item.title || ''} ${r.item.slug || ''}`.toLowerCase();
      return nameTokens.some((t) => hay.includes(t));
    });
    const pick = good || (ranked[0].score >= 2 ? ranked[0] : null);
    if (!pick) continue;

    const imgs = pick.item.images || {};
    const gifUrl =
      imgs.fixed_height?.url ||
      imgs.original?.url ||
      imgs.downsized?.url ||
      null;
    if (gifUrl) return gifUrl;
  }
  return null;
}

async function enrichLegendariesWithGiphy(cards) {
  const legends = cards.filter((c) => c.rarity === 'legendaire');
  const need = legends.filter(
    (c) => !c.imageGif || !String(c.imageGif).includes('giphy.com')
  );
  const already = legends.length - need.length;
  console.log(`\nGiphy enrich: ${need.length} new légendaires (${already} already have Giphy)…`);
  if (!need.length) return cards;
  if (!process.env.GIPHY_API_KEY) {
    console.warn('GIPHY_API_KEY not set — skipping GIF enrichment');
    return cards;
  }

  let ok = 0;
  let miss = 0;
  for (let i = 0; i < need.length; i++) {
    const c = need[i];
    process.stdout.write(`  [${i + 1}/${need.length}] ${c.name} (${c.animeTitle})… `);
    try {
      const gif = await searchGiphy(c.name, c.animeTitle || '');
      if (gif) {
        c.imageGif = gif;
        c.imageStill = c.imageStill || c.image;
        ok += 1;
        console.log('ok');
      } else {
        miss += 1;
        console.log('no match (keep Jikan still)');
      }
    } catch (e) {
      miss += 1;
      console.log(`err: ${e.message}`);
    }
  }
  console.log(`Giphy done: ${ok} matched, ${miss} kept Jikan portrait`);
  return cards;
}

async function build() {
  const merged = new Map();
  loadExistingCatalog(merged);

  // Prefer re-fetching anime not yet represented, but still refresh all IDs
  const presentAnimeIds = new Set([...merged.values()].map((c) => c.animeId).filter(Boolean));
  let pending = [...GLOBAL_ANIME_IDS];
  const missingFirst = pending.filter((a) => !presentAnimeIds.has(a.id));
  const presentFirst = pending.filter((a) => presentAnimeIds.has(a.id));
  pending = [...missingFirst, ...presentFirst];
  console.log(
    `Building catalog from ${pending.length} anime (${missingFirst.length} not in catalog yet)…`
  );

  pending = await fetchPass(pending, merged, 'pass1');

  for (let pass = 2; pass <= MAX_PASSES && pending.length; pass++) {
    const cool = Math.min(90000, 15000 * (pass - 1));
    console.log(`\nPass ${pass}: retrying ${pending.length} failed (cooldown ${cool}ms)…`);
    await sleep(cool);
    pending = await fetchPass(pending, merged, `pass${pass}`);
  }

  // Re-apply favorites-only rarity; preserve baked Giphy URLs
  let cards = [...merged.values()]
    .map(assignRarity)
    .map((c) => {
      const out = {
        id: c.id,
        name: c.name,
        image: c.image,
        imageStill: c.imageStill || c.image,
        role: c.role,
        favorites: c.favorites ?? 0,
        animeTitle: c.animeTitle,
        animeId: c.animeId,
        rarity: c.rarity,
        rarityLabel: c.rarityLabel,
        rarityColor: c.rarityColor,
      };
      if (c.imageGif) out.imageGif = c.imageGif;
      return out;
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  if (cards.length < 500) {
    console.error(`Catalog too small (${cards.length}) — aborting before Giphy`);
    process.exit(1);
  }

  cards = await enrichLegendariesWithGiphy(cards);

  const byRarity = {};
  for (const r of RARITIES) byRarity[r.id] = 0;
  for (const c of cards) byRarity[c.rarity] += 1;
  const withGif = cards.filter((c) => c.imageGif).length;
  const animeCovered = new Set(cards.map((c) => c.animeId));
  const failedFinal = GLOBAL_ANIME_IDS.filter((a) => !animeCovered.has(a.id));

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(cards));
  console.log(`\nWrote ${cards.length} characters → ${OUT}`);
  console.log('Rarity breakdown:', byRarity);
  console.log(`Legendaries with Giphy GIF: ${withGif}`);
  console.log(`Anime covered: ${animeCovered.size}/${GLOBAL_ANIME_IDS.length}`);
  if (pending.length || failedFinal.length) {
    const still = pending.length ? pending : failedFinal;
    console.warn('Still failed / missing anime:', still.map((a) => `${a.title} (${a.id})`).join(', '));
  }
}

build().catch((e) => {
  console.error(e);
  process.exit(1);
});
