# Anime Pack Opener

Site web public pour ouvrir des boosters TCG de personnages d’anime. Le pool de cartes est un **catalogue statique** (`public/catalog.json`) généré hors ligne depuis [Jikan](https://jikan.moe) (API non officielle MyAnimeList). Au runtime, seules les fiches détail (modal) appellent encore Jikan.

**Démo :** https://samueldelagrange30-maker.github.io/anime-pack-opener/

**Dépôt :** https://github.com/samueldelagrange30-maker/anime-pack-opener

## Fonctionnalités

- **Booster global** : pool unique fusionné à partir d’animes populaires (IDs MAL fixes), dédupliqué par personnage, chargé **instantanément** depuis `catalog.json`
- Ouverture d’un booster de 5 cartes (cooldown **5 minutes**, persisté en localStorage)
- Révélation une par une avec animation flip / glow selon la rareté
- Onglets **Ouvrir** | **Collection** | **Catalogue**
- Collection : grille des cartes possédées + stats `possédées / total pool` par rareté
- **Légendaires** : GIF Giphy du personnage (recherché `{nom} + {anime}` au build, cuit dans `catalog.json`) avec portrait Jikan en fallback — glow renforcé. Pas de clé API côté client.
- Interface en français

## Raretés

La rareté dépend **uniquement** du nombre de **favorites MAL** (`src/rarity.js`) — pas du rôle Main/Supporting :

| Favorites MAL | Rareté |
|---------------|--------|
| ≥ 50 000 | Légendaire |
| ≥ 15 000 | Épique |
| ≥ 4 000 | Rare |
| ≥ 800 | Peu commun |
| < 800 | Commun |

### Probabilités de tirage dans un booster

Poids relatifs (si le pool de cette rareté n’est pas vide) :

- Commun — 50
- Peu commun — 28
- Rare — 14
- Épique — 6
- Légendaire — 2

## Développement

```bash
npm install
npm run dev
```

Build (base Vite : `/anime-pack-opener/` pour GitHub Pages) :

```bash
npm run build
npm run preview
```

## Régénérer le catalogue

Le fichier `public/catalog.json` est **commité** pour que GitHub Pages fonctionne sans appeler Jikan au démarrage.

```bash
npm run build:catalog
# ou, si Jikan est instable :
npm run ship:catalog
```

> **Note :** si Jikan renvoie beaucoup de 504, utilise `npm run ship:catalog` pour publier un catalogue partiel (animes prioritaires + GIFs Giphy des légendaires) sans attendre les 37 séries.


Cela :

1. Parcourt `GLOBAL_ANIME_IDS` (liste dans `scripts/build-catalog.mjs`, alignée sur `src/jikan.js`)
2. Fetch `/anime/{id}/characters` avec rate-limit + retries (429/504)
3. Fusionne / déduplique par `character id`
4. Applique la rareté favorites-only
5. Pour chaque **Légendaire**, cherche un GIF Giphy (`{name} {animeTitle}`) via `GIPHY_API_KEY` dans `.env` (jamais commitée / jamais dans le bundle)
6. Écrit `public/catalog.json` (URLs Giphy incluses ; le site public n’a pas besoin de la clé)

```bash
# .env (gitignored)
GIPHY_API_KEY=your_key_here
npm run build:catalog
```

Puis rebuild + redéploie :

```bash
npm run build
./scripts/deploy-pages.sh
```

## Déploiement

Le site est publié sur **GitHub Pages** depuis la branche `gh-pages` (build Vite avec `base: /anime-pack-opener/`).

```bash
./scripts/deploy-pages.sh
```

## Limites API

- **Liste / booster / catalogue** : données locales (`catalog.json`) — démarrage instantané.
- **Modal détail** : Jikan (`/characters/{id}/full` + fallbacks) avec file d’attente ~3 req/s et cache mémoire.
- Les personnages sans image réelle (question mark) sont exclus du catalogue.
- Les GIFs légendaires viennent de **Giphy** (match `{nom} + {anime}` au build). Fallback = portrait Jikan. Aucune clé API dans le client.
