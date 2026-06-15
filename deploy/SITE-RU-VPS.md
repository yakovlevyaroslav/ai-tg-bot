# Сайт на отдельном российском VPS

Инструкция, когда **бот и PostgreSQL остаются на зарубежном VPS** (VDSina и т.п.), а **публичный сайт** (`personality-code.ru`) переезжает на российский IP.

## Схема

```
Пользователь (РФ)
       │
       ▼
personality-code.ru  ──►  RU VPS (nginx + ai-tg-site :3080)
       │                         │
       │                         ├── PostgreSQL ──► Bot VPS :5432 (только с IP RU VPS)
       │                         ├── Webhook ЮKassa
       │                         └── Telegram API (уведомление об оплате)

Telegram  ──►  Bot VPS (ai-tg-bot, без публичного сайта)
```

**Что отдаёт сайт:** лендинг `/`, политики, визитки `/code/...`, заглушка `/onboarding`, админка `/admin`, webhook ЮKassa.

**Что остаётся на боте:** Telegram-бот, расчёт кода, ответы на вопросы, создание платежей ЮKassa.

---

## 0. Что понадобится

| Ресурс | Пример |
|--------|--------|
| RU VPS | Timeweb, Selectel, Beget, REG.RU Cloud — Ubuntu 22.04/24.04 |
| IP RU VPS | Запишите — понадобится для firewall на боте |
| IP Bot VPS | Текущий сервер с ботом и PostgreSQL |
| Домен | `personality-code.ru` — A-запись переведёте на RU IP |

Минимум на RU VPS: 1 vCPU, 1 GB RAM, 10 GB SSD.

---

## 1. Открыть PostgreSQL для RU VPS (на сервере бота)

Сейчас Postgres слушает только `127.0.0.1`. Нужен доступ **только с IP российского VPS**.

### 1.1. Docker: проброс порта

В `docker-compose.prod.yml` на **бот-VPS** замените строку портов:

```yaml
    ports:
      - '127.0.0.1:5432:5432'
```

на:

```yaml
    ports:
      - '5432:5432'
```

Перезапуск:

```bash
cd ~/projects/ai-tg-bot   # ваш путь
docker compose -f docker-compose.prod.yml up -d
```

### 1.2. `pg_hba.conf` — разрешить RU IP

```bash
docker exec -it ai-tg-bot-postgres-1 sh -c 'echo "host all all RU_VPS_IP/32 scram-sha-256" >> /var/lib/postgresql/data/pg_hba.conf'
docker compose -f docker-compose.prod.yml restart postgres
```

`RU_VPS_IP` — публичный IP российского сервера (без `/32` в команде echo — подставьте IP целиком, например `185.12.34.56/32`).

Имя контейнера смотрите: `docker ps`.

### 1.3. Firewall на бот-VPS

```bash
ufw allow from RU_VPS_IP to any port 5432 proto tcp
ufw status
```

Порт 5432 **не открывайте** для всего интернета.

### 1.4. Проверка с RU VPS (после шага 2)

```bash
psql "postgresql://postgres:ПАРОЛЬ@BOT_VPS_IP:5432/ai_tg_bot" -c "SELECT 1"
```

---

## 2. Установка на российском VPS

```bash
ssh root@RU_VPS_IP
apt update && apt upgrade -y
apt install -y git curl

curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

npm install -g pm2
```

Клонирование проекта (тот же репозиторий, что и на боте):

```bash
git clone https://github.com/ВАШ_РЕПО/ai-tg-bot.git
cd ai-tg-bot
npm ci --omit=dev
```

`npm run db:init` на RU VPS **не нужен** — схема уже есть на бот-VPS.

---

## 3. `.env.site` для сайта

```bash
cp .env.site.example .env.site
nano .env.site
chmod 600 .env.site
```

Минимальный набор — в **`.env.site.example`**. Главное:

```env
# Обязательно для config.js
TELEGRAM_BOT_TOKEN=тот_же_токен_что_на_боте
DATABASE_URL=postgresql://postgres:ПАРОЛЬ@BOT_VPS_IP:5432/ai_tg_bot

# Сайт без OpenAI
AI_PROVIDER=mock

# ЮKassa (webhook на этом сервере — прокси не нужен)
YOOKASSA_SHOP_ID=...
YOOKASSA_SECRET_KEY=...
YOOKASSA_RETURN_URL=https://t.me/ВашБот
YOOKASSA_RECEIPT_EMAIL=receipts@personality-code.ru

# HTTP только на localhost — снаружи nginx
ADMIN_WEB_HOST=127.0.0.1
ADMIN_WEB_PORT=3080
ADMIN_WEB_USER=admin
ADMIN_WEB_PASSWORD=надёжный_пароль

# Публичные URL (уже на RU домене)
PUBLIC_SITE_NAME=Код личности
PUBLIC_BOT_USERNAME=ВашБотUsername
PUBLIC_SITE_URL=https://personality-code.ru
PRIVACY_POLICY_URL=https://personality-code.ru/privacy
COOKIES_POLICY_URL=https://personality-code.ru/cookies

# Для админки (аналитика, визитки)
ADMIN_TELEGRAM_IDS=ваш_telegram_id

# Тарифы — должны совпадать с ботом (для лендинга)
TOPUP_PACKAGES=200:5,300:10,500:20
PAYMENT_SUPPORT_USERNAME=@yakovlev_dev
```

**Не задавайте** `YOOKASSA_PROXY` на RU VPS — ЮKassa API с российского IP работает напрямую.

На **бот-VPS** при необходимости оставьте `YOOKASSA_PROXY` — создание платежей идёт из бота.

На **бот-VPS** используйте **`.env.bot`** (`cp .env.bot.example .env.bot`). Сайт на RU VPS — только **`.env.site`**.

Проверка запуска:

```bash
npm run start:site
# В другом окне:
curl -s http://127.0.0.1:3080/health
# {"ok":true}
```

Ctrl+C, затем production:

```bash
mkdir -p logs
pm2 start ecosystem.config.cjs --only ai-tg-site
pm2 save
pm2 startup
```

Или systemd:

```bash
sudo bash deploy/install-systemd.sh
sudo systemctl disable ai-tg-bot
sudo systemctl stop ai-tg-bot
sudo systemctl enable ai-tg-site
sudo systemctl restart ai-tg-site
```

---

## 4. DNS и SSL

У регистратора (REG.RU и т.д.) измените **A-запись**:

```
@   →  RU_VPS_IP
www →  RU_VPS_IP
```

Подождите 5–30 минут, проверьте:

```bash
dig +short personality-code.ru
```

На **RU VPS**:

```bash
sudo bash deploy/setup-domain.sh personality-code.ru admin@personality-code.ru
```

---

## 5. Отключить сайт на бот-VPS

Чтобы не было двух копий и путаницы с SSL:

```bash
# На бот-VPS
pm2 stop ai-tg-site
pm2 save

# или
sudo systemctl stop ai-tg-site
sudo systemctl disable ai-tg-site
```

Nginx на бот-VPS для `personality-code.ru` можно удалить:

```bash
sudo rm -f /etc/nginx/sites-enabled/ai-tg-bot
sudo nginx -t && sudo systemctl reload nginx
```

**Бот продолжает работать:**

```bash
pm2 restart ai-tg-bot
# или
sudo systemctl restart ai-tg-bot
```

---

## 6. Проверка

С **RU VPS** или любого ПК:

```bash
curl -sI https://personality-code.ru/ | head -1
curl -s https://personality-code.ru/health
```

С узлов в России: [check-host.net](https://check-host.net/check-http?host=https://personality-code.ru/) — узлы `ru1`, `ru4` должны дать `200 OK`.

Webhook (не 502):

```bash
curl -s -o /dev/null -w "%{http_code}" -X POST https://personality-code.ru/payments/yookassa/webhook
# 403 — нормально (IP не ЮKassa), главное не timeout и не 502
```

В Telegram: WebApp «Код личности», страница `/code/...`, тестовая оплата.

В личном кабинете ЮKassa URL webhook:

```
https://personality-code.ru/payments/yookassa/webhook
```

---

## 7. Обновление сайта

На **RU VPS**:

```bash
cd ~/ai-tg-bot
git pull
npm ci --omit=dev
pm2 restart ai-tg-site
```

На **бот-VPS** (если менялся только бот):

```bash
git pull && npm ci --omit=dev && pm2 restart ai-tg-bot
```

Оба сервера должны быть на **одной версии** кода, если менялась схема БД (`npm run db:init` — только на бот-VPS, где Postgres).

---

## 8. Безопасность (рекомендуется)

| Мера | Зачем |
|------|--------|
| `ufw allow 22,80,443` на RU VPS | Закрыть лишние порты |
| Postgres только с IP RU VPS | Не светить БД в интернет |
| Сильный `ADMIN_WEB_PASSWORD` | Админка за Basic Auth |
| WireGuard между VPS вместо открытого 5432 | Ещё надёжнее (опционально) |

### WireGuard (кратко, опционально)

Вместо публичного `5432` поднимите туннель между VPS и в `DATABASE_URL` используйте внутренний IP, например:

```env
DATABASE_URL=postgresql://postgres:ПАРОЛЬ@10.0.0.2:5432/ai_tg_bot
```

---

## 9. Типичные проблемы

| Симптом | Решение |
|---------|---------|
| `ECONNREFUSED` к Postgres | Firewall на боте, `pg_hba.conf`, порт docker |
| Сайт 502 | `pm2 logs ai-tg-site`, проверьте `curl localhost:3080/health` |
| Webhook не приходит | URL в ЮKassa, SSL, `pm2 logs ai-tg-site` |
| Визитка 404 | Данные в БД на боте — проверьте `DATABASE_URL` |
| `Missing required env` | Скопируйте недостающие переменные из `.env` бота |
| Оплата в боте не создаётся | На **бот-VPS** проверьте `YOOKASSA_PROXY` / доступ к api.yookassa.ru |

---

## 10. Чеклист миграции

- [ ] Заказан RU VPS, записан его IP
- [ ] Postgres на боте доступен только с RU IP
- [ ] Сайт запущен на RU VPS (`health` OK)
- [ ] DNS A → RU IP
- [ ] SSL (certbot) на RU VPS
- [ ] Сайт остановлен на бот-VPS
- [ ] check-host.ru — 200 из России
- [ ] Webhook ЮKassa обновлён
- [ ] WebApp и визитка открываются из Telegram
