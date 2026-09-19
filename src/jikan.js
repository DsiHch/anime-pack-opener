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

/**
 * Charge les personnages d'une liste fixe d'animes, fusionne et déduplique par id.
 */
export async function fetchGlobalCharacterPool(animeList = GLOBAL_ANIME_IDS) {
  const merged = new Map();

  for (const anime of animeList) {
    try {
      const chars = await getAnimeCharacters(anime.id);
      for (const c of chars) {
        const prev = merged.get(c.id);
        if (!prev) {
          merged.set(c.id, { ...c, animeTitle: anime.title, animeId: anime.id });
          continue;
        }
        // Préférer Main, puis plus de favorites
        const prevMain = (prev.role || '').toLowerCase() === 'main';
        const nextMain = (c.role || '').toLowerCase() === 'main';
        const betterRole = nextMain && !prevMain;
        const betterFav = (c.favorites || 0) > (prev.favorites || 0);
        if (betterRole || (!prevMain && betterFav) || (prevMain === nextMain && betterFav)) {
          merged.set(c.id, {
            ...c,
            role: nextMain ? c.role : prev.role,
            favorites: Math.max(c.favorites || 0, prev.favorites || 0),
            animeTitle: anime.title,
            animeId: anime.id,
          });
        } else {
          prev.favorites = Math.max(prev.favorites || 0, c.favorites || 0);
          if (nextMain) prev.role = c.role;
        }
      }
    } catch {
      // Continue avec les autres animes si un échoue
    }
  }

  return [...merged.values()];
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

/** Animes populaires du pool global (IDs MAL connus). */
export const GLOBAL_ANIME_IDS = [
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

/** @deprecated alias — gardé pour compat */
export const POPULAR_SHORTCUTS = GLOBAL_ANIME_IDS;
