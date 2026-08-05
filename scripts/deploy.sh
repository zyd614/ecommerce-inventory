#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/ecommerce-inventory}"
cd "$APP_DIR"

test -d .git
test -f docker-compose.yml
test -f .env
test -d data

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Deployment stopped: tracked files have local changes." >&2
  git status --short >&2
  exit 1
fi

git fetch --quiet origin main
local_commit="$(git rev-parse HEAD)"
remote_commit="$(git rev-parse origin/main)"
if [ "$local_commit" = "$remote_commit" ]; then
  echo "Already up to date: ${local_commit:0:7}"
  exit 0
fi

git checkout main
git pull --ff-only --quiet origin main

mkdir -p data/backups
cp -a data/inventory.db "data/backups/inventory-before-deploy-$(date +%Y%m%d-%H%M%S).db"

docker compose config --quiet
docker compose up -d --build --force-recreate --remove-orphans
docker compose ps

test "$(docker inspect -f '{{.State.Running}}' ecommerce-inventory)" = "true"
test -f data/inventory.db

echo "Deployed commit: $(git rev-parse --short HEAD)"
