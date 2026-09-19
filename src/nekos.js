/**
 * GIFs aléatoires nekos.best (API v2) pour les cartes Légendaire.
 * Cache mémoire + localStorage par character id ; file d'attente pour limiter le débit.
 */

const BASE = 'https://nekos.best/api/v2';
const LS_KEY = 'apo-legendary-gifs';
const MIN_INTERVAL_MS = 280;

/** Catégories GIF uniquement (pas neko/waifu/kitsune/husbando). */
export const GIF_CATEGORIES = [
  'hug',
  'dance',
  'happy',
  'smile',
  'wink',
  'spin',
  'wave',
  'pat',
  'baka',
  'bite',
  'blush',
  'bored',
  'cry',
  'cuddle',
  'facepalm',
  'feed',
  'highfive',
  'kiss',
  'laugh',
  'pout',
  'shrug',
  'slap',
  'sleep',
  'smug',
  'stare',
  'think',
  'thumbsup',
  'tickle',
  'kick',
  'handhold',
  'punch',
  'shoot',
  'yeet',
  'poke',
  'nod',
  'nom',
  'nope',
  'handshake',
  'lurk',
  'nibble',
  'peck',
  'yawn',
  'angry',
  'run',
  'bonk',
  'tableflip',
  'bleh',
  'blowkiss',
  'carry',
  'clap',
  'confused',
  'kabedon',
  'lappillow',
  'nya',
  'salute',
  'shake',
  'shocked',
  'sip',
  'teehee',
  'wag',
];

const memory = new Map();
const inflight = new Map();
let queue = Promise.resolve();
let lastRequestAt = 0;

function loadPersisted() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v === 'string' && v) memory.set(Number(k), v);
    }
  } catch {
    /* ignore */
  }
}

function persist() {
  try {
    const obj = {};
    for (const [k, v] of memory) obj[k] = v;
    localStorage.setItem(LS_KEY, JSON.stringify(obj));
  } catch {
    /* quota / private mode */
  }
}

loadPersisted();

function pickCategory() {
  return GIF_CATEGORIES[Math.floor(Math.random() * GIF_CATEGORIES.length)];
}

function enqueue(fn) {
  const run = queue.then(async () => {
    const wait = Math.max(0, MIN_INTERVAL_MS - (Date.now() - lastRequestAt));
    if (wait) await new Promise((r) => setTimeout(r, wait));
    lastRequestAt = Date.now();
    return fn();
  });
  queue = run.catch(() => {});
  return run;
}

export function getCachedGif(characterId) {
  const id = Number(characterId);
  return memory.get(id) || null;
}

/**
 * Conserve le portrait Jikan en imageStill ; applique le GIF en image / imageGif.
 */
export function ensureImageStill(card) {
  if (!card) return card;
  const current = card.image || '';
  const isNekos = current.includes('nekos.best');
  if (!card.imageStill) {
    if (current && !isNekos) card.imageStill = current;
    else if (card.imageGif && current === card.imageGif) {
      /* already swapped without still — leave empty, caller keeps fallback */
    }
  }
  return card;
}

export function applyGifToCard(card, url) {
  if (!card || !url) return card;
  ensureImageStill(card);
  card.imageGif = url;
  card.image = url;
  return card;
}

/** URL à afficher : GIF légendaire si dispo, sinon portrait Jikan. */
export function cardDisplayImage(card) {
  if (!card) return '';
  if (card.rarity === 'legendaire') {
    return (
      card.imageGif ||
      getCachedGif(card.id) ||
      card.imageStill ||
      (card.image && !String(card.image).includes('nekos.best') ? card.image : '') ||
      card.image ||
      ''
    );
  }
  return card.image || card.imageStill || '';
}

/**
 * Récupère (ou renvoie le cache) un GIF aléatoire pour un personnage légendaire.
 * @param {number|string} characterId
 * @param {{ refresh?: boolean }} [opts] refresh=true force un nouveau tirage (ex. ouverture de booster)
 */
export async function fetchLegendaryGif(characterId, { refresh = false } = {}) {
  const id = Number(characterId);
  if (!Number.isFinite(id)) return null;

  if (!refresh) {
    const cached = getCachedGif(id);
    if (cached) return cached;
    if (inflight.has(id)) return inflight.get(id);
  }

  const promise = enqueue(async () => {
    if (!refresh) {
      const again = getCachedGif(id);
      if (again) return again;
    }

    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
      const category = pickCategory();
      try {
        const res = await fetch(`${BASE}/${category}?amount=1`);
        if (!res.ok) {
          lastErr = new Error(`nekos ${res.status}`);
          continue;
        }
        const data = await res.json();
        const url = data?.results?.[0]?.url;
        if (url) {
          memory.set(id, url);
          persist();
          return url;
        }
      } catch (e) {
        lastErr = e;
      }
    }
    if (lastErr) console.warn('nekos.best GIF fetch failed', id, lastErr);
    return getCachedGif(id) || null;
  });

  inflight.set(id, promise);
  try {
    return await promise;
  } finally {
    if (inflight.get(id) === promise) inflight.delete(id);
  }
}
