# Деплой на Ubuntu VPS

Минимальная инструкция для production: бот + PostgreSQL + PM2 + админка.

**Стек:** Ubuntu, Docker (PostgreSQL 16), Node.js 20, PM2.

---

## 1. Установка на сервер

```bash
ssh root@ВАШ_IP
apt update && apt upgrade -y
apt install -y git curl

# Docker
curl -fsSL https://get.docker.com | sh

# Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# PM2
npm install -g pm2
```

---

## 2. Проект

```bash
git clone https://github.com/ВАШ_РЕПО/ai-tg-bot.git
cd ai-tg-bot
```

PostgreSQL (пароль замените на свой):

```bash
nano docker-compose.prod.yml   # POSTGRES_PASSWORD
docker compose -f docker-compose.prod.yml up -d
```

`.env`:

```bash
cp .env.example .env
nano .env
chmod 600 .env
```

Минимум в `.env`:

```env
TELEGRAM_BOT_TOKEN=...          # @BotFather → API Token
DATABASE_URL=postgresql://postgres:ПАРОЛЬ@127.0.0.1:5432/ai_tg_bot
AI_PROVIDER=openai              # или mock
OPENAI_API_KEY=sk-...
ADMIN_TELEGRAM_IDS=ваш_id
ADMIN_WEB_PASSWORD=надёжный_пароль
```

Не добавляйте `SYSTEM_PROMPT_FILE` — промпты специалистов в `prompts/specialists/`.

```bash
npm ci --omit=dev
npm run db:init
```

---

## 3. Запуск (PM2)

```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

Проверка:

```bash
pm2 status
pm2 logs ai-tg-bot
```

В логах: `Bot is running`. В Telegram: `/start`.

---

## 4. Админка

Слушает только `localhost:3080` на сервере. С **Mac**:

```bash
ssh -L 3080:127.0.0.1:3080 root@ВАШ_IP
```

Браузер: http://localhost:3080/admin  
Логин: `ADMIN_WEB_USER` / `ADMIN_WEB_PASSWORD` из `.env`.

---

## 5. Обновление

```bash
cd ~/projects/ai-tg-bot   # ваш путь
git pull
npm ci --omit=dev
npm run db:init
pm2 restart ai-tg-bot
```

После смены `.env` (токен, ключи): только `pm2 restart ai-tg-bot`.

---

## 6. Если что-то не работает

| Проблема | Решение |
|----------|---------|
| `ECONNREFUSED :5432` | `docker compose -f docker-compose.prod.yml up -d`, проверьте `DATABASE_URL` |
| `getMe` 404 | Неверный `TELEGRAM_BOT_TOKEN` |
| Timeout к Telegram | `curl -s "https://api.telegram.org/bot$TOKEN/getMe"`, затем `git pull` и `pm2 restart` |
| Админка не открывается | SSH-туннель должен быть запущен до открытия браузера |

Проверка токена:

```bash
source .env
curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe"
```

Ожидается `"ok":true`.
