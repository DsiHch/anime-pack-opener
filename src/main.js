import './style.css';
import { fetchGlobalCharacterPool, GLOBAL_ANIME_IDS } from './jikan.js';
import { enrichPool, openPack, RARITIES, PACK_SIZE } from './rarity.js';

const COOLDOWN_MS = 5 * 60 * 1000;
const LS_COLLECTION = 'apo-collection';
const LS_LAST_OPEN = 'apo-lastPackOpenAt';

const state = {
  tab: 'open', // open | collection
  view: 'home', // home | loading | reveal
  characterPool: [],
  poolReady: false,
  currentPack: [],
  revealIndex: -1,
  /** true only for the render that first shows a newly revealed card (avoids double flip) */
  justRevealed: false,
  collection: loadCollection(),
  error: null,
  revealing: false,
  lastPackOpenAt: loadLastPackOpenAt(),
  cooldownLeftMs: 0,
};

let cooldownTimer = null;

const app = document.querySelector('#app');

function loadCollection() {
  try {
    return JSON.parse(localStorage.getItem(LS_COLLECTION) || '[]');
  } catch {
    return [];
  }
}

function saveCollection() {
  localStorage.setItem(LS_COLLECTION, JSON.stringify(state.collection));
}

function loadLastPackOpenAt() {
  const raw = localStorage.getItem(LS_LAST_OPEN);
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function saveLastPackOpenAt(ts) {
  state.lastPackOpenAt = ts;
  localStorage.setItem(LS_LAST_OPEN, String(ts));
}

function cooldownRemaining() {
  if (!state.lastPackOpenAt) return 0;
  return Math.max(0, state.lastPackOpenAt + COOLDOWN_MS - Date.now());
}

function canOpenPack() {
  return cooldownRemaining() === 0;
}

function formatCountdown(ms) {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function startCooldownTicker() {
  stopCooldownTicker();
  const tick = () => {
    state.cooldownLeftMs = cooldownRemaining();
    if (state.tab === 'open' && (state.view === 'home' || state.view === 'loading')) {
      const btn = document.getElementById('open-pack');
      const cd = document.getElementById('cooldown-label');
      if (btn || cd) {
        // Soft update without full re-render when possible
        if (state.cooldownLeftMs > 0) {
          if (btn) {
            btn.disabled = true;
            btn.textContent = `Disponible dans ${formatCountdown(state.cooldownLeftMs)}`;
          }
          if (cd) cd.textContent = `Prochain booster dans ${formatCountdown(state.cooldownLeftMs)}`;
        } else if (state.view === 'home' && state.poolReady) {
          // Refresh home so button becomes active
          render();
          return;
        }
      }
    }
    if (state.cooldownLeftMs <= 0) stopCooldownTicker();
  };
  tick();
  cooldownTimer = setInterval(tick, 1000);
}

function stopCooldownTicker() {
  if (cooldownTimer) {
    clearInterval(cooldownTimer);
    cooldownTimer = null;
  }
}

function addToCollection(cards) {
  const map = new Map(state.collection.map((c) => [c.id, c]));
  for (const card of cards) {
    const prev = map.get(card.id);
    if (prev) {
      prev.count = (prev.count || 1) + 1;
    } else {
      map.set(card.id, {
        ...card,
        count: 1,
        animeTitle: card.animeTitle || '',
      });
    }
  }
  state.collection = [...map.values()].sort((a, b) => {
    const order = RARITIES.map((r) => r.id).reverse();
    return order.indexOf(a.rarity) - order.indexOf(b.rarity) || a.name.localeCompare(b.name);
  });
  saveCollection();
}

function poolTotalsByRarity() {
  const totals = Object.fromEntries(RARITIES.map((r) => [r.id, 0]));
  for (const c of state.characterPool) {
    if (totals[c.rarity] != null) totals[c.rarity] += 1;
  }
  return totals;
}

function ownedUniqueByRarity() {
  const owned = Object.fromEntries(RARITIES.map((r) => [r.id, 0]));
  for (const c of state.collection) {
    if (owned[c.rarity] != null) owned[c.rarity] += 1;
  }
  return owned;
}

async function init() {
  state.view = 'loading';
  state.cooldownLeftMs = cooldownRemaining();
  render();
  if (state.cooldownLeftMs > 0) startCooldownTicker();

  try {
    const raw = await fetchGlobalCharacterPool(GLOBAL_ANIME_IDS);
    if (raw.length < PACK_SIZE) {
      state.error = `Pool trop petit (${raw.length} personnages). Réessaie plus tard.`;
      state.poolReady = false;
      state.view = 'home';
      render();
      return;
    }
    state.characterPool = enrichPool(raw);
    state.poolReady = true;
    state.error = null;
    state.view = 'home';
  } catch (e) {
    state.error = 'Impossible de charger le pool global. Réessaie.';
    state.poolReady = false;
    state.view = 'home';
  }
  render();
}

function startPackOpen() {
  if (!state.poolReady || !canOpenPack()) return;
  if (state.characterPool.length < PACK_SIZE) {
    state.error = 'Pas assez de personnages dans le pool.';
    render();
    return;
  }

  saveLastPackOpenAt(Date.now());
  state.cooldownLeftMs = COOLDOWN_MS;
  startCooldownTicker();

  state.currentPack = openPack(state.characterPool, PACK_SIZE);
  state.revealIndex = -1;
  state.revealing = false;
  state.justRevealed = false;
  state.view = 'reveal';
  state.tab = 'open';
  state.error = null;
  render();
}

/**
 * Reveal next card. justRevealed is true only for the first render of that card
 * so flip-in runs once; the follow-up render (revealing → false) has no flip-in.
 */
function revealNext() {
  if (state.revealing) return;
  if (state.revealIndex >= state.currentPack.length - 1) {
    finishReveal();
    return;
  }
  state.revealing = true;
  state.revealIndex += 1;
  state.justRevealed = true;
  render();
  state.justRevealed = false;

  const card = state.currentPack[state.revealIndex];
  const delay = card.rarity === 'legendaire' ? 1100 : card.rarity === 'epique' ? 900 : 700;
  setTimeout(() => {
    state.revealing = false;
    render();
  }, delay);
}

function finishReveal() {
  addToCollection(state.currentPack);
  state.tab = 'collection';
  state.view = 'home';
  render();
}

function skipAll() {
  while (state.revealIndex < state.currentPack.length - 1) {
    state.revealIndex += 1;
  }
  state.revealing = false;
  state.justRevealed = false;
  render();
  setTimeout(finishReveal, 400);
}

function setTab(tab) {
  state.tab = tab;
  if (tab === 'open' && state.view === 'reveal' && state.currentPack.length) {
    // stay on reveal
  } else if (tab === 'open') {
    state.view = state.poolReady ? 'home' : 'loading';
  }
  render();
}

function render() {
  app.innerHTML = `
    <div class="bg-orbs" aria-hidden="true"></div>
    <header class="topbar">
      <div class="brand">
        <span class="brand-mark">✦</span>
        <div>
          <h1>Anime Pack Opener</h1>
          <p class="tagline">Booster TCG · pool global MyAnimeList</p>
        </div>
      </div>
      <div class="topbar-meta">
        <span class="pill">${state.collection.length} cartes</span>
      </div>
    </header>

    <nav class="tabs" role="tablist" aria-label="Navigation">
      <button type="button" class="tab ${state.tab === 'open' ? 'active' : ''}" data-tab="open" role="tab" aria-selected="${state.tab === 'open'}">Ouvrir</button>
      <button type="button" class="tab ${state.tab === 'collection' ? 'active' : ''}" data-tab="collection" role="tab" aria-selected="${state.tab === 'collection'}">Collection</button>
    </nav>

    <main class="main">
      ${state.error ? `<div class="banner error" role="alert">${esc(state.error)}</div>` : ''}
      ${state.tab === 'collection' ? collectionHtml() : openTabHtml()}
    </main>
    <footer class="footer">
      Données via <a href="https://jikan.moe" target="_blank" rel="noopener">Jikan API</a> · images MyAnimeList
    </footer>
  `;
  bindEvents();
}

function openTabHtml() {
  switch (state.view) {
    case 'loading':
      return loadingHtml();
    case 'reveal':
      return revealHtml();
    default:
      return homeHtml();
  }
}

function homeHtml() {
  const left = cooldownRemaining();
  const ready = state.poolReady && left === 0;
  const poolCount = state.characterPool.length;

  return `
    <section class="panel home-panel center-panel">
      <h2>Booster global</h2>
      <p class="lead">
        Un pool unique tiré de ${GLOBAL_ANIME_IDS.length} animes populaires
        ${poolCount ? ` · <strong>${poolCount}</strong> personnages` : ''}.
      </p>

      <button type="button" class="pack-closed ${ready ? '' : 'disabled'}" id="open-pack-visual" ${ready ? '' : 'disabled'} aria-label="Ouvrir le booster">
        <div class="pack-art">
          <span class="pack-shine"></span>
          <strong>BOOSTER</strong>
          <em>Pool global</em>
          <span class="pack-count">${PACK_SIZE} cartes</span>
        </div>
      </button>

      <div class="home-actions">
        <button type="button" class="btn primary" id="open-pack" ${ready ? '' : 'disabled'}>
          ${
            !state.poolReady
              ? 'Chargement…'
              : left > 0
                ? `Disponible dans ${formatCountdown(left)}`
                : 'Ouvrir un booster'
          }
        </button>
        ${
          left > 0
            ? `<p class="cooldown-label" id="cooldown-label">Prochain booster dans ${formatCountdown(left)}</p>`
            : `<p class="hint">1 booster toutes les 5 minutes</p>`
        }
      </div>
    </section>
  `;
}

function loadingHtml() {
  return `
    <section class="panel center-panel">
      <div class="spinner"></div>
      <h2>Chargement du pool global…</h2>
      <p class="lead">Personnages de ${GLOBAL_ANIME_IDS.length} animes populaires</p>
      <p class="muted">Jikan API · merci de patienter</p>
    </section>
  `;
}

function revealHtml() {
  const pack = state.currentPack;
  const idx = state.revealIndex;
  const done = idx >= pack.length - 1 && !state.revealing;
  const current = idx >= 0 ? pack[idx] : null;

  return `
    <section class="panel reveal-panel">
      <div class="reveal-header">
        <span class="pill ghost-pill">Pool global</span>
        <h2>Ouverture du booster</h2>
        <p class="progress">${Math.max(0, idx + 1)} / ${pack.length}</p>
      </div>

      <div class="stage">
        ${
          idx < 0
            ? `
          <button type="button" class="pack-closed" id="open-first" aria-label="Révéler la première carte">
            <div class="pack-art">
              <span class="pack-shine"></span>
              <strong>BOOSTER</strong>
              <em>Pool global</em>
              <span class="pack-count">${PACK_SIZE} cartes</span>
            </div>
          </button>
          <p class="hint">Touche le booster pour révéler la première carte</p>
        `
            : cardFaceHtml(current, state.justRevealed)
        }
      </div>

      <div class="reveal-trail">
        ${pack
          .map((c, i) => {
            if (i > idx) return `<div class="trail-slot locked">?</div>`;
            return `<div class="trail-slot rarity-${c.rarity}" title="${escAttr(c.name)}">
              <img src="${escAttr(c.image)}" alt="" />
            </div>`;
          })
          .join('')}
      </div>

      <div class="reveal-actions">
        ${
          idx < 0
            ? ''
            : done
              ? `<button type="button" class="btn primary" id="to-collection">Voir la collection</button>`
              : `
                <button type="button" class="btn primary" id="reveal-next" ${state.revealing ? 'disabled' : ''}>
                  ${state.revealing ? 'Révélation…' : 'Carte suivante'}
                </button>
                <button type="button" class="btn ghost" id="skip-all" ${state.revealing ? 'disabled' : ''}>Tout révéler</button>
              `
        }
      </div>
    </section>
  `;
}

function cardFaceHtml(card, animate) {
  if (!card) return '';
  const flipClass = animate ? 'flip-in' : '';
  const glow = `glow-${card.rarity}`;
  return `
    <div class="tcg-card ${flipClass} ${glow} rarity-${card.rarity}" data-rarity="${card.rarity}">
      <div class="tcg-inner">
        <div class="tcg-frame">
          <span class="rarity-badge" style="--rc:${card.rarityColor}">${esc(card.rarityLabel)}</span>
          <div class="tcg-art">
            <img src="${escAttr(card.image)}" alt="${escAttr(card.name)}" />
          </div>
          <div class="tcg-footer">
            <h3>${esc(card.name)}</h3>
            <span class="role">${esc(roleFr(card.role))}${card.animeTitle ? ` · ${esc(card.animeTitle)}` : ''}</span>
          </div>
        </div>
      </div>
    </div>
  `;
}

function collectionHtml() {
  const totals = poolTotalsByRarity();
  const owned = ownedUniqueByRarity();
  const pack = state.currentPack;
  const showPack = pack.length > 0 && state.revealIndex >= pack.length - 1;

  return `
    <section class="panel collection-panel">
      <div class="reveal-header">
        <h2>Ma collection</h2>
        <p class="lead">${state.collection.length} carte(s) unique(s) · pool ${state.characterPool.length || '…'}</p>
      </div>

      <h3 class="section-title">Progression par rareté</h3>
      <div class="stats-grid">
        ${RARITIES.map((r) => {
          const o = owned[r.id] || 0;
          const t = totals[r.id] || 0;
          const label = t ? `${o} / ${t}` : `${o} / —`;
          return `
            <div class="stat-chip" style="--rc:${r.color}">
              <span class="stat-dot"></span>
              <span class="stat-label">${esc(r.label)}</span>
              <strong class="stat-value">${label}</strong>
            </div>`;
        }).join('')}
      </div>

      ${
        showPack
          ? `
      <h3 class="section-title">Dernier booster</h3>
      <div class="pack-grid">
        ${pack.map((c) => miniCardHtml(c)).join('')}
      </div>`
          : ''
      }

      <h3 class="section-title">Cartes possédées (${state.collection.length})</h3>
      <div class="legend">
        ${RARITIES.map((r) => `<span style="--rc:${r.color}"><i></i>${esc(r.label)}</span>`).join('')}
      </div>
      <div class="collection-grid">
        ${
          state.collection.length
            ? state.collection.map((c) => miniCardHtml(c, true)).join('')
            : '<p class="muted">Aucune carte pour l’instant. Ouvre un booster !</p>'
        }
      </div>
    </section>
  `;
}

function miniCardHtml(card, showCount = false) {
  return `
    <article class="mini-card rarity-${card.rarity}">
      <div class="mini-art">
        <img src="${escAttr(card.image)}" alt="${escAttr(card.name)}" loading="lazy" />
        <span class="mini-badge" style="--rc:${card.rarityColor}">${esc(card.rarityLabel)}</span>
        ${showCount && card.count > 1 ? `<span class="count">×${card.count}</span>` : ''}
      </div>
      <p class="mini-name">${esc(card.name)}</p>
      ${card.animeTitle ? `<p class="mini-anime">${esc(card.animeTitle)}</p>` : ''}
    </article>
  `;
}

function roleFr(role) {
  const r = (role || '').toLowerCase();
  if (r === 'main') return 'Principal';
  if (r === 'supporting') return 'Secondaire';
  return 'Caméo';
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escAttr(s) {
  return esc(s).replace(/'/g, '&#39;');
}

function bindEvents() {
  document.querySelectorAll('[data-tab]').forEach((el) => {
    el.addEventListener('click', () => setTab(el.dataset.tab));
  });

  const open = () => startPackOpen();
  document.getElementById('open-pack')?.addEventListener('click', open);
  document.getElementById('open-pack-visual')?.addEventListener('click', open);

  document.getElementById('open-first')?.addEventListener('click', revealNext);
  document.getElementById('reveal-next')?.addEventListener('click', revealNext);
  document.getElementById('skip-all')?.addEventListener('click', skipAll);
  document.getElementById('to-collection')?.addEventListener('click', finishReveal);
}

init();
