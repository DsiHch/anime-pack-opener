# Anime Pack Opener

Site web public pour ouvrir des boosters TCG de personnages d’anime, avec données et images via [Jikan](https://jikan.moe) (API non officielle MyAnimeList).

**Démo :** https://samueldelagrange30-maker.github.io/anime-pack-opener/

**Dépôt :** https://github.com/samueldelagrange30-maker/anime-pack-opener

## Fonctionnalités

- Recherche / sélection d’anime (API Jikan v4)
- Ouverture d’un booster de 5 cartes personnages
- Révélation une par une avec animation flip / glow selon la rareté
- Carte : nom, image Jikan, badge de rareté, rôle
- Grille de collection (stockée en localStorage)
- Interface en français

## Raretés

La rareté d’un personnage dépend du **rôle** et des **favorites** MAL :

| Rôle | Bonus score |
|------|-------------|
| Principal (Main) | +40 |
| Secondaire (Supporting) | +15 |
| Caméo (Appears) | +0 |

| Favorites | Bonus score |
|-----------|-------------|
| ≥ 30 000 | +55 |
| ≥ 15 000 | +45 |
| ≥ 8 000 | +38 |
| ≥ 3 000 | +30 |
| ≥ 1 000 | +22 |
| ≥ 400 | +14 |
| ≥ 100 | +8 |
| ≥ 20 | +4 |

| Score total | Rareté |
|-------------|--------|
| ≥ 78 | Légendaire |
| ≥ 58 | Épique |
| ≥ 40 | Rare |
| ≥ 22 | Peu commun |
| autrement | Commun |

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

## Déploiement

GitHub Actions (`.github/workflows/deploy.yml`) construit le projet et publie sur **GitHub Pages** (source : GitHub Actions).

## Limites API

Le client respecte approximativement la limite Jikan (~3 req/s) via une file d’attente, un cache mémoire (10 min) et un debounce sur la recherche. Les personnages sans image réelle (question mark) sont exclus.
