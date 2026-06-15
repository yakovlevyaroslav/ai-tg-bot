#!/usr/bin/env bash
# Обновление production: git pull → зависимости → схема БД → перезапуск.
#
#   ./release.sh
#   ./release.sh --bot-only
#   ./release.sh --site-only
#   ./release.sh --no-pull
#   ./release.sh --no-db
#   ./release.sh --restart-only

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

DO_PULL=1
DO_DB=1
DO_DEPS=1
RESTART_BOT=1
RESTART_SITE=1

usage() {
  sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help) usage 0 ;;
    --no-pull) DO_PULL=0; shift ;;
    --no-db) DO_DB=0; shift ;;
    --bot-only) RESTART_SITE=0; shift ;;
    --site-only) RESTART_BOT=0; shift ;;
    --restart-only)
      DO_PULL=0
      DO_DB=0
      DO_DEPS=0
      shift
      ;;
    *) echo "Unknown option: $1" >&2; usage 1 ;;
  esac
done

log() { printf '==> %s\n' "$*"; }

restart_apps() {
  if [[ $RESTART_BOT -eq 1 ]]; then
    if systemctl is-enabled ai-tg-bot.service >/dev/null 2>&1; then
      log "Restart ai-tg-bot"
      sudo systemctl restart ai-tg-bot
    fi
  fi
  if [[ $RESTART_SITE -eq 1 ]]; then
    if systemctl is-enabled ai-tg-site.service >/dev/null 2>&1; then
      log "Restart ai-tg-site"
      sudo systemctl restart ai-tg-site
    fi
  fi
  systemctl --no-pager status ai-tg-bot ai-tg-site 2>/dev/null || true
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
  if [[ -f .env.bot ]]; then
    log "npm run db:init"
    npm run db:init
  elif [[ -f .env ]]; then
    log "npm run db:init"
    npm run db:init
  else
    echo "warning: no .env.bot or .env — skip db:init" >&2
  fi
fi

restart_apps

log "Done. Logs: journalctl -u ai-tg-bot -u ai-tg-site -n 30 --no-pager"
