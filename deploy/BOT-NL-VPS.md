# Бот и PostgreSQL на зарубежном VPS (NL)

Бот, AI и Postgres — на **одном зарубежном сервере** (VDSina, Hetzner и т.п.).  
Публичный сайт и домен — на [RU VPS](./SITE-RU-VPS.md).

> **Всё на одном сервере?** Если Telegram, OpenAI и ЮKassa работают без прокси — см. [SINGLE-VPS.md](./SINGLE-VPS.md).

---

## Схема

```
Telegram / OpenAI  ──►  NL VPS
                         ├── ai-tg-bot
                         ├── PostgreSQL :5432  ◄── RU VPS (только IP RU)
                         └── YOOKASSA_PROXY ──► Squid на RU :3128
```

| На NL | На RU |
|-------|-------|
| `ai-tg-bot`, Postgres | `ai-tg-site`, nginx, Squid, домен |

---

## Чеклист

- [ ] Шаг 1 — Ubuntu, Docker, Node 20
- [ ] Шаг 2 — Postgres
- [ ] Шаг 3 — `.env.bot`
- [ ] Шаг 4 — `npm ci`, `db:init`
- [ ] Шаг 5 — `install-systemd.sh --bot-only`
- [ ] Шаг 6 — доступ Postgres с RU (после RU VPS)
- [ ] Шаг 7 — `YOOKASSA_PROXY` (после Squid на RU)

---

## Шаг 1. Система

```bash
ssh root@NL_VPS_IP

apt update && apt upgrade -y
apt install -y git curl

curl -fsSL https://get.docker.com | sh
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
```

---

## Шаг 2. Postgres

```bash
mkdir -p ~/projects/ai-tg-bot && cd ~/projects/ai-tg-bot
git clone https://github.com/ВАШ_РЕПО/ai-tg-bot.git .
```

`docker-compose.prod.yml` — задайте `POSTGRES_PASSWORD`. Порт Postgres:

```yaml
ports:
  - '0.0.0.0:5432:5432'
```

Позже ограничите доступ firewall и `pg_hba.conf` только IP RU VPS.

```bash
docker compose -f docker-compose.prod.yml up -d
```

---

## Шаг 3. `.env.bot`

```bash
cp .env.bot.example .env.bot
nano .env.bot
chmod 600 .env.bot
```

| Переменная | Значение |
|------------|----------|
| `DATABASE_URL` | `postgresql://postgres:ПАРОЛЬ@127.0.0.1:5432/ai_tg_bot` |
| `TELEGRAM_BOT_TOKEN` | от @BotFather |
| `AI_PROVIDER` / `OPENAI_API_KEY` | OpenAI |
| `YOOKASSA_SHOP_ID`, `YOOKASSA_SECRET_KEY` | кабинет ЮKassa |
| `PUBLIC_SITE_URL` | `https://ваш-домен.ru` (сайт на RU) |
| `YOOKASSA_PROXY` | пока пусто; после Squid: `http://RU_VPS_IP:3128` |

`YOOKASSA_PROXY` и доступ к Postgres с RU — **после** [SITE-RU-VPS.md](./SITE-RU-VPS.md).

---

## Шаг 4. Зависимости и БД

```bash
npm ci --omit=dev
npm run db:init
```

---

## Шаг 5. Запуск бота

```bash
sudo bash deploy/install-systemd.sh --bot-only
```

```bash
systemctl status ai-tg-bot
journalctl -u ai-tg-bot -n 30 --no-pager
```

Telegram: `/start`.

---

## Шаг 6. Доступ к Postgres с RU VPS

После поднятия RU VPS (`RU_VPS_IP`).

### Firewall (UFW на NL)

```bash
ufw allow from RU_VPS_IP to any port 5432 proto tcp
ufw reload
```

### `pg_hba.conf` в контейнере

```bash
docker exec -it ai-tg-bot-postgres-1 bash
# или имя контейнера из docker ps

echo "host all all RU_VPS_IP/32 scram-sha-256" >> /var/lib/postgresql/data/pg_hba.conf
# перезапуск postgres внутри контейнера или docker restart
```

На **RU** в `.env.site`:

```env
DATABASE_URL=postgresql://postgres:ПАРОЛЬ@NL_VPS_IP:5432/ai_tg_bot
```

Проверка с RU:

```bash
psql "postgresql://postgres:ПАРОЛЬ@NL_VPS_IP:5432/ai_tg_bot" -c 'select 1'
```

---

## Шаг 7. ЮKassa через Squid (на RU)

В `.env.bot` на NL:

```env
YOOKASSA_PROXY=http://RU_VPS_IP:3128
```

```bash
sudo systemctl restart ai-tg-bot
```

Проверка создания платежа в боте.

---

## Обновление

```bash
cd ~/projects/ai-tg-bot
./release.sh --bot-only
```

---

## Проблемы

| Симптом | Решение |
|---------|---------|
| Бот не стартует | `journalctl -u ai-tg-bot -n 50` |
| Сайт не видит БД | `pg_hba`, firewall, `DATABASE_URL` на RU |
| ЮKassa timeout | Squid на RU, `YOOKASSA_PROXY`, `ufw` 3128 с NL |
| OpenAI timeout | Прокси или другой хостинг NL |

Дальше: [SITE-RU-VPS.md](./SITE-RU-VPS.md) — сайт, домен, Squid, webhook.
