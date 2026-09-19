/**
 * Affichage des portraits / GIFs légendaires.
 *
 * - Portrait Jikan (image / imageStill) = toujours la source de vérité du personnage.
 * - imageGif = URL Giphy cuite dans catalog.json au build (jamais de clé API côté client).
 * - Les anciens GIFs nekos.best sont purgés (ils ne correspondent pas au personnage).
 */

/** @deprecated */
export const GIF_CATEGORIES = [];

export function getCachedGif(_characterId) {
  return null;
}

function isNekosUrl(url) {
  return typeof url === 'string' && url.includes('nekos.best');
}

function isGiphyUrl(url) {
  return typeof url === 'string' && (url.includes('giphy.com') || url.includes('gph.is'));
}

/** Conserve le still Jikan ; purge uniquement les URLs nekos.best. */
export function ensureImageStill(card) {
  if (!card) return card;
  const current = card.image || '';

  if (isNekosUrl(current)) {
    if (card.imageStill && !isNekosUrl(card.imageStill)) {
      card.image = card.imageStill;
    } else {
      card.image = '';
    }
  } else if (current && !card.imageStill && !isGiphyUrl(current)) {
    card.imageStill = current;
  }

  // Purge legacy nekos GIFs only — keep Giphy baked into catalog
  if (isNekosUrl(card.imageGif)) {
    delete card.imageGif;
  }
  return card;
}

/** Applique un GIF Giphy (catalog) tout en gardant le still Jikan. */
export function applyGifToCard(card, url) {
  if (!card || !url || isNekosUrl(url)) return ensureImageStill(card);
  ensureImageStill(card);
  card.imageGif = url;
  return card;
}

/**
 * Affichage : GIF Giphy pour légendaire si présent, sinon portrait Jikan.
 * Jamais de GIF nekos.best.
 */
export function cardDisplayImage(card) {
  if (!card) return '';
  ensureImageStill(card);

  if (card.rarity === 'legendaire') {
    const gif = card.imageGif;
    if (gif && isGiphyUrl(gif) && !isNekosUrl(gif)) return gif;
  }

  const still = card.imageStill || '';
  const img = card.image || '';
  if (still && !isNekosUrl(still) && !isGiphyUrl(still)) return still;
  if (img && !isNekosUrl(img) && !isGiphyUrl(img)) return img;
  if (still && !isNekosUrl(still)) return still;
  if (img && !isNekosUrl(img)) return img;
  return still || img || '';
}

/** Pas de fetch runtime — les GIFs sont dans catalog.json. */
export async function fetchLegendaryGif(_characterIdOrCard, _opts = {}) {
  return null;
}
