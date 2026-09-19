/**
 * Rareté dérivée des favorites MAL.
 * Tirage de booster pondéré : communs fréquents, légendaires rares.
 */

export const RARITIES = [
  { id: 'commun', label: 'Commun', weight: 50, color: '#94a3b8' },
  { id: 'peu-commun', label: 'Peu commun', weight: 28, color: '#22c55e' },
  { id: 'rare', label: 'Rare', weight: 14, color: '#3b82f6' },
  { id: 'epique', label: 'Épique', weight: 6, color: '#a855f7' },
  { id: 'legendaire', label: 'Légendaire', weight: 2, color: '#f59e0b' },
];

const byId = Object.fromEntries(RARITIES.map((r) => [r.id, r]));

export function getRarityMeta(id) {
  return byId[id] || byId.commun;
}

/**
 * Favorites MAL → rareté.
 * Les seuils sont volontairement basés uniquement sur le nombre de favorites.
 */
export function assignRarity(character) {
  const fav = Number(character.favorites) || 0;

  let id;
  if (fav >= 50000) id = 'legendaire';
  else if (fav >= 15000) id = 'epique';
  else if (fav >= 4000) id = 'rare';
  else if (fav >= 800) id = 'peu-commun';
  else id = 'commun';

  const meta = getRarityMeta(id);
  return { ...character, rarity: id, rarityLabel: meta.label, rarityColor: meta.color, _score: fav };
}

export function enrichPool(characters) {
  return characters.map(assignRarity);
}

const PACK_SIZE = 5;

/**
 * Tire `PACK_SIZE` cartes : d'abord une rareté pondérée, puis un perso de ce pool.
 * Fallback si le pool de rareté est vide.
 */
export function openPack(enrichedPool, size = PACK_SIZE) {
  if (!enrichedPool.length) return [];

  const byRarity = {};
  for (const r of RARITIES) byRarity[r.id] = [];
  for (const c of enrichedPool) {
    byRarity[c.rarity]?.push(c);
  }

  const picks = [];
  const used = new Set();

  for (let i = 0; i < size; i++) {
    const rarityId = rollRarity(byRarity, used);
    const pool = available(byRarity[rarityId], used);
    const fallback = available(enrichedPool, used);
    const source = pool.length ? pool : fallback;
    if (!source.length) break;
    const card = source[Math.floor(Math.random() * source.length)];
    used.add(card.id);
    picks.push({ ...card });
  }

  return picks;
}

function available(list, used) {
  return (list || []).filter((c) => !used.has(c.id));
}

function rollRarity(byRarity, used) {
  const weighted = RARITIES.map((r) => {
    const n = available(byRarity[r.id], used).length;
    // Si aucun perso de cette rareté, poids 0
    return { id: r.id, weight: n ? r.weight : 0 };
  });
  const total = weighted.reduce((s, w) => s + w.weight, 0);
  if (!total) return 'commun';
  let roll = Math.random() * total;
  for (const w of weighted) {
    roll -= w.weight;
    if (roll <= 0) return w.id;
  }
  return weighted[weighted.length - 1].id;
}

export { PACK_SIZE };
