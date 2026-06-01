#!/usr/bin/env bash
# Установка systemd-юнитов (запускать на сервере от root, из корня проекта)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cp "$SCRIPT_DIR/systemd/ai-tg-bot.service" /etc/systemd/system/
cp "$SCRIPT_DIR/systemd/ai-tg-site.service" /etc/systemd/system/

# Подставить реальный путь, если проект не в /root/projects/ai-tg-bot
sed -i "s|/root/projects/ai-tg-bot|$PROJECT_DIR|g" /etc/systemd/system/ai-tg-bot.service
sed -i "s|/root/projects/ai-tg-bot|$PROJECT_DIR|g" /etc/systemd/system/ai-tg-site.service

systemctl daemon-reload
systemctl enable ai-tg-bot ai-tg-site
systemctl restart ai-tg-bot ai-tg-site

echo "Done. Check:"
echo "  systemctl status ai-tg-bot ai-tg-site"
echo "  journalctl -u ai-tg-bot -u ai-tg-site -n 20 --no-pager"
