/**
 * Client Jikan API v4 avec file d'attente (~3 req/s), cache et debounce.
 */

const BASE = 'https://api.jikan.moe/v4';
const MIN_INTERVAL_MS = 350; // ~2.8 req/s — marge sous la limite ~3/s
const RETRY_BACKOFF_MS = [1200, 2000, 3000];
const RETRY_STATUSES = new Set([429, 504]);

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

async function fetchJson(path, { useCache = true } = {}) {
  const key = path;
  if (useCache) {
    const cached = cacheGet(key);
    if (cached) return cached;
  }

  return enqueue(async () => {
    if (useCache) {
      const again = cacheGet(key);
      if (again) return again;
    }

    let lastErr;
    const maxAttempts = 1 + RETRY_BACKOFF_MS.length; // 1 try + 3 retries

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const res = await fetch(`${BASE}${path}`);
        if (RETRY_STATUSES.has(res.status)) {
          lastErr = new Error(`Jikan ${res.status}`);
          if (attempt < RETRY_BACKOFF_MS.length) {
            await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS[attempt]));
            lastRequestAt = Date.now();
            continue;
          }
          throw lastErr;
        }
        if (!res.ok) throw new Error(`Jikan ${res.status}`);
        const data = await res.json();
        if (useCache) cacheSet(key, data);
        return data;
      } catch (e) {
        lastErr = e;
        const msg = String(e?.message || '');
        const retryable =
          e instanceof TypeError ||
          /Jikan (429|504)/.test(msg);
        if (retryable && attempt < RETRY_BACKOFF_MS.length) {
          await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS[attempt]));
          lastRequestAt = Date.now();
          continue;
        }
        throw e;
      }
    }
    throw lastErr || new Error('Jikan request failed');
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
  // Note: alternate forms (Bankai, Sage Mode, Super Saiyan, etc.) stay as
  // separate characters with their own mal_id — we only dedupe by id.
}

/**
 * Charge les personnages d'une liste fixe d'animes, fusionne et déduplique par id.
 * @param {Array<{id:number,title:string}>} animeList
 * @param {{ onProgress?: (done:number, total:number, title:string) => void }} [opts]
 */
export async function fetchGlobalCharacterPool(animeList = GLOBAL_ANIME_IDS, opts = {}) {
  const merged = new Map();
  const total = animeList.length;
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;

  for (let i = 0; i < animeList.length; i++) {
    const anime = animeList[i];
    if (onProgress) onProgress(i, total, anime.title);
    try {
      const chars = await getAnimeCharacters(anime.id);
      for (const c of chars) {
        const prev = merged.get(c.id);
        if (!prev) {
          merged.set(c.id, { ...c, animeTitle: anime.title, animeId: anime.id });
          continue;
        }
        // Préférer Main, puis plus de favorites — ne jamais fusionner des noms différents
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

  if (onProgress) onProgress(total, total, '');
  return [...merged.values()];
}

function isQuestionMark(url) {
  return !url || url.includes('questionmark');
}

function formatName(name) {
  if (!name) return 'Inconnu';
  // "Last, First" → "First Last" (conserve suffixes type "(Bankai)", "Super Saiyan")
  if (name.includes(',')) {
    const [last, first] = name.split(',').map((s) => s.trim());
    return first ? `${first} ${last}` : last;
  }
  return name;
}

function mapCharacterPayload(c, { pictures = [] } = {}) {
  return {
    id: c.mal_id,
    name: formatName(c.name),
    nameKanji: c.name_kanji || '',
    nicknames: Array.isArray(c.nicknames) ? c.nicknames.filter(Boolean) : [],
    about: c.about || '',
    favorites: c.favorites ?? 0,
    image:
      c.images?.jpg?.image_url ||
      c.images?.webp?.image_url ||
      '',
    url: c.url || (c.mal_id ? `https://myanimelist.net/character/${c.mal_id}` : ''),
    anime: (c.anime || []).map((row) => ({
      role: row.role || '',
      title: row.anime?.title || 'Anime inconnu',
      malId: row.anime?.mal_id,
      url: row.anime?.url || '',
    })),
    pictures,
    partial: false,
  };
}

/**
 * Galerie d'images d'un personnage (formes / looks alternatifs).
 */
export async function getCharacterPictures(characterId) {
  try {
    const data = await fetchJson(`/characters/${characterId}/pictures`);
    const urls = (data.data || [])
      .map((p) => p.jpg?.large_image_url || p.jpg?.image_url || p.webp?.image_url)
      .filter((u) => u && !isQuestionMark(u));
    return [...new Set(urls)];
  } catch {
    return [];
  }
}

/**
 * Détail complet d'un personnage (bio, nicknames, apparitions anime, etc.).
 * Essaie /full puis bascule sur /characters/{id} + /pictures.
 */
export async function getCharacterFull(characterId) {
  try {
    const data = await fetchJson(`/characters/${characterId}/full`);
    const c = data.data;
    if (!c) throw new Error('Personnage introuvable');
    let pictures = [];
    try {
      pictures = await getCharacterPictures(characterId);
    } catch {
      pictures = [];
    }
    return mapCharacterPayload(c, { pictures });
  } catch (fullErr) {
    // Fallback: endpoint basique + pictures optionnelles
    try {
      const data = await fetchJson(`/characters/${characterId}`);
      const c = data.data;
      if (!c) throw fullErr;
      const pictures = await getCharacterPictures(characterId);
      const mapped = mapCharacterPayload(c, { pictures });
      mapped.partial = true;
      return mapped;
    } catch {
      throw fullErr;
    }
  }
}

/** Animes populaires du pool global (IDs MAL connus). ~30+ séries. */
export const GLOBAL_ANIME_IDS = [
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

/** @deprecated alias — gardé pour compat */
export const POPULAR_SHORTCUTS = GLOBAL_ANIME_IDS;
