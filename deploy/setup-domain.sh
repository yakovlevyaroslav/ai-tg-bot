#!/usr/bin/env bash
# Настройка домена на Ubuntu VPS: nginx + Let's Encrypt
#
# Использование (на сервере, от root):
#   cd ~/projects/ai-tg-bot
#   sudo bash deploy/setup-domain.sh yourdomain.com admin@yourdomain.com
#
# Перед запуском:
#   1. A-запись DNS: yourdomain.com → IP сервера
#   2. В .env: ADMIN_WEB_HOST=127.0.0.1, PUBLIC_SITE_URL=https://yourdomain.com
#   3. pm2 restart ai-tg-bot

set -euo pipefail

DOMAIN="${1:-}"
EMAIL="${2:-}"

if [[ -z "$DOMAIN" || -z "$EMAIL" ]]; then
  echo "Usage: sudo bash deploy/setup-domain.sh DOMAIN EMAIL"
  echo "Example: sudo bash deploy/setup-domain.sh bot.example.com admin@example.com"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
NGINX_CONF="/etc/nginx/sites-available/ai-tg-bot"

echo "==> Installing nginx and certbot..."
apt-get update -qq
apt-get install -y nginx certbot python3-certbot-nginx

echo "==> Writing nginx config for $DOMAIN..."
sed "s/example.com/${DOMAIN}/g; s/www.example.com/www.${DOMAIN}/g" \
  "$PROJECT_DIR/deploy/nginx/ai-tg-bot.conf" > "$NGINX_CONF"

ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/ai-tg-bot
rm -f /etc/nginx/sites-enabled/default

nginx -t
systemctl reload nginx

echo "==> Obtaining SSL certificate..."
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect

echo ""
echo "Done!"
echo "  Landing:  https://${DOMAIN}/"
echo "  Admin:    https://${DOMAIN}/admin"
echo "  Webhook:  https://${DOMAIN}/payments/yookassa/webhook"
echo ""
echo "Add webhook URL in YooKassa cabinet (Integrations → HTTP notifications)."
echo "Event: payment.succeeded"
