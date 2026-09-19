#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
npm run build
TMP=$(mktemp -d)
cp -a dist/. "$TMP/"
touch "$TMP/.nojekyll"
cd "$TMP"
git init -b gh-pages
git add -A
git -c user.email="${GIT_EMAIL:-samueldelagrange30@users.noreply.github.com}" \
    -c user.name="${GIT_NAME:-samueldelagrange30-maker}" \
    commit -m "Deploy site to GitHub Pages"
git remote add origin https://github.com/samueldelagrange30-maker/anime-pack-opener.git
git push -u origin gh-pages --force
