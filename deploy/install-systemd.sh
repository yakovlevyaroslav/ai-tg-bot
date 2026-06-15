#!/usr/bin/env bash
# Установка systemd-юнитов (на сервере от root, из корня проекта)
#
#   sudo bash deploy/install-systemd.sh              # оба сервиса (один VPS)
#   sudo bash deploy/install-systemd.sh --bot-only    # только NL
#   sudo bash deploy/install-systemd.sh --site-only   # только RU

set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root: sudo bash deploy/install-systemd.sh" >&2
  exit 1
fi

BOT_ONLY=false
SITE_ONLY=false
for arg in "$@"; do
  case "$arg" in
    --bot-only) BOT_ONLY=true ;;
    --site-only) SITE_ONLY=true ;;
    *) echo "Unknown: $arg" >&2; exit 1 ;;
  esac
done

if $BOT_ONLY && $SITE_ONLY; then
  echo "Use only one of --bot-only or --site-only" >&2
  exit 1
fi

INSTALL_BOT=true
INSTALL_SITE=true
if $BOT_ONLY; then INSTALL_SITE=false; fi
if $SITE_ONLY; then INSTALL_BOT=false; fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

if $INSTALL_BOT && [[ ! -f "$PROJECT_DIR/.env.bot" ]]; then
  echo "Missing $PROJECT_DIR/.env.bot" >&2
  exit 1
fi
if $INSTALL_SITE && [[ ! -f "$PROJECT_DIR/.env.site" ]]; then
  echo "Missing $PROJECT_DIR/.env.site" >&2
  exit 1
fi

install_unit() {
  local name="$1"
  cp "$SCRIPT_DIR/systemd/${name}.service" "/etc/systemd/system/${name}.service"
  sed -i "s|/root/projects/ai-tg-bot|$PROJECT_DIR|g" "/etc/systemd/system/${name}.service"
  systemctl daemon-reload
  systemctl enable "$name"
  systemctl restart "$name"
}

if $INSTALL_BOT; then
  install_unit ai-tg-bot
  echo "ai-tg-bot enabled"
fi
if $INSTALL_SITE; then
  install_unit ai-tg-site
  echo "ai-tg-site enabled"
fi

echo ""
echo "Check:"
if $INSTALL_BOT; then echo "  systemctl status ai-tg-bot"; fi
if $INSTALL_SITE; then echo "  systemctl status ai-tg-site"; fi
echo "  journalctl -u ai-tg-bot -u ai-tg-site -n 20 --no-pager"
