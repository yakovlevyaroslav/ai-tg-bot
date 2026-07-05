# AI Telegram Bot

Telegram-бот на Node.js с ChatGPT (или mock-режимом), историей диалога и оплатой по количеству вопросов в PostgreSQL.

📖 **Подробная документация:** [DOCUMENTATION.md](./DOCUMENTATION.md) — технологии, каждый файл, БД, сценарии, настройка API и пополнения.

💳 **Оплата и тарифы:** [PAYMENTS.md](./PAYMENTS.md) — ЮKassa, webhook, где менять пакеты и курс.

🪪 **Визитки кода личности:** [VISIT-CARDS.md](./VISIT-CARDS.md) — публикация, URL, хранение, админка.

🚀 **Деплой:** [DEPLOY.md](./DEPLOY.md) · один VPS: [deploy/SINGLE-VPS.md](./deploy/SINGLE-VPS.md) · NL+RU: [deploy/BOT-NL-VPS.md](./deploy/BOT-NL-VPS.md) + [deploy/SITE-RU-VPS.md](./deploy/SITE-RU-VPS.md)

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
| `REQUESTS_PER_MESSAGE` | Списание за один ответ (по умолчанию 1) |
| `WELCOME_BONUS_REQUESTS` | Бесплатные вопросы при первом `/start` (0 — без бонуса) |
| `WELCOME_MESSAGE` / `WELCOME_MESSAGE_FILE` | Текст приветствия на `/start` (плейсхолдеры: `{packages}`, `{welcome_bonus_line}`, `{requests_per_message}`, `{name}`) |
| `TOPUP_PACKAGES` | Тарифы `рубли:вопросы` через запятую | `200:5,300:10,500:20` |
| `YOOKASSA_SHOP_ID`, `YOOKASSA_SECRET_KEY` | Ключи ЮKassa (обязательно) |
| `ADMIN_TELEGRAM_IDS` | Telegram ID админов через запятую |

## Команды бота

- Текстовое сообщение — ответ AI (−1 вопрос)
- **💰 Баланс** / `/balance` — сколько вопросов осталось
- **▶️ Старт** — приветствие
- **🔄 Рестарт** / `/clear` — очистить историю (бесплатно)
- **💳 Пополнить** — выбрать пакет (200 ₽ → 5 вопросов и т.д.)
- `/grant <вопросы>` — ручное начисление (админ)

### Веб-админка (ЛК администратора)

При заданном `ADMIN_WEB_PASSWORD` в `.env` открывается http://localhost:3080/admin (порт — `ADMIN_WEB_PORT`)

- обзор статистики;
- список пользователей, балансы, поиск;
- карточка пользователя, история транзакций и AI-запросов;
- история оплат ЮKassa;
- начисление вопросов с веб-формы.

### Пополнение

Только через **ЮKassa**: **💳 Пополнить** → пакет → «Оплатить» → автоначисление по webhook. Настройка — [PAYMENTS.md](./PAYMENTS.md).

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
deploy/          — nginx, systemd, домен, SSL
```

**Локально:** `npm run dev` — бот + сайт вместе  
**Production:** `sudo bash deploy/install-systemd.sh` — см. [DEPLOY.md](./DEPLOY.md)
