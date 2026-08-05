#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/ecommerce-inventory}"
CONTAINER_NAME="${CONTAINER_NAME:-ecommerce-inventory}"
SERVICE_NAME="ecommerce-inventory-update"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this installer as root." >&2
  exit 1
fi

cd "$APP_DIR"
test -d .git
test -d data
test -f data/inventory.db

tracked_changes="$(git status --porcelain --untracked-files=no)"
if [ -n "$tracked_changes" ] && [ "$tracked_changes" != " M docker-compose.yml" ]; then
  echo "Installation stopped: unexpected tracked file changes exist." >&2
  printf '%s\n' "$tracked_changes" >&2
  exit 1
fi

bind_address="127.0.0.1"
host_port="8000"
if docker inspect "$CONTAINER_NAME" >/dev/null 2>&1; then
  detected_ip="$(docker inspect -f '{{with (index .HostConfig.PortBindings "8000/tcp")}}{{(index . 0).HostIp}}{{end}}' "$CONTAINER_NAME")"
  detected_port="$(docker inspect -f '{{with (index .HostConfig.PortBindings "8000/tcp")}}{{(index . 0).HostPort}}{{end}}' "$CONTAINER_NAME")"
  [ -n "$detected_ip" ] && bind_address="$detected_ip"
  [ -n "$detected_port" ] && host_port="$detected_port"
fi

cp docker-compose.yml "/root/ecommerce-inventory-compose-$(date +%Y%m%d-%H%M%S).yml"
secret_key="$(openssl rand -hex 32)"
cat > .env <<ENV
BIND_ADDRESS=$bind_address
HOST_PORT=$host_port
ADMIN_PASSWORD=change-me
SECRET_KEY=$secret_key
DATABASE_PATH=/app/data/inventory.db
UPLOAD_DIR=/app/data/uploads
MAX_UPLOAD_MB=128
ENV
chmod 600 .env

git fetch origin main
git restore docker-compose.yml
git checkout main
git pull --ff-only origin main
chmod +x scripts/deploy.sh scripts/install-auto-update.sh

docker compose config --quiet
docker compose up -d --build --force-recreate --remove-orphans

cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<UNIT
[Unit]
Description=Update ecommerce inventory from GitHub
After=network-online.target docker.service
Wants=network-online.target
Requires=docker.service

[Service]
Type=oneshot
WorkingDirectory=$APP_DIR
ExecStart=/usr/bin/flock -n /run/${SERVICE_NAME}.lock $APP_DIR/scripts/deploy.sh
UNIT

cat > "/etc/systemd/system/${SERVICE_NAME}.timer" <<UNIT
[Unit]
Description=Check ecommerce inventory updates every minute

[Timer]
OnBootSec=2min
OnUnitActiveSec=1min
RandomizedDelaySec=10
Persistent=true
Unit=${SERVICE_NAME}.service

[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
systemctl enable --now "${SERVICE_NAME}.timer"
systemctl start "${SERVICE_NAME}.service"

echo "Automatic updates installed."
echo "Current commit: $(git rev-parse --short HEAD)"
echo "Timer status:"
systemctl --no-pager status "${SERVICE_NAME}.timer" || true
