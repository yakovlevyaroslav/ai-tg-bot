# Один VPS — всё на одном сервере

Если с сервера **одновременно** работают:
- Telegram API (`api.telegram.org`)
- OpenAI / ChatGPT
- ЮKassa (`api.yookassa.ru`) — без прокси

то бот, сайт и Postgres можно держать **на одной машине**. Squid и второй VPS не нужны.

> Если сайт не открывается из РФ или ЮKassa режет запросы по IP — используйте схему из [DEPLOY.md](../DEPLOY.md): NL (бот) + RU (сайт + Squid).

---

## Схема

```
                    ┌─────────────────────────────┐
  Telegram          │         один VPS            │
  OpenAI       ────►│  ai-tg-bot                  │
  ЮKassa webhook    │  ai-tg-site (:3080)        │
  Пользователи ────►│  PostgreSQL (localhost)     │
                    │  nginx → домен              │
                    └─────────────────────────────┘
```

| Компонент | systemd / Docker |
|-----------|------------------|
| PostgreSQL | Docker |
| Бот | `ai-tg-bot` → `.env.bot` |
| Сайт | `ai-tg-site` → `.env.site` |
| Домен + SSL | nginx + certbot |

**Не нужны:** Squid, `YOOKASSA_PROXY`, открытый порт 5432 наружу.

---

## Чеклист

- [ ] Шаг 0 — проверить доступ с сервера
- [ ] Шаг 1 — Ubuntu, Docker, Node 20
- [ ] Шаг 2 — Postgres
- [ ] Шаг 3 — `.env.bot` и `.env.site`
- [ ] Шаг 4 — `npm ci`, `db:init`
- [ ] Шаг 5 — systemd (оба сервиса)
- [ ] Шаг 6 — DNS
- [ ] Шаг 7 — `setup-domain.sh`
- [ ] Шаг 8 — webhook ЮKassa

---

## Шаг 0. Проверить сервер (до аренды или сразу после)

На VPS выполните:

```bash
# Telegram
curl -sS --max-time 15 "https://api.telegram.org/botВАШ_ТОКЕН/getMe"

# OpenAI (подставьте ключ)
curl -sS --max-time 15 https://api.openai.com/v1/models \
  -H "Authorization: Bearer sk-..."

# ЮKassa (shop_id:secret_key)
curl -sS --max-time 15 https://api.yookassa.ru/v3/me \
  -u SHOP_ID:SECRET_KEY
```

Все три должны ответить без timeout и без `403 Forbidden` по IP.  
Если ЮKassa не отвечает — этот сервер **не подходит** для схемы «всё в одном»; нужен [RU + Squid](./SITE-RU-VPS.md) или прокси.

---

## Шаг 1. Система

```bash
ssh root@VPS_IP

apt update && apt upgrade -y
apt install -y git curl

curl -fsSL https://get.docker.com | sh
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
node -v   # v20+
```

---

## Шаг 2. Postgres

```bash
mkdir -p ~/projects/ai-tg-bot && cd ~/projects/ai-tg-bot
git clone https://github.com/ВАШ_РЕПО/ai-tg-bot.git .
```

В `docker-compose.prod.yml` задайте `POSTGRES_PASSWORD`. Порт **только localhost**:

```yaml
ports:
  - '127.0.0.1:5432:5432'
```

```bash
docker compose -f docker-compose.prod.yml up -d
```

Порт 5432 **не открывайте** в firewall — БД только для процессов на этом же сервере.

---

## Шаг 3. Два env-файла на одной машине

```bash
cp .env.bot.example .env.bot
cp .env.site.example .env.site
nano .env.bot
nano .env.site
chmod 600 .env.bot .env.site
```

### `.env.bot`

| Переменная | Значение |
|------------|----------|
| `DATABASE_URL` | `postgresql://postgres:ПАРОЛЬ@127.0.0.1:5432/ai_tg_bot` |
| `TELEGRAM_BOT_TOKEN` | от @BotFather |
| `AI_PROVIDER` / `OPENAI_API_KEY` | как обычно |
| `YOOKASSA_*` | из кабинета |
| `PUBLIC_SITE_URL` | `https://ваш-домен.ru` |
| `YOOKASSA_PROXY` | **не задавайте** |

### `.env.site`

| Переменная | Значение |
|------------|----------|
| `DATABASE_URL` | **тот же**, что в `.env.bot` |
| `TELEGRAM_BOT_TOKEN` | **тот же** |
| `YOOKASSA_*`, `TOPUP_PACKAGES` | **те же** |
| `AI_PROVIDER` | `mock` |
| `ADMIN_WEB_HOST` | `127.0.0.1` |
| `ADMIN_WEB_PASSWORD` | пароль админки |
| `PUBLIC_SITE_URL` | `https://ваш-домен.ru` |

Полные шаблоны: `.env.bot.example`, `.env.site.example`.

---

## Шаг 4. Зависимости и схема БД

```bash
npm ci --omit=dev
npm run db:init
```

---

## Шаг 5. Запуск бота и сайта

```bash
sudo bash deploy/install-systemd.sh
```

Без флагов — ставит **оба** сервиса.

```bash
systemctl status ai-tg-bot ai-tg-site
curl -s http://127.0.0.1:3080/health
# {"ok":true}
journalctl -u ai-tg-bot -n 20 --no-pager
```

В Telegram: `/start`. Оплата должна создаваться без прокси.

---

## Шаг 6. DNS

```
ваш-домен.ru  →  VPS_IP
www           →  VPS_IP
```

```bash
dig +short ваш-домен.ru
```

---

## Шаг 7. Nginx + SSL

```bash
sudo bash deploy/setup-domain.sh ваш-домен.ru admin@ваш-домен.ru
```

Проверка:

```bash
curl -s https://ваш-домен.ru/health
# https://ваш-домен.ru/admin
```

---

## Шаг 8. Webhook ЮKassa

[yookassa.ru](https://yookassa.ru) → **HTTP-уведомления**:

```
https://ваш-домен.ru/payments/yookassa/webhook
```

Событие: `payment.succeeded`.

---

## Финальная проверка

- [ ] `/start` в Telegram
- [ ] Сайт и админка по HTTPS
- [ ] WebApp «Мой код личности», визитка `/code/...`
- [ ] Тестовая оплата → webhook → зачисление в боте

---

## Обновление

```bash
cd ~/projects/ai-tg-bot
chmod +x release.sh
./release.sh
```

Только restart после смены env:

```bash
./release.sh --restart-only
```

---

## Проблемы

| Симптом | Что сделать |
|---------|-------------|
| ЮKassa timeout с сервера | Сервер не подходит; схема NL+RU+Squid |
| Сайт не открывается из РФ | Перенесите **только сайт** на RU VPS ([SITE-RU-VPS.md](./SITE-RU-VPS.md)) |
| Один сервис упал | `journalctl -u ai-tg-bot -n 50` / `ai-tg-site` |
| 502 на домене | `curl localhost:3080/health`, `systemctl status ai-tg-site` |

---

## Когда переходить на два сервера

| Признак | Решение |
|---------|---------|
| Сайт недоступен из России | RU VPS для сайта + домена |
| `api.yookassa.ru` не отвечает | RU VPS + Squid, `YOOKASSA_PROXY` в `.env.bot` |
| Всё работает с одного IP | Оставайтесь на этой инструкции |

Подробно: [DEPLOY.md](../DEPLOY.md) → [BOT-NL-VPS.md](./BOT-NL-VPS.md) + [SITE-RU-VPS.md](./SITE-RU-VPS.md).
