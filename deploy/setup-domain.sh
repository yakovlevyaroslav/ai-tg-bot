#!/usr/bin/env bash
# Nginx + Let's Encrypt для сайта (на VPS с ai-tg-site)
#
#   cd ~/projects/ai-tg-bot
#   sudo bash deploy/setup-domain.sh yourdomain.com admin@yourdomain.com
#
# Перед запуском:
#   1. DNS: yourdomain.com и www → IP этого сервера
#   2. .env.site: ADMIN_WEB_HOST=127.0.0.1, PUBLIC_SITE_URL=https://yourdomain.com
#   3. ai-tg-site запущен: curl -s http://127.0.0.1:3080/health

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

echo "==> Checking ai-tg-site health..."
if ! curl -sf --max-time 5 "http://127.0.0.1:3080/health" >/dev/null; then
  echo "Warning: http://127.0.0.1:3080/health failed. Start ai-tg-site first." >&2
fi

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
certbot --nginx -d "$DOMAIN" -d "www.${DOMAIN}" \
  --non-interactive --agree-tos -m "$EMAIL" --redirect

echo ""
echo "Done!"
echo "  Landing:  https://${DOMAIN}/"
echo "  Admin:    https://${DOMAIN}/admin"
echo "  Webhook:  https://${DOMAIN}/payments/yookassa/webhook"
echo ""
echo "Add webhook URL in YooKassa (payment.succeeded)."
