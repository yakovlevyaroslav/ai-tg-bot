# AI Telegram Bot

Telegram-бот на Node.js с ChatGPT (или mock-режимом), историей диалога и системой кредитов в PostgreSQL.

📖 **Подробная документация:** [DOCUMENTATION.md](./DOCUMENTATION.md) — технологии, каждый файл, БД, сценарии, настройка API и пополнения.

💳 **Оплата и тарифы:** [PAYMENTS.md](./PAYMENTS.md) — ЮKassa, webhook, где менять пакеты и курс.

🚀 **Деплой на VPS:** [DEPLOY.md](./DEPLOY.md) · **Домен + webhook:** [deploy/DOMAIN.md](./deploy/DOMAIN.md) · **HTTP-прокси (Squid):** [deploy/SQUID-PROXY.md](./deploy/SQUID-PROXY.md)

## Стек

- Node.js (ES modules)
- Telegraf — Telegram Bot API
- OpenAI SDK — ChatGPT (опционально)
- PostgreSQL — пользователи, сообщения, баланс, транзакции

## Быстрый старт

```bash
docker compose up -d
npm install
cp .env.example .env
# Заполните TELEGRAM_BOT_TOKEN, DATABASE_URL, ADMIN_TELEGRAM_IDS
npm run db:init
npm run dev
```

## Переменные окружения

| Переменная | Описание |
|------------|----------|
| `TELEGRAM_BOT_TOKEN` | Токен от [@BotFather](https://t.me/BotFather) |
| `DATABASE_URL` | PostgreSQL |
| `AI_PROVIDER` | `mock` (без OpenAI) или `openai` |
| `OPENAI_API_KEY` | Нужен при `AI_PROVIDER=openai` |
| `CREDITS_PER_RUB` | Кредитов за 1 ₽ (10 → 100 ₽ = 1000 кредитов) |
| `CREDITS_PER_MESSAGE` | Стоимость одного ответа (по умолчанию 10) |
| `WELCOME_BONUS_CREDITS` | Бонус при первом `/start` (по умолчанию 300) |
| `TOPUP_PACKAGES_RUB` | Пакеты пополнения через запятую |
| `PAYMENT_PROVIDER` | `manual` (перевод) или `yookassa` (авто) |
| `PAYMENT_DETAILS` | Реквизиты для перевода (режим manual) |
| `YOOKASSA_SHOP_ID`, `YOOKASSA_SECRET_KEY` | Ключи ЮKassa (режим yookassa) |
| `ADMIN_TELEGRAM_IDS` | Telegram ID админов через запятую |

## Команды бота

- Текстовое сообщение — ответ AI (−кредиты)
- **💰 Баланс** / `/balance` — остаток кредитов
- **▶️ Старт** — приветствие
- **🔄 Рестарт** / `/clear` — очистить историю (бесплатно)
- **💳 Пополнить** — выбрать пакет (100 ₽ → 1000 кредитов и т.д.), получить код оплаты
- `/grant <кредиты>` — ручное начисление (админ)
- `/confirm <код>` — подтвердить оплату по коду `PAY-XXXXXX` (админ)

### Веб-админка (ЛК администратора)

При заданном `ADMIN_WEB_PASSWORD` в `.env` открывается http://localhost:3080/admin (порт — `ADMIN_WEB_PORT`)

- обзор статистики;
- список пользователей, балансы, поиск;
- карточка пользователя, история транзакций и AI-запросов;
- заявки на пополнение с кнопкой «Подтвердить»;
- начисление кредитов с веб-формы.

### Пополнение

**Ручной режим** (`PAYMENT_PROVIDER=manual`):

1. Пользователь: **💳 Пополнить** → пакет → код `PAY-…` и реквизиты.
2. Переводит деньги с кодом в комментарии.
3. Админ: `/confirm PAY-…` или кнопка в веб-админке.

**ЮKassa** (`PAYMENT_PROVIDER=yookassa`): кнопка «Оплатить» → автоначисление по webhook. Настройка — [PAYMENTS.md](./PAYMENTS.md).

## Структура

```
src/
  bot/           — Telegram-бот
    index.js     — точка входа (npm run start:bot)
    create-bot.js, topup.js, keyboards.js, ai/
  site/          — сайт и webhook
    index.js     — точка входа (npm run start:site)
    server.js, landing.js, admin/
  shared/        — общее: БД, биллинг, ЮKassa, config
sql/init.sql
deploy/          — nginx, домен, SSL, Squid-прокси
```

**Локально:** `npm run dev` — бот + сайт вместе  
**Production:** `pm2 start ecosystem.config.cjs` — два процесса
