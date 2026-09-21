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
// Tenrai / mirrors: Jikan-compatible when api.jikan.moe returns 504
const API_BASES = [
  'https://api.jikan.moe/v4',
  'https://api.tenrai.org/v1',
  'https://jikan.lucashdo.com/v1',
];
const GIPHY = 'https://api.giphy.com/v1/gifs/search';
const MIN_INTERVAL_MS = 1200;
/** Longer gaps beat rapid 504 storms on Jikan gateways */
const RETRY_BACKOFF_MS = [12000, 35000, 70000];
const RETRY_STATUSES = new Set([429, 504, 502, 503]);
const GIPHY_INTERVAL_MS = 350;
const MAX_PASSES = 8;
const FAIL_STREAK_PAUSE_MS = 120000;

/** Aligned with src/jikan.js GLOBAL_ANIME_IDS */
const GLOBAL_ANIME_IDS = [
  { id: 21, title: 'One Piece' },
  { id: 20, title: 'Naruto' },
  { id: 1735, title: 'Naruto Shippuden' },
  { id: 28755, title: 'Boruto' },
  { id: 269, title: 'Bleach' },
  { id: 41467, title: 'Bleach: Thousand-Year Blood War' },
  { id: 53998, title: 'Bleach TYBW: The Separation' },
  { id: 56784, title: 'Bleach TYBW: The Conflict' },
  { id: 223, title: 'Dragon Ball' },
  { id: 813, title: 'Dragon Ball Z' },
  { id: 225, title: 'Dragon Ball GT' },
  { id: 30694, title: 'Dragon Ball Super' },
  { id: 48903, title: 'Dragon Ball Super: Super Hero' },
  { id: 5114, title: 'Fullmetal Alchemist: Brotherhood' },
  { id: 121, title: 'Fullmetal Alchemist' },
  { id: 16498, title: 'Attack on Titan' },
  { id: 25777, title: 'Attack on Titan Season 2' },
  { id: 35760, title: 'Attack on Titan Season 3' },
  { id: 40028, title: 'Attack on Titan: Final Season' },
  { id: 48583, title: 'Attack on Titan: Final Season Part 2' },
  { id: 51535, title: 'Attack on Titan: The Final Chapters' },
  { id: 1535, title: 'Death Note' },
  { id: 38000, title: 'Demon Slayer' },
  { id: 40456, title: 'Demon Slayer: Mugen Train' },
  { id: 47778, title: 'Demon Slayer: Entertainment District' },
  { id: 51019, title: 'Demon Slayer: Swordsmith Village' },
  { id: 55701, title: 'Demon Slayer: Hashira Training' },
  { id: 11061, title: 'Hunter x Hunter' },
  { id: 40748, title: 'Jujutsu Kaisen' },
  { id: 51009, title: 'Jujutsu Kaisen Season 2' },
  { id: 48561, title: 'Jujutsu Kaisen 0' },
  { id: 30276, title: 'One Punch Man' },
  { id: 34134, title: 'One Punch Man Season 2' },
  { id: 22319, title: 'Tokyo Ghoul' },
  { id: 27899, title: 'Tokyo Ghoul √A' },
  { id: 36511, title: 'Tokyo Ghoul:re' },
  { id: 37799, title: 'Tokyo Ghoul:re Season 2' },
  { id: 31964, title: 'My Hero Academia' },
  { id: 33486, title: 'My Hero Academia Season 2' },
  { id: 36456, title: 'My Hero Academia Season 3' },
  { id: 38408, title: 'My Hero Academia Season 4' },
  { id: 41587, title: 'My Hero Academia Season 5' },
  { id: 49918, title: 'My Hero Academia Season 6' },
  { id: 54789, title: 'My Hero Academia Season 7' },
  { id: 1, title: 'Cowboy Bebop' },
  { id: 44511, title: 'Chainsaw Man' },
  { id: 50265, title: 'Spy x Family' },
  { id: 53887, title: 'Spy x Family Season 2' },
  { id: 52299, title: 'Solo Leveling' },
  { id: 52991, title: 'Frieren' },
  { id: 32182, title: 'Mob Psycho 100' },
  { id: 37510, title: 'Mob Psycho 100 II' },
  { id: 50172, title: 'Mob Psycho 100 III' },
  { id: 14719, title: "JoJo's Bizarre Adventure" },
  { id: 20899, title: "JoJo: Stardust Crusaders" },
  { id: 26055, title: "JoJo: Stardust Crusaders Egypt" },
  { id: 31933, title: "JoJo: Diamond Is Unbreakable" },
  { id: 37991, title: "JoJo: Golden Wind" },
  { id: 48661, title: "JoJo: Stone Ocean" },
  { id: 34572, title: 'Black Clover' },
  { id: 6702, title: 'Fairy Tail' },
  { id: 11757, title: 'Sword Art Online' },
  { id: 36474, title: 'Sword Art Online: Alicization' },
  { id: 31240, title: 'Re:Zero' },
  { id: 39587, title: 'Re:Zero Season 2' },
  { id: 42203, title: 'Re:Zero Season 2 Part 2' },
  { id: 9253, title: 'Steins;Gate' },
  { id: 30484, title: 'Steins;Gate 0' },
  { id: 37521, title: 'Vinland Saga' },
  { id: 49387, title: 'Vinland Saga Season 2' },
  { id: 20583, title: 'Haikyuu!!' },
  { id: 28891, title: 'Haikyuu!! Season 2' },
  { id: 32935, title: 'Haikyuu!! Season 3' },
  { id: 38883, title: 'Haikyuu!! To the Top' },
  { id: 40776, title: 'Haikyuu!! To the Top Part 2' },
  { id: 49596, title: 'Blue Lock' },
  { id: 30, title: 'Neon Genesis Evangelion' },
  { id: 1575, title: 'Code Geass' },
  { id: 2904, title: 'Code Geass R2' },
  { id: 19815, title: 'No Game No Life' },
  { id: 24833, title: 'Assassination Classroom' },
  { id: 38691, title: 'Dr. Stone' },
  { id: 918, title: 'Gintama' },
  { id: 9969, title: "Gintama'" },
  { id: 15417, title: "Gintama': Enchousen" },
  { id: 28977, title: 'Gintama°' },
  { id: 22297, title: 'Fate/stay night: Unlimited Blade Works' },
  { id: 28701, title: 'Fate/stay night: UBW Season 2' },
  { id: 10087, title: 'Fate/Zero' },
  { id: 11741, title: 'Fate/Zero Season 2' },
  { id: 29803, title: 'Overlord' },
  { id: 30831, title: 'KonoSuba' },
  { id: 35790, title: 'The Rising of the Shield Hero' },
  { id: 35507, title: 'Classroom of the Elite' },
  { id: 52034, title: 'Oshi no Ko' },
  { id: 55791, title: 'Oshi no Ko Season 2' },
  { id: 47917, title: 'Bocchi the Rock!' },
  { id: 57334, title: 'Dandadan' },
  { id: 52588, title: 'Kaiju No. 8' },
  { id: 52211, title: 'Mashle' },
  { id: 46569, title: "Hell's Paradise" },
  { id: 52347, title: 'Shangri-La Frontier' },
  { id: 54492, title: 'The Apothecary Diaries' },
  { id: 392, title: 'Yu Yu Hakusho' },
  { id: 45, title: 'Rurouni Kenshin' },
  { id: 249, title: 'Inuyasha' },
  { id: 33, title: 'Berserk' },
  { id: 3588, title: 'Soul Eater' },
  { id: 23755, title: 'The Seven Deadly Sins' },
  { id: 37430, title: 'That Time I Got Reincarnated as a Slime' },
  { id: 39535, title: 'Mushoku Tensei' },
  { id: 42897, title: 'Horimiya' },
  { id: 37999, title: 'Kaguya-sama: Love is War' },
  { id: 34599, title: 'Made in Abyss' },
  { id: 22535, title: 'Parasyte: The Maxim' },
  { id: 33352, title: 'Violet Evergarden' },
  { id: 13601, title: 'Psycho-Pass' },
  { id: 19, title: 'Monster' },
  { id: 40834, title: 'Ranking of Kings' },
  { id: 48316, title: 'The Eminence in Shadow' },
  { id: 50709, title: 'Lycoris Recoil' },
  { id: 42310, title: 'Cyberpunk: Edgerunners' },
  { id: 35737, title: 'Pluto' },
  { id: 9919, title: 'Blue Exorcist' },
  { id: 20507, title: 'Noragami' },
  { id: 22199, title: 'Akame ga Kill!' },
  { id: 18679, title: 'Kill la Kill' },
  { id: 2001, title: 'Gurren Lagann' },
  { id: 4224, title: 'Toradora!' },
  { id: 23273, title: 'Your Lie in April' },
  { id: 31043, title: 'Erased' },
  { id: 38671, title: 'Fire Force' },
  { id: 37779, title: 'The Promised Neverland' },
  { id: 38680, title: 'Fruits Basket' },
  { id: 28851, title: 'A Silent Voice' },
  { id: 32281, title: 'Your Name.' },
  { id: 889, title: 'Black Lagoon' },
  { id: 777, title: 'Hellsing Ultimate' },
  { id: 1818, title: 'Claymore' },
  { id: 1482, title: 'D.Gray-man' },
  { id: 31478, title: 'Bungo Stray Dogs' },
  { id: 205, title: 'Samurai Champloo' },
  { id: 6, title: 'Trigun' },
  { id: 6547, title: 'Angel Beats!' },
  { id: 9989, title: 'Anohana' },
  { id: 2167, title: 'Clannad' },
  { id: 28171, title: 'Food Wars!' },
  { id: 6746, title: 'Durarara!!' },
  { id: 2251, title: 'Baccano!' },
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

async function fetchFromBase(base, path) {
  const wait = Math.max(0, MIN_INTERVAL_MS - (Date.now() - lastRequestAt));
  if (wait) await sleep(wait);
  lastRequestAt = Date.now();
  const res = await fetch(`${base}${path}`, {
    headers: { Accept: 'application/json', 'User-Agent': 'anime-pack-opener-catalog/1.3' },
    signal: AbortSignal.timeout(45000),
  });
  return res;
}

async function jikanFetch(path, opts = {}) {
  const backoffs = opts.backoffs || RETRY_BACKOFF_MS;
  const maxAttempts = 1 + backoffs.length;
  let lastErr;
  const bases = opts.bases || API_BASES;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Rotate bases: try primary, then fallbacks within the same attempt
    for (let bi = 0; bi < bases.length; bi++) {
      const base = bases[(attempt + bi) % bases.length];
      const short = base.replace(/^https?:\/\//, '').split('/')[0];
      try {
        if (consecutive504 >= 3 && bi === 0) {
          const cool = Math.min(60000, 10000 * consecutive504);
          console.warn(`  … cool-down ${cool}ms after ${consecutive504}×504`);
          await sleep(cool);
          consecutive504 = 0;
        }
        const res = await fetchFromBase(base, path);
        if (RETRY_STATUSES.has(res.status)) {
          lastErr = new Error(`${short} ${res.status}`);
          if (res.status === 504 || res.status === 502 || res.status === 503) consecutive504 += 1;
          console.warn(`  ↻ ${short} ${res.status} — try next mirror`);
          continue; // next base
        }
        if (!res.ok) {
          lastErr = new Error(`${short} ${res.status}`);
          continue;
        }
        consecutive504 = 0;
        return await res.json();
      } catch (e) {
        lastErr = e;
        const msg = String(e?.message || e?.name || '');
        console.warn(`  ↻ ${short} ${msg} — try next mirror`);
        if (/504|502|503/.test(msg)) consecutive504 += 1;
      }
    }
    if (attempt < backoffs.length) {
      const backoff = backoffs[attempt];
      console.warn(`  ↻ all mirrors failed → wait ${backoff}ms then retry`);
      await sleep(backoff);
      lastRequestAt = Date.now();
    }
  }
  throw lastErr || new Error('Character API request failed');
}

async function getAnimeCharacters(animeId, opts = {}) {
  const data = await jikanFetch(`/anime/${animeId}/characters`, opts);
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

function cardsFromMerged(merged) {
  return [...merged.values()]
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
}

function writeCatalogSnapshot(merged, note = '') {
  const cards = cardsFromMerged(merged);
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(cards));
  if (note) console.log(`  💾 snapshot ${cards.length} chars ${note}`);
  return cards;
}

async function fetchPass(animeList, merged, label, opts = {}) {
  const failed = [];
  const total = animeList.length;
  let failStreak = 0;
  const fetchOpts = opts.backoffs ? { backoffs: opts.backoffs } : {};
  for (let i = 0; i < total; i++) {
    const anime = animeList[i];
    process.stdout.write(`${label} [${i + 1}/${total}] ${anime.title} (${anime.id})… `);
    try {
      const chars = await getAnimeCharacters(anime.id, fetchOpts);
      for (const c of chars) mergeCharacter(merged, c, anime);
      console.log(`${chars.length} chars (pool ${merged.size})`);
      failStreak = 0;
      writeCatalogSnapshot(merged, `(after ${anime.title})`);
    } catch (e) {
      console.log(`FAIL: ${e.message}`);
      failed.push(anime);
      failStreak += 1;
      if (failStreak >= 3) {
        console.warn(`  … ${failStreak} fails in a row — pausing ${FAIL_STREAK_PAUSE_MS}ms`);
        await sleep(FAIL_STREAK_PAUSE_MS);
        failStreak = 0;
        consecutive504 = 0;
      }
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

/** Single-try sweep: merge hits immediately, return only failures for later passes. */
async function probeAndMerge(list, merged) {
  console.log(`Preflight probe+merge of ${list.length} anime (single try each)…`);
  const bad = [];
  let hits = 0;
  for (const anime of list) {
    const wait = Math.max(0, MIN_INTERVAL_MS - (Date.now() - lastRequestAt));
    if (wait) await sleep(wait);
    lastRequestAt = Date.now();
    process.stdout.write(`  ? ${anime.title} (${anime.id})… `);
    try {
      let data = null;
      let lastStatus = '';
      for (const base of API_BASES) {
        const short = base.replace(/^https?:\/\//, '').split('/')[0];
        const wait = Math.max(0, MIN_INTERVAL_MS - (Date.now() - lastRequestAt));
        if (wait) await sleep(wait);
        lastRequestAt = Date.now();
        try {
          const res = await fetch(`${base}/anime/${anime.id}/characters`, {
            headers: { Accept: 'application/json', 'User-Agent': 'anime-pack-opener-catalog/1.3' },
            signal: AbortSignal.timeout(25000),
          });
          if (!res.ok) {
            lastStatus = `${short}:${res.status}`;
            if (RETRY_STATUSES.has(res.status)) consecutive504 += 1;
            continue;
          }
          data = await res.json();
          consecutive504 = 0;
          break;
        } catch (e) {
          lastStatus = `${short}:${e.message || e.name}`;
        }
      }
      if (!data) {
        console.log(`✗ ${lastStatus || 'all mirrors'}`);
        bad.push(anime);
        continue;
      }
      consecutive504 = 0;
      const chars = (data.data || [])
        .filter((row) => row.character?.images?.jpg?.image_url)
        .map((row) => ({
          id: row.character.mal_id,
          name: formatName(row.character.name),
          image: row.character.images.jpg.image_url,
          role: row.role || 'Supporting',
          favorites: row.favorites ?? 0,
        }))
        .filter((c) => !isQuestionMark(c.image));
      for (const c of chars) mergeCharacter(merged, c, anime);
      hits += 1;
      console.log(`✓ ${chars.length} chars (pool ${merged.size})`);
      writeCatalogSnapshot(merged, `(preflight ${anime.title})`);
    } catch (e) {
      console.log(`✗ ${e.message || e.name}`);
      bad.push(anime);
    }
  }
  console.log(`Preflight done: ${hits} merged, ${bad.length} to retry`);
  return bad;
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
  pending = await probeAndMerge(pending, merged);

  // Early passes: fail-fast to cycle IDs while Jikan is flaky
  if (pending.length) {
    console.log(`\nPass 1 (fail-fast): ${pending.length} anime…`);
    pending = await fetchPass(pending, merged, 'pass1', { backoffs: [8000] });
  }

  for (let pass = 2; pass <= MAX_PASSES && pending.length; pass++) {
    const cool = Math.min(180000, 20000 * (pass - 1));
    const backoffs =
      pass <= 3 ? [10000, 25000] : pass <= 5 ? [15000, 40000, 70000] : RETRY_BACKOFF_MS;
    console.log(`\nPass ${pass}: retrying ${pending.length} failed (cooldown ${cool}ms, ${backoffs.length + 1} attempts)…`);
    await sleep(cool);
    pending = await fetchPass(pending, merged, `pass${pass}`, { backoffs });
  }

  // Re-apply favorites-only rarity; preserve baked Giphy URLs
  let cards = cardsFromMerged(merged);

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
