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
                         ├── Squid :3128  ◄── RU (TELEGRAM_API_PROXY)
                         └── YOOKASSA_PROXY ──► Squid на RU :3128
```

| На NL | На RU |
|-------|-------|
| `ai-tg-bot`, Postgres, Squid (Telegram) | `ai-tg-site`, nginx, Squid (ЮKassa), домен |

**Два Squid — разные направления:**

| Где | Кто подключается | Зачем |
|-----|------------------|-------|
| **RU :3128** | NL (бот) | Запросы к `api.yookassa.ru` (IP бота не в РФ) |
| **NL :3128** | RU (сайт) | Запросы к `api.telegram.org` (рассылка, уведомления об оплате) |

---

## Чеклист

- [ ] Шаг 1 — Ubuntu, Docker, Node 20
- [ ] Шаг 2 — Postgres
- [ ] Шаг 3 — `.env.bot`
- [ ] Шаг 4 — `npm ci`, `db:init`
- [ ] Шаг 5 — `install-systemd.sh --bot-only`
- [ ] Шаг 6 — доступ Postgres с RU (после RU VPS)
- [ ] Шаг 7 — `YOOKASSA_PROXY` (после Squid на RU)
- [ ] Шаг 8 — Squid на NL для Telegram с RU (после RU VPS)

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

Пароль Postgres для Docker — в **корневом** `.env` (не путать с `.env.bot`):

```bash
echo 'POSTGRES_PASSWORD=ваш_пароль' > .env
chmod 600 .env
```

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

| Файл | Назначение |
|------|------------|
| `.env` | только `POSTGRES_PASSWORD` — читает Docker Compose |
| `.env.bot` | весь конфиг бота: `DATABASE_URL`, токен, ключи |

В `.env.bot` **обязательно** строка `DATABASE_URL` с **тем же** паролем, что в `.env`:

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

## Шаг 8. Squid на NL (Telegram для RU-сайта)

Сайт на RU (админка, webhook) иногда **не достучится** до `api.telegram.org` напрямую.  
Прокси на NL решает это: RU → NL Squid → Telegram API.

IP сайта (RU): узнайте на RU-сервере `curl -4 ifconfig.me`.

```bash
ssh root@NL_VPS_IP

apt install -y squid
# ← IP RU VPS: на RU выполните curl -4 ifconfig.me

RU_VPS_IP=130.49.149.149   
cat > /etc/squid/squid.conf <<EOF
http_port 3128

acl ru_site src ${RU_VPS_IP}/32
acl SSL_ports port 443
acl CONNECT method CONNECT

http_access allow CONNECT SSL_ports ru_site
http_access deny all

visible_hostname personality-nl-proxy

cache_dir ufs /var/spool/squid 100 16 256
coredump_dir /var/spool/squid
EOF
# На Ubuntu без cache_dir Squid часто не поднимается

mkdir -p /var/spool/squid
chown -R proxy:proxy /var/spool/squid
squid -z -f /etc/squid/squid.conf
squid -k parse

systemctl enable squid
systemctl restart squid
systemctl status squid --no-pager
ss -tlnp | grep 3128
```

Если порт **3128 не слушается**:

```bash
journalctl -u squid -n 50 --no-pager
squid -k parse 2>&1 | tail -20
cat -n /etc/squid/squid.conf | head -20
```

Частые ошибки:

| Симптом | Решение |
|---------|---------|
| В `acl` строка `RU_VPS_IP`, не IP | задайте `RU_VPS_IP=...` **до** heredoc |
| `Failed to make swap directory` | `mkdir -p /var/spool/squid && chown -R proxy:proxy /var/spool/squid && squid -z` |
| `restart` «висит» | первый старт создаёт кэш — подождите 30–60 с или смотрите `journalctl -u squid -f` |
| Порт занят | `ss -tlnp | grep 3128` — другой процесс; смените `http_port` или остановите конфликт |

Firewall — только RU:

```bash
ufw allow from ${RU_VPS_IP} to any port 3128 proto tcp
ufw reload
```

Проверка с **RU** (подставьте токен бота):

```bash
curl -sS --max-time 15 -x http://NL_VPS_IP:3128 \
  "https://api.telegram.org/bot<TOKEN>/getMe"
```

Ожидается `"ok":true`.

На **RU** в `.env.site`:

```env
TELEGRAM_API_PROXY=http://NL_VPS_IP:3128
```

```bash
sudo systemctl restart ai-tg-site
```

Проверка: в админке **Рассылка → Тест** или оплата → уведомление в Telegram.

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
| Рассылка / notify с RU | Squid на NL, `TELEGRAM_API_PROXY`, `ufw` 3128 с RU |
| OpenAI timeout | Прокси или другой хостинг NL |

Дальше: [SITE-RU-VPS.md](./SITE-RU-VPS.md) — сайт, домен, Squid, webhook.
