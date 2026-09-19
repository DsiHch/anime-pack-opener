# Anime Pack Opener

Site web public pour ouvrir des boosters TCG de personnages d’anime, avec données et images via [Jikan](https://jikan.moe) (API non officielle MyAnimeList).

**Démo :** https://samueldelagrange30-maker.github.io/anime-pack-opener/

**Dépôt :** https://github.com/samueldelagrange30-maker/anime-pack-opener

## Fonctionnalités

- **Booster global** : un seul pool fusionné à partir d’animes populaires (IDs MAL fixes), dédupliqué par personnage
- Ouverture d’un booster de 5 cartes (cooldown **5 minutes**, persisté en localStorage)
- Révélation une par une avec animation flip / glow selon la rareté (une seule animation par carte)
- Onglets **Ouvrir** | **Collection**
- Collection : grille des cartes possédées + stats `possédées / total pool` par rareté
- Interface en français · images Jikan uniquement

## Raretés

La rareté d’un personnage dépend du **rôle** et des **favorites** MAL (`src/rarity.js`) :

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

Le site est publié sur **GitHub Pages** depuis la branche `gh-pages` (build Vite avec `base: /anime-pack-opener/`).

```bash
./scripts/deploy-pages.sh
```

## Limites API

Le client respecte approximativement la limite Jikan (~3 req/s) via une file d’attente et un cache mémoire (10 min). Au démarrage, les personnages des animes du pool global sont chargés séquentiellement. Les personnages sans image réelle (question mark) sont exclus.
