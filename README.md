# AI Telegram Bot

Telegram-бот на Node.js с ChatGPT (или mock-режимом), историей диалога и системой кредитов в PostgreSQL.

📖 **Подробная документация:** [DOCUMENTATION.md](./DOCUMENTATION.md) — технологии, каждый файл, БД, сценарии, настройка API и пополнения.

🚀 **Деплой на Ubuntu VPS:** [DEPLOY.md](./DEPLOY.md)

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
| `PAYMENT_DETAILS` | Реквизиты для перевода |
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

### Пополнение (сейчас — ручное)

1. Пользователь: **💳 Пополнить** → пакет → код `PAY-…` и реквизиты.
2. Переводит деньги с кодом в комментарии.
3. Админ получает уведомление и выполняет `/confirm PAY-…`.
4. Кредиты зачисляются, пользователю приходит сообщение.

Позже можно подключить ЮKassa / Telegram Payments — логика `purchase` в БД уже готова.

## Структура

```
src/
  bot.js       — Telegram
  billing.js   — кредиты, списание, бонусы
  ai/          — mock и openai провайдеры
  admin.js     — /grant
sql/init.sql   — схема БД
```
