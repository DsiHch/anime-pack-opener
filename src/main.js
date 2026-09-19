import './style.css';
import { fetchGlobalCharacterPool, GLOBAL_ANIME_IDS, getCharacterFull } from './jikan.js';
import { enrichPool, openPack, RARITIES, PACK_SIZE } from './rarity.js';

const ACCRUAL_MS = 5 * 60 * 1000;
const MAX_PACKS = 10;
const LS_COLLECTION = 'apo-collection';
const LS_PACK_COUNT = 'apo-packCount';
const LS_LAST_ACCRUAL = 'apo-lastAccrualAt';

const state = {
  tab: 'open', // open | collection | catalogue
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
  packCount: 0,
  lastAccrualAt: 0,
  nextPackLeftMs: 0,
  catalogueFilter: 'all', // all | rarity id
  modal: null, // { status: 'loading'|'ready'|'error', card, detail, error }
};

let accrualTimer = null;
let escapeHandler = null;

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

function loadPackBank() {
  const rawCount = localStorage.getItem(LS_PACK_COUNT);
  const rawAccrual = localStorage.getItem(LS_LAST_ACCRUAL);

  if (rawCount == null && rawAccrual == null) {
    // First visit: 1 pack ready, accrual clock starts now
    state.packCount = 1;
    state.lastAccrualAt = Date.now();
    savePackBank();
    return;
  }

  const count = Number(rawCount);
  const accrual = Number(rawAccrual);
  state.packCount = Number.isFinite(count) && count >= 0 ? Math.min(MAX_PACKS, Math.floor(count)) : 1;
  state.lastAccrualAt = Number.isFinite(accrual) && accrual > 0 ? accrual : Date.now();
  syncPackBank();
}

function savePackBank() {
  localStorage.setItem(LS_PACK_COUNT, String(state.packCount));
  localStorage.setItem(LS_LAST_ACCRUAL, String(state.lastAccrualAt));
}

/**
 * Accrue packs from elapsed offline/online time up to MAX_PACKS.
 * Cooldown accrual is independent of opens.
 */
function syncPackBank() {
  const now = Date.now();
  if (state.packCount >= MAX_PACKS) {
    state.lastAccrualAt = now;
    state.nextPackLeftMs = 0;
    savePackBank();
    return;
  }

  const elapsed = Math.max(0, now - state.lastAccrualAt);
  const gained = Math.floor(elapsed / ACCRUAL_MS);
  if (gained > 0) {
    const room = MAX_PACKS - state.packCount;
    const credited = Math.min(room, gained);
    state.packCount += credited;
    state.lastAccrualAt += credited * ACCRUAL_MS;
    if (state.packCount >= MAX_PACKS) {
      state.lastAccrualAt = now;
    }
    savePackBank();
  }

  state.nextPackLeftMs =
    state.packCount >= MAX_PACKS
      ? 0
      : Math.max(0, state.lastAccrualAt + ACCRUAL_MS - Date.now());
}

function canOpenPack() {
  syncPackBank();
  return state.packCount > 0;
}

function formatCountdown(ms) {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function startAccrualTicker() {
  stopAccrualTicker();
  const tick = () => {
    const prevCount = state.packCount;
    syncPackBank();

    if (state.tab === 'open' && (state.view === 'home' || state.view === 'loading')) {
      const btn = document.getElementById('open-pack');
      const bank = document.getElementById('pack-bank-label');
      const cd = document.getElementById('cooldown-label');

      if (bank) bank.textContent = `Paquets : ${state.packCount} / ${MAX_PACKS}`;

      if (state.packCount > prevCount && state.view === 'home' && state.poolReady) {
        render();
        return;
      }

      if (state.packCount <= 0) {
        if (btn) {
          btn.disabled = true;
          btn.textContent =
            state.nextPackLeftMs > 0
              ? `Prochain paquet dans ${formatCountdown(state.nextPackLeftMs)}`
              : 'Aucun paquet';
        }
        if (cd) {
          cd.textContent =
            state.nextPackLeftMs > 0
              ? `Prochain paquet dans ${formatCountdown(state.nextPackLeftMs)}`
              : '';
        }
      } else if (state.packCount < MAX_PACKS && cd) {
        cd.textContent = `Prochain paquet dans ${formatCountdown(state.nextPackLeftMs)}`;
      } else if (state.packCount >= MAX_PACKS && cd) {
        cd.textContent = 'Banque pleine (10 / 10)';
      }
    }
  };
  tick();
  accrualTimer = setInterval(tick, 1000);
}

function stopAccrualTicker() {
  if (accrualTimer) {
    clearInterval(accrualTimer);
    accrualTimer = null;
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

function ownedIds() {
  return new Set(state.collection.map((c) => c.id));
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
  loadPackBank();
  state.view = 'loading';
  render();
  startAccrualTicker();

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

  syncPackBank();
  if (state.packCount <= 0) return;
  state.packCount -= 1;
  savePackBank();
  syncPackBank();
  startAccrualTicker();

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

function findCardById(id) {
  const nid = Number(id);
  return (
    state.collection.find((c) => c.id === nid) ||
    state.characterPool.find((c) => c.id === nid) ||
    state.currentPack.find((c) => c.id === nid) ||
    null
  );
}

async function openCharacterModal(cardOrId) {
  const card = typeof cardOrId === 'object' ? cardOrId : findCardById(cardOrId);
  if (!card?.id) return;

  state.modal = { status: 'loading', card, detail: null, error: null };
  render();

  try {
    const detail = await getCharacterFull(card.id);
    if (!state.modal || state.modal.card?.id !== card.id) return;
    state.modal = { status: 'ready', card, detail, error: null };
  } catch (e) {
    if (!state.modal || state.modal.card?.id !== card.id) return;
    state.modal = {
      status: 'error',
      card,
      detail: null,
      error: 'Impossible de charger les infos du personnage.',
    };
  }
  render();
}

function closeModal() {
  state.modal = null;
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
        <span class="pill pack-pill">Paquets ${state.packCount}/${MAX_PACKS}</span>
      </div>
    </header>

    <nav class="tabs" role="tablist" aria-label="Navigation">
      <button type="button" class="tab ${state.tab === 'open' ? 'active' : ''}" data-tab="open" role="tab" aria-selected="${state.tab === 'open'}">Ouvrir</button>
      <button type="button" class="tab ${state.tab === 'collection' ? 'active' : ''}" data-tab="collection" role="tab" aria-selected="${state.tab === 'collection'}">Collection</button>
      <button type="button" class="tab ${state.tab === 'catalogue' ? 'active' : ''}" data-tab="catalogue" role="tab" aria-selected="${state.tab === 'catalogue'}">Catalogue</button>
    </nav>

    <main class="main">
      ${state.error ? `<div class="banner error" role="alert">${esc(state.error)}</div>` : ''}
      ${
        state.tab === 'collection'
          ? collectionHtml()
          : state.tab === 'catalogue'
            ? catalogueHtml()
            : openTabHtml()
      }
    </main>
    <footer class="footer">
      Données via <a href="https://jikan.moe" target="_blank" rel="noopener">Jikan API</a> · images MyAnimeList
    </footer>
    ${state.modal ? modalHtml() : ''}
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
  syncPackBank();
  const ready = state.poolReady && state.packCount > 0;
  const poolCount = state.characterPool.length;
  const underCap = state.packCount < MAX_PACKS;

  let btnLabel = 'Ouvrir un booster';
  if (!state.poolReady) btnLabel = 'Chargement…';
  else if (state.packCount <= 0) {
    btnLabel =
      state.nextPackLeftMs > 0
        ? `Prochain paquet dans ${formatCountdown(state.nextPackLeftMs)}`
        : 'Aucun paquet';
  }

  return `
    <section class="panel home-panel center-panel">
      <h2>Booster global</h2>
      <p class="lead">
        Un pool unique tiré de ${GLOBAL_ANIME_IDS.length} animes populaires
        ${poolCount ? ` · <strong>${poolCount}</strong> personnages` : ''}.
      </p>

      <p class="pack-bank" id="pack-bank-label">Paquets : ${state.packCount} / ${MAX_PACKS}</p>

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
          ${btnLabel}
        </button>
        ${
          underCap
            ? `<p class="cooldown-label" id="cooldown-label">Prochain paquet dans ${formatCountdown(state.nextPackLeftMs)}</p>`
            : `<p class="cooldown-label" id="cooldown-label">Banque pleine (10 / 10)</p>`
        }
        <p class="hint">+1 paquet toutes les 5 minutes · max ${MAX_PACKS}</p>
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
            return `<button type="button" class="trail-slot rarity-${c.rarity} clickable" data-char-id="${c.id}" title="${escAttr(c.name)}">
              <img src="${escAttr(c.image)}" alt="" />
            </button>`;
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
    <button type="button" class="tcg-card clickable-card ${flipClass} ${glow} rarity-${card.rarity}" data-rarity="${card.rarity}" data-char-id="${card.id}" aria-label="Voir ${escAttr(card.name)}">
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
    </button>
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

function catalogueHtml() {
  const totals = poolTotalsByRarity();
  const owned = ownedIds();
  const filter = state.catalogueFilter;
  const cards =
    filter === 'all'
      ? state.characterPool
      : state.characterPool.filter((c) => c.rarity === filter);

  const sorted = [...cards].sort((a, b) => {
    const order = RARITIES.map((r) => r.id).reverse();
    return order.indexOf(a.rarity) - order.indexOf(b.rarity) || a.name.localeCompare(b.name);
  });

  return `
    <section class="panel catalogue-panel">
      <div class="reveal-header">
        <h2>Catalogue</h2>
        <p class="lead">${state.characterPool.length || 0} cartes dans le pool global</p>
      </div>

      <h3 class="section-title">Total par rareté</h3>
      <div class="stats-grid">
        ${RARITIES.map((r) => {
          const t = totals[r.id] || 0;
          return `
            <button type="button" class="stat-chip filter-chip ${filter === r.id ? 'active' : ''}" style="--rc:${r.color}" data-rarity-filter="${r.id}">
              <span class="stat-dot"></span>
              <span class="stat-label">${esc(r.label)}</span>
              <strong class="stat-value">${t}</strong>
            </button>`;
        }).join('')}
      </div>

      <div class="filter-bar">
        <button type="button" class="chip ${filter === 'all' ? 'active' : ''}" data-rarity-filter="all">Toutes (${state.characterPool.length})</button>
        ${RARITIES.map(
          (r) =>
            `<button type="button" class="chip ${filter === r.id ? 'active' : ''}" data-rarity-filter="${r.id}" style="--rc:${r.color}">${esc(r.label)}</button>`
        ).join('')}
      </div>

      <h3 class="section-title">Toutes les cartes (${sorted.length})</h3>
      <div class="legend">
        ${RARITIES.map((r) => `<span style="--rc:${r.color}"><i></i>${esc(r.label)}</span>`).join('')}
        <span class="owned-legend"><i class="owned-dot"></i>Possédée</span>
      </div>
      <div class="collection-grid">
        ${
          !state.poolReady
            ? '<p class="muted">Chargement du pool…</p>'
            : sorted.length
              ? sorted.map((c) => miniCardHtml(c, false, owned.has(c.id))).join('')
              : '<p class="muted">Aucune carte pour ce filtre.</p>'
        }
      </div>
    </section>
  `;
}

function miniCardHtml(card, showCount = false, isOwned = false) {
  const ownedClass = isOwned ? 'owned' : '';
  return `
    <article class="mini-card clickable-card rarity-${card.rarity} ${ownedClass}" data-char-id="${card.id}" role="button" tabindex="0" aria-label="Voir ${escAttr(card.name)}">
      <div class="mini-art">
        <img src="${escAttr(card.image)}" alt="${escAttr(card.name)}" loading="lazy" />
        <span class="mini-badge" style="--rc:${card.rarityColor}">${esc(card.rarityLabel)}</span>
        ${showCount && card.count > 1 ? `<span class="count">×${card.count}</span>` : ''}
        ${isOwned ? '<span class="owned-badge">✓</span>' : ''}
      </div>
      <p class="mini-name">${esc(card.name)}</p>
      ${card.animeTitle ? `<p class="mini-anime">${esc(card.animeTitle)}</p>` : ''}
    </article>
  `;
}

function modalHtml() {
  const m = state.modal;
  if (!m) return '';
  const card = m.card || {};
  const d = m.detail;

  let body = '';
  if (m.status === 'loading') {
    body = `
      <div class="modal-loading">
        <div class="spinner"></div>
        <p>Chargement de ${esc(card.name)}…</p>
      </div>`;
  } else if (m.status === 'error') {
    body = `
      <div class="modal-error">
        <p>${esc(m.error || 'Erreur')}</p>
        <button type="button" class="btn ghost" id="modal-retry" data-char-id="${card.id}">Réessayer</button>
      </div>`;
  } else if (d) {
    const about = (d.about || '').trim();
    const nicknames = d.nicknames || [];
    const animeList = d.anime || [];
    body = `
      <div class="modal-hero">
        <div class="modal-art rarity-${card.rarity || 'commun'}">
          <img src="${escAttr(d.image || card.image)}" alt="${escAttr(d.name || card.name)}" />
        </div>
        <div class="modal-meta">
          <h2 id="modal-title">${esc(d.name || card.name)}</h2>
          ${d.nameKanji ? `<p class="modal-kanji">${esc(d.nameKanji)}</p>` : ''}
          ${card.rarityLabel ? `<span class="rarity-badge inline-badge" style="--rc:${card.rarityColor || '#94a3b8'}">${esc(card.rarityLabel)}</span>` : ''}
          <p class="modal-fav">★ ${Number(d.favorites || card.favorites || 0).toLocaleString('fr-FR')} favoris</p>
          ${
            nicknames.length
              ? `<p class="modal-nicks"><span class="muted">Surnoms :</span> ${nicknames.map((n) => esc(n)).join(', ')}</p>`
              : ''
          }
          ${
            d.url
              ? `<a class="btn ghost sm mal-link" href="${escAttr(d.url)}" target="_blank" rel="noopener">Voir sur MyAnimeList</a>`
              : ''
          }
        </div>
      </div>
      <div class="modal-section">
        <h3>À propos</h3>
        <p class="modal-about">${about ? esc(about).replace(/\n/g, '<br>') : '<span class="muted">Pas de biographie disponible.</span>'}</p>
      </div>
      <div class="modal-section">
        <h3>Apparitions anime (${animeList.length})</h3>
        ${
          animeList.length
            ? `<ul class="modal-anime-list">${animeList
                .slice(0, 40)
                .map(
                  (a) =>
                    `<li><strong>${esc(a.title)}</strong> <span class="muted">· ${esc(roleFr(a.role) || a.role || '—')}</span></li>`
                )
                .join('')}${
                animeList.length > 40
                  ? `<li class="muted">… et ${animeList.length - 40} autres</li>`
                  : ''
              }</ul>`
            : '<p class="muted">Aucune apparition listée.</p>'
        }
      </div>`;
  }

  return `
    <div class="modal-backdrop" id="modal-backdrop" role="presentation">
      <div class="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <button type="button" class="modal-close" id="modal-close" aria-label="Fermer">×</button>
        <div class="modal-body">${body}</div>
      </div>
    </div>
  `;
}

function roleFr(role) {
  const r = (role || '').toLowerCase();
  if (r === 'main') return 'Principal';
  if (r === 'supporting') return 'Secondaire';
  return role ? 'Caméo' : '';
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

  document.querySelectorAll('[data-rarity-filter]').forEach((el) => {
    el.addEventListener('click', () => {
      state.catalogueFilter = el.dataset.rarityFilter || 'all';
      render();
    });
  });

  document.querySelectorAll('[data-char-id]').forEach((el) => {
    if (el.id === 'modal-retry') return;
    const open = (e) => {
      e.preventDefault();
      e.stopPropagation();
      openCharacterModal(el.dataset.charId);
    };
    el.addEventListener('click', open);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') open(e);
    });
  });

  document.getElementById('modal-close')?.addEventListener('click', closeModal);
  document.getElementById('modal-backdrop')?.addEventListener('click', (e) => {
    if (e.target.id === 'modal-backdrop') closeModal();
  });
  document.getElementById('modal-retry')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    openCharacterModal(e.currentTarget.dataset.charId);
  });

  if (escapeHandler) {
    document.removeEventListener('keydown', escapeHandler);
    escapeHandler = null;
  }
  if (state.modal) {
    escapeHandler = (e) => {
      if (e.key === 'Escape') closeModal();
    };
    document.addEventListener('keydown', escapeHandler);
  }
}

init();
