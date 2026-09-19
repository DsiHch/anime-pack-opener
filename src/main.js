import './style.css';
import {
  searchAnime,
  getTopAnime,
  getAnimeCharacters,
  debounce,
  POPULAR_SHORTCUTS,
} from './jikan.js';
import { enrichPool, openPack, RARITIES, PACK_SIZE } from './rarity.js';

const state = {
  view: 'select', // select | loading | reveal | collection
  selectedAnime: null,
  characterPool: [],
  currentPack: [],
  revealIndex: -1,
  collection: loadCollection(),
  searchResults: [],
  popular: [],
  error: null,
  revealing: false,
  searchQuery: '',
};

const app = document.querySelector('#app');

function loadCollection() {
  try {
    return JSON.parse(localStorage.getItem('apo-collection') || '[]');
  } catch {
    return [];
  }
}

function saveCollection() {
  localStorage.setItem('apo-collection', JSON.stringify(state.collection));
}

function addToCollection(cards) {
  const map = new Map(state.collection.map((c) => [c.id, c]));
  for (const card of cards) {
    const prev = map.get(card.id);
    if (prev) {
      prev.count = (prev.count || 1) + 1;
    } else {
      map.set(card.id, { ...card, count: 1, animeTitle: state.selectedAnime?.title });
    }
  }
  state.collection = [...map.values()].sort((a, b) => {
    const order = RARITIES.map((r) => r.id).reverse();
    return order.indexOf(a.rarity) - order.indexOf(b.rarity) || a.name.localeCompare(b.name);
  });
  saveCollection();
}

const debouncedSearch = debounce(async (q) => {
  if (q.trim().length < 2) {
    state.searchResults = [];
    render();
    return;
  }
  try {
    state.searchResults = await searchAnime(q);
    state.error = null;
  } catch (e) {
    state.error = 'Recherche impossible. Réessaie dans un instant.';
    state.searchResults = [];
  }
  render();
}, 480);

async function init() {
  render();
  try {
    state.popular = await getTopAnime(12);
  } catch {
    state.popular = [];
  }
  render();
}

function setView(view) {
  state.view = view;
  render();
}

async function selectAnime(anime) {
  state.selectedAnime = anime;
  state.error = null;
  state.view = 'loading';
  state.revealIndex = -1;
  state.currentPack = [];
  render();

  try {
    const chars = await getAnimeCharacters(anime.id);
    if (chars.length < PACK_SIZE) {
      state.error = `Pas assez de personnages (${chars.length}) pour un booster de ${PACK_SIZE}.`;
      state.view = 'select';
      render();
      return;
    }
    state.characterPool = enrichPool(chars);
    await startPackOpen();
  } catch (e) {
    state.error = 'Impossible de charger les personnages. Réessaie.';
    state.view = 'select';
    render();
  }
}

async function startPackOpen() {
  state.currentPack = openPack(state.characterPool, PACK_SIZE);
  state.revealIndex = -1;
  state.revealing = false;
  state.view = 'reveal';
  render();
}

function revealNext() {
  if (state.revealing) return;
  if (state.revealIndex >= state.currentPack.length - 1) {
    finishReveal();
    return;
  }
  state.revealing = true;
  state.revealIndex += 1;
  render();

  const card = state.currentPack[state.revealIndex];
  const delay = card.rarity === 'legendaire' ? 1100 : card.rarity === 'epique' ? 900 : 700;
  setTimeout(() => {
    state.revealing = false;
    render();
  }, delay);
}

function finishReveal() {
  addToCollection(state.currentPack);
  state.view = 'collection';
  render();
}

function skipAll() {
  while (state.revealIndex < state.currentPack.length - 1) {
    state.revealIndex += 1;
  }
  state.revealing = false;
  render();
  setTimeout(finishReveal, 400);
}

function render() {
  app.innerHTML = `
    <div class="bg-orbs" aria-hidden="true"></div>
    <header class="topbar">
      <div class="brand">
        <span class="brand-mark">✦</span>
        <div>
          <h1>Anime Pack Opener</h1>
          <p class="tagline">Booster TCG · personnages MyAnimeList</p>
        </div>
      </div>
      <div class="topbar-meta">
        <span class="pill">${state.collection.length} cartes</span>
      </div>
    </header>
    <main class="main">
      ${state.error ? `<div class="banner error" role="alert">${esc(state.error)}</div>` : ''}
      ${viewHtml()}
    </main>
    <footer class="footer">
      Données via <a href="https://jikan.moe" target="_blank" rel="noopener">Jikan API</a> · images MyAnimeList
    </footer>
  `;
  bindEvents();
}

function viewHtml() {
  switch (state.view) {
    case 'loading':
      return loadingHtml();
    case 'reveal':
      return revealHtml();
    case 'collection':
      return collectionHtml();
    default:
      return selectHtml();
  }
}

function selectHtml() {
  const results = state.searchResults;
  const popular = state.popular.length ? state.popular : POPULAR_SHORTCUTS.map((p) => ({
    ...p,
    image: '',
    score: null,
  }));

  return `
    <section class="panel select-panel">
      <h2>Choisis ton anime</h2>
      <p class="lead">Recherche un titre ou ouvre un booster depuis un classique.</p>
      <div class="search-wrap">
        <input
          type="search"
          id="search"
          class="search"
          placeholder="Ex. : One Piece, Naruto, Demon Slayer…"
          autocomplete="off"
          aria-label="Rechercher un anime"
        />
      </div>
      ${
        results.length
          ? `
        <h3 class="section-title">Résultats</h3>
        <div class="anime-grid" id="search-grid">
          ${results.map((a) => animeCardHtml(a)).join('')}
        </div>`
          : ''
      }
      <h3 class="section-title">Populaires</h3>
      <div class="chips" id="shortcuts">
        ${POPULAR_SHORTCUTS.map(
          (s) => `<button type="button" class="chip" data-shortcut-id="${s.id}" data-shortcut-title="${escAttr(s.title)}">${esc(s.title)}</button>`
        ).join('')}
      </div>
      <div class="anime-grid" id="popular-grid">
        ${popular.map((a) => animeCardHtml(a)).join('')}
      </div>
      ${
        state.collection.length
          ? `<button type="button" class="btn ghost" id="goto-collection">Voir ma collection (${state.collection.length})</button>`
          : ''
      }
    </section>
  `;
}

function animeCardHtml(a) {
  const img = a.image
    ? `<img src="${escAttr(a.image)}" alt="" loading="lazy" />`
    : `<div class="anime-placeholder">◆</div>`;
  return `
    <button type="button" class="anime-card" data-anime-id="${a.id}" data-anime-title="${escAttr(a.title)}" data-anime-image="${escAttr(a.image || '')}">
      <div class="anime-art">${img}</div>
      <div class="anime-info">
        <strong>${esc(a.title)}</strong>
        ${a.score ? `<span class="score">★ ${a.score}</span>` : ''}
      </div>
    </button>
  `;
}

function loadingHtml() {
  return `
    <section class="panel center-panel">
      <div class="spinner"></div>
      <h2>Invocation du booster…</h2>
      <p class="lead">${esc(state.selectedAnime?.title || '')}</p>
      <p class="muted">Chargement des personnages via Jikan</p>
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
        <button type="button" class="btn ghost sm" id="back-select">← Changer d'anime</button>
        <h2>Booster — ${esc(state.selectedAnime?.title || '')}</h2>
        <p class="progress">${Math.max(0, idx + 1)} / ${pack.length}</p>
      </div>

      <div class="stage">
        ${
          idx < 0
            ? `
          <button type="button" class="pack-closed" id="open-first" aria-label="Ouvrir le booster">
            <div class="pack-art">
              <span class="pack-shine"></span>
              <strong>BOOSTER</strong>
              <em>${esc(state.selectedAnime?.title || 'Anime')}</em>
              <span class="pack-count">${PACK_SIZE} cartes</span>
            </div>
          </button>
          <p class="hint">Touche le booster pour révéler la première carte</p>
        `
            : cardFaceHtml(current, true)
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
            <span class="role">${esc(roleFr(card.role))}</span>
          </div>
        </div>
      </div>
    </div>
  `;
}

function collectionHtml() {
  const pack = state.currentPack;
  const hasPack = pack.length > 0;
  return `
    <section class="panel collection-panel">
      <div class="reveal-header">
        <h2>${hasPack ? 'Pack ouvert !' : 'Ma collection'}</h2>
        <p class="lead">${hasPack ? `${esc(state.selectedAnime?.title || '')} — ${pack.length} nouvelles cartes` : `${state.collection.length} carte(s) sauvegardée(s)`}</p>
      </div>

      ${
        hasPack
          ? `
      <h3 class="section-title">Ce booster</h3>
      <div class="pack-grid">
        ${pack.map((c) => miniCardHtml(c)).join('')}
      </div>

      <div class="reveal-actions row">
        <button type="button" class="btn primary" id="open-another">Ouvrir un autre booster</button>
        <button type="button" class="btn ghost" id="change-anime">Changer d'anime</button>
      </div>`
          : `
      <div class="reveal-actions row">
        <button type="button" class="btn primary" id="change-anime">Choisir un anime</button>
      </div>`
      }

      <h3 class="section-title">Ma collection (${state.collection.length})</h3>
      <div class="legend">
        ${RARITIES.map((r) => `<span style="--rc:${r.color}"><i></i>${esc(r.label)}</span>`).join('')}
      </div>
      <div class="collection-grid">
        ${
          state.collection.length
            ? state.collection.map((c) => miniCardHtml(c, true)).join('')
            : '<p class="muted">Aucune carte pour l’instant.</p>'
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
  const search = document.getElementById('search');
  if (search) {
    if (state.searchQuery) {
      search.value = state.searchQuery;
    }
    if (state._searchFocused) {
      search.focus();
      const len = search.value.length;
      search.setSelectionRange(len, len);
    }
    search.addEventListener('focus', () => { state._searchFocused = true; });
    search.addEventListener('blur', () => { state._searchFocused = false; });
    search.addEventListener('input', (e) => {
      state.searchQuery = e.target.value;
      state._searchFocused = true;
      debouncedSearch(e.target.value);
    });
  }

  document.querySelectorAll('.anime-card').forEach((el) => {
    el.addEventListener('click', () => {
      selectAnime({
        id: Number(el.dataset.animeId),
        title: el.dataset.animeTitle,
        image: el.dataset.animeImage,
      });
    });
  });

  document.querySelectorAll('[data-shortcut-id]').forEach((el) => {
    el.addEventListener('click', () => {
      selectAnime({
        id: Number(el.dataset.shortcutId),
        title: el.dataset.shortcutTitle,
        image: '',
      });
    });
  });

  document.getElementById('open-first')?.addEventListener('click', revealNext);
  document.getElementById('reveal-next')?.addEventListener('click', revealNext);
  document.getElementById('skip-all')?.addEventListener('click', skipAll);
  document.getElementById('to-collection')?.addEventListener('click', finishReveal);
  document.getElementById('open-another')?.addEventListener('click', () => {
    state.view = 'loading';
    render();
    startPackOpen();
  });
  document.getElementById('change-anime')?.addEventListener('click', () => {
    state.view = 'select';
    state.error = null;
    render();
  });
  document.getElementById('back-select')?.addEventListener('click', () => {
    state.view = 'select';
    render();
  });
  document.getElementById('goto-collection')?.addEventListener('click', () => {
    state.view = 'collection';
    render();
  });
}

init();
