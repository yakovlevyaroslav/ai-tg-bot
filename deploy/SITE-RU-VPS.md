# Сайт на российском VPS (RU)

Публичный сайт, админка, webhook ЮKassa и **Squid** для запросов бота к ЮKassa — на **RU VPS**.  
Бот и Postgres — на [NL VPS](./BOT-NL-VPS.md).

> **Всё на одном сервере?** Если API доступны без прокси — [SINGLE-VPS.md](./SINGLE-VPS.md).

---

## Схема

```
Пользователь (РФ)
       │
       ▼
personality-code.ru  ──►  RU VPS
       │                    ├── nginx → ai-tg-site :3080
       │                    ├── Squid :3128 ◄── NL (YOOKASSA_PROXY)
       │                    └── PostgreSQL ──► NL :5432

Telegram  ──►  NL VPS (ai-tg-bot)
```

**На RU:** лендинг, политики, визитки, админка, webhook, Squid.  
**На NL:** бот, AI, создание платежей (через прокси).

---

## Чеклист

- [ ] Шаг 1 — Ubuntu, Node 20
- [ ] Шаг 2 — Squid
- [ ] Шаг 3 — `.env.site`
- [ ] Шаг 4 — `npm ci`, только сайт
- [ ] Шаг 5 — `install-systemd.sh --site-only`
- [ ] Шаг 6 — DNS
- [ ] Шаг 7 — `setup-domain.sh`
- [ ] Шаг 8 — webhook ЮKassa + `YOOKASSA_PROXY` на NL

---

## Шаг 0. Что понадобится

| Ресурс | Пример |
|--------|--------|
| RU VPS | Timeweb, Selectel, Beget — Ubuntu 22.04/24.04 |
| Домен | A → IP RU VPS |
| NL VPS | Уже с ботом и Postgres |
| `NL_VPS_IP`, `RU_VPS_IP` | Для firewall и env |

---

## Шаг 1. Система

```bash
ssh root@RU_VPS_IP

apt update && apt upgrade -y
apt install -y git curl

curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
```

Postgres на RU **не нужен**.

---

## Шаг 2. Squid (прокси для ЮKassa с NL)

IP бота (NL): узнайте на NL-сервере `curl -4 ifconfig.me` (у вас: `89.124.116.123`).

```bash
apt install -y squid

NL_VPS_IP=89.124.116.123   # ← замените на IP вашего NL VPS

cat > /etc/squid/squid.conf <<EOF
http_port 3128

acl nl_bot src ${NL_VPS_IP}/32
acl SSL_ports port 443
acl CONNECT method CONNECT

http_access allow CONNECT SSL_ports nl_bot
http_access deny all

visible_hostname personality-proxy
EOF

squid -k parse
systemctl enable squid
systemctl restart squid
ss -tlnp | grep 3128
```

Если `squid -k parse` падает — смотрите строку с ERROR:

```bash
squid -k parse 2>&1 | tail -20
cat -n /etc/squid/squid.conf
journalctl -u squid -n 20 --no-pager
```

Частые ошибки: в `acl` осталось `NL_VPS_IP` вместо цифр; старый битый конфиг — перезапишите целиком как выше.

```bash
ufw allow from ${NL_VPS_IP} to any port 3128 proto tcp
```

Проверка с **NL**:

```bash
curl -v --max-time 5 -x http://RU_VPS_IP:3128 https://api.yookassa.ru/v3/me
```

---

## Шаг 3. `.env.site`

```bash
mkdir -p ~/projects/ai-tg-bot && cd ~/projects/ai-tg-bot
git clone https://github.com/ВАШ_РЕПО/ai-tg-bot.git .

cp .env.site.example .env.site
nano .env.site
chmod 600 .env.site
```

| Переменная | Значение |
|------------|----------|
| `DATABASE_URL` | `postgresql://postgres:ПАРОЛЬ@NL_VPS_IP:5432/ai_tg_bot` |
| `TELEGRAM_BOT_TOKEN` | **как на NL** |
| `YOOKASSA_*`, `TOPUP_PACKAGES` | **как на NL** |
| `AI_PROVIDER` | `mock` |
| `ADMIN_WEB_HOST` | `127.0.0.1` |
| `ADMIN_WEB_PASSWORD` | пароль админки |
| `PUBLIC_SITE_URL` | `https://ваш-домен.ru` |

На NL должен быть настроен [доступ Postgres](./BOT-NL-VPS.md#шаг-6-доступ-к-postgres-с-ru-vps) с `RU_VPS_IP`.

---

## Шаг 4. Зависимости

```bash
npm ci --omit=dev
# db:init на RU не обязателен, если схема уже на NL
```

---

## Шаг 5. Запуск сайта

Убедитесь, что на RU есть **полный** `.env.site` (не одна строка) и `DATABASE_URL` указывает на NL Postgres.

Сначала проверка вручную (покажет ошибку в терминале):

```bash
cd ~/projects/site/ai-tg-bot   # ваш путь
node --env-file=.env.site src/site/index.js
```

Если стартует — `Ctrl+C` и systemd:

```bash
sudo bash deploy/install-systemd.sh --site-only
```

Проверьте, что unit **с** `--env-file` и **вашим** путём к проекту:

```bash
systemctl cat ai-tg-site | grep -E 'WorkingDirectory|ExecStart'
```

Должно быть примерно:

```
WorkingDirectory=/root/projects/site/ai-tg-bot
ExecStart=/usr/bin/node --env-file=/root/projects/site/ai-tg-bot/.env.site src/site/index.js
```

Если в `ExecStart` нет `--env-file` — на сервере старая версия скрипта/юнита. Обновите репозиторий и переустановите:

```bash
git pull
sudo bash deploy/install-systemd.sh --site-only
```

```bash
systemctl status ai-tg-site
curl -s http://127.0.0.1:3080/health
# {"ok":true}
```

Если падает — лог:

```bash
journalctl -u ai-tg-site -n 30 --no-pager
```

| Ошибка в логе | Решение |
|---------------|---------|
| `Missing required env` | заполните `.env.site` (токен, `DATABASE_URL`, ЮKassa, `ADMIN_WEB_PASSWORD`) |
| `ECONNREFUSED` / `password authentication` | [доступ Postgres с RU](./BOT-NL-VPS.md#шаг-6-доступ-к-postgres-с-ru-vps), пароль в `DATABASE_URL` |
| `ENOENT` `.env.site` | файл в корне проекта, путь в unit совпадает с `WorkingDirectory` |

На RU **отключите бота**, если `install-systemd` случайно включил `ai-tg-bot`:

```bash
sudo systemctl stop ai-tg-bot
sudo systemctl disable ai-tg-bot
```

На NL **не** запускайте `ai-tg-site` (или остановите, если был):

```bash
sudo systemctl stop ai-tg-site
sudo systemctl disable ai-tg-site
```

---

## Шаг 6. DNS

```
ваш-домен.ru  →  RU_VPS_IP
www           →  RU_VPS_IP
```

```bash
dig +short ваш-домен.ru
```

---

## Шаг 7. Nginx + SSL

```bash
sudo bash deploy/setup-domain.sh ваш-домен.ru admin@ваш-домен.ru
```

```bash
curl -s https://ваш-домен.ru/health
```

Админка: `https://ваш-домен.ru/admin`.

---

## Шаг 8. Webhook и прокси на NL

**ЮKassa** → HTTP-уведомления:

```
https://ваш-домен.ru/payments/yookassa/webhook
```

Событие: `payment.succeeded`.

На **NL** в `.env.bot`:

```env
YOOKASSA_PROXY=http://RU_VPS_IP:3128
PUBLIC_SITE_URL=https://ваш-домен.ru
```

```bash
sudo systemctl restart ai-tg-bot
```

---

## Финальная проверка

- [ ] Сайт открывается из РФ
- [ ] `/admin` по HTTPS
- [ ] WebApp и визитка
- [ ] Оплата в боте → webhook → баланс

---

## Обновление

**RU:**

```bash
cd ~/projects/ai-tg-bot
./release.sh --site-only
```

**NL:**

```bash
./release.sh --bot-only
```

---

## Проблемы

| Симптом | Решение |
|---------|---------|
| Сайт 502 | `journalctl -u ai-tg-site -n 50`, `curl localhost:3080/health` |
| Ошибка БД | `DATABASE_URL`, firewall/pg_hba на NL |
| Webhook не приходит | URL в ЮKassa, SSL, логи `ai-tg-site` |
| ЮKassa с бота | Squid, `YOOKASSA_PROXY`, порт 3128 с NL |

Индекс: [DEPLOY.md](../DEPLOY.md).
