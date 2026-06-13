#!/usr/bin/env bash
# Обновление production: git pull → зависимости → схема БД → перезапуск.
#
# Запускать на VPS из корня проекта:
#   chmod +x release.sh
#   ./release.sh
#
#   ./release.sh --no-pull        # код уже обновлён (git pull вручную)
#   ./release.sh --no-db          # без изменений в sql/init.sql
#   ./release.sh --restart-only   # только смена .env
#   ./release.sh --pm2            # PM2 (если ещё не на systemd)
#   ./release.sh --systemd        # systemd (по умолчанию, если юниты включены)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

DO_PULL=1
DO_DB=1
DO_DEPS=1
RUNNER=""

usage() {
  sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage 0 ;;
    --no-pull) DO_PULL=0; shift ;;
    --no-db) DO_DB=0; shift ;;
    --restart-only)
      DO_PULL=0
      DO_DB=0
      DO_DEPS=0
      shift
      ;;
    --systemd) RUNNER=systemd; shift ;;
    --pm2) RUNNER=pm2; shift ;;
    *) echo "Unknown option: $1" >&2; usage 1 ;;
  esac
done

log() { printf '==> %s\n' "$*"; }

detect_runner() {
  if [[ -n "$RUNNER" ]]; then
    return
  fi
  if command -v systemctl >/dev/null 2>&1 \
    && systemctl is-enabled ai-tg-bot.service >/dev/null 2>&1; then
    RUNNER=systemd
    return
  fi
  if command -v pm2 >/dev/null 2>&1 && pm2 describe ai-tg-bot >/dev/null 2>&1; then
    RUNNER=pm2
    return
  fi
  echo "error: no process manager found." >&2
  echo "  systemd (recommended): sudo bash deploy/install-systemd.sh" >&2
  echo "  PM2:                 pm2 start ecosystem.config.cjs" >&2
  exit 1
}

restart_apps() {
  detect_runner
  case "$RUNNER" in
    systemd)
      log "Restart systemd: ai-tg-bot, ai-tg-site"
      sudo systemctl restart ai-tg-bot ai-tg-site
      systemctl --no-pager status ai-tg-bot ai-tg-site
      ;;
    pm2)
      log "Restart PM2: ai-tg-bot, ai-tg-site"
      pm2 restart ai-tg-bot ai-tg-site
      pm2 status ai-tg-bot ai-tg-site
      ;;
  esac
}

if [[ $DO_PULL -eq 1 ]]; then
  log "git pull --ff-only"
  git pull --ff-only
fi

if [[ $DO_DEPS -eq 1 ]]; then
  log "npm ci --omit=dev"
  npm ci --omit=dev
fi

if [[ $DO_DB -eq 1 ]]; then
  if [[ ! -f .env ]]; then
    echo "error: .env not found (copy from .env.example and set DATABASE_URL)" >&2
    exit 1
  fi
  log "npm run db:init"
  npm run db:init
fi

restart_apps

log "Done. Logs:"
case "$RUNNER" in
  systemd)
    echo "  journalctl -u ai-tg-bot -u ai-tg-site -n 30 --no-pager"
    ;;
  pm2)
    echo "  pm2 logs ai-tg-bot --lines 30"
    echo "  pm2 logs ai-tg-site --lines 30"
    ;;
esac
