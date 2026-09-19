/**
 * Client Jikan API v4 avec file d'attente (~3 req/s), cache et debounce.
 */

const BASE = 'https://api.jikan.moe/v4';
const MIN_INTERVAL_MS = 350; // ~2.8 req/s — marge sous la limite ~3/s

const cache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000;

let queue = Promise.resolve();
let lastRequestAt = 0;

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.data;
}

function cacheSet(key, data) {
  cache.set(key, { at: Date.now(), data });
}

async function enqueue(fn) {
  const run = queue.then(async () => {
    const wait = Math.max(0, MIN_INTERVAL_MS - (Date.now() - lastRequestAt));
    if (wait) await new Promise((r) => setTimeout(r, wait));
    lastRequestAt = Date.now();
    return fn();
  });
  // Empêche un rejet d'arrêter toute la file
  queue = run.catch(() => {});
  return run;
}

async function fetchJson(path) {
  const key = path;
  const cached = cacheGet(key);
  if (cached) return cached;

  return enqueue(async () => {
    const again = cacheGet(key);
    if (again) return again;

    const res = await fetch(`${BASE}${path}`);
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 1200));
      const retry = await fetch(`${BASE}${path}`);
      if (!retry.ok) throw new Error(`Jikan ${retry.status}`);
      const data = await retry.json();
      cacheSet(key, data);
      return data;
    }
    if (!res.ok) throw new Error(`Jikan ${res.status}`);
    const data = await res.json();
    cacheSet(key, data);
    return data;
  });
}

export function debounce(fn, ms = 450) {
  let t;
  return (...args) => {
    clearTimeout(t);
    return new Promise((resolve) => {
      t = setTimeout(async () => {
        resolve(await fn(...args));
      }, ms);
    });
  };
}

export async function searchAnime(query, limit = 12) {
  const q = query.trim();
  if (q.length < 2) return [];
  const data = await fetchJson(
    `/anime?q=${encodeURIComponent(q)}&limit=${limit}&sfw=true&order_by=popularity&sort=asc`
  );
  return (data.data || []).map(normalizeAnime);
}

export async function getTopAnime(limit = 12) {
  const data = await fetchJson(`/top/anime?filter=bypopularity&limit=${limit}`);
  return (data.data || []).map(normalizeAnime);
}

export async function getAnimeCharacters(animeId) {
  const data = await fetchJson(`/anime/${animeId}/characters`);
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

function isQuestionMark(url) {
  return !url || url.includes('questionmark');
}

function formatName(name) {
  if (!name) return 'Inconnu';
  // "Last, First" → "First Last"
  if (name.includes(',')) {
    const [last, first] = name.split(',').map((s) => s.trim());
    return first ? `${first} ${last}` : last;
  }
  return name;
}

function normalizeAnime(a) {
  return {
    id: a.mal_id,
    title: a.title_english || a.title || a.title_japanese || `Anime #${a.mal_id}`,
    image: a.images?.jpg?.image_url || a.images?.webp?.image_url || '',
    score: a.score,
    episodes: a.episodes,
    year: a.year || a.aired?.prop?.from?.year || null,
  };
}

/** Animes populaires affichés en raccourcis (IDs MAL connus). */
export const POPULAR_SHORTCUTS = [
  { id: 21, title: 'One Piece' },
  { id: 20, title: 'Naruto' },
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
];
