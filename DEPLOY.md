# Деплой с нуля

Выберите схему под ваши серверы.

---

## Какую схему выбрать

| Условие | Инструкция |
|---------|------------|
| **Один VPS**: Telegram, OpenAI и ЮKassa работают без прокси | **[SINGLE-VPS.md](./deploy/SINGLE-VPS.md)** |
| **Два VPS**: сайт из РФ + бот за рубежом, ЮKassa через Squid | Ниже (NL + RU) |

Проверка «подходит ли один сервер» — [SINGLE-VPS.md § шаг 0](./deploy/SINGLE-VPS.md#шаг-0-проверить-сервер-до-аренды-или-сразу-после).

---

## Схема: два VPS (NL + RU)

```
┌──────────── RU VPS ────────────┐     ┌──────────── NL VPS ────────────┐
│ nginx → ai-tg-site (:3080)     │     │ ai-tg-bot                      │
│ Squid (:3128)                  │     │ PostgreSQL (:5432)             │
│ домен → сюда                   │────►│                                │
└────────────────────────────────┘     └────────────────────────────────┘
```

| | NL VPS | RU VPS |
|---|--------|--------|
| **Инструкция** | [BOT-NL-VPS.md](./deploy/BOT-NL-VPS.md) | [SITE-RU-VPS.md](./deploy/SITE-RU-VPS.md) |
| **Конфиг** | `.env.bot` | `.env.site` |
| **systemd** | `ai-tg-bot` | `ai-tg-site`, `squid` |

### Чеклист

| # | Где | Действие |
|---|-----|----------|
| 1 | NL | [Бот + Postgres](./deploy/BOT-NL-VPS.md) шаги 1–5 |
| 2 | RU | [Squid + сайт](./deploy/SITE-RU-VPS.md) шаги 1–5 |
| 3 | NL | [Postgres для RU](./deploy/BOT-NL-VPS.md#шаг-6-доступ-к-postgres-с-ru-vps) |
| 4 | RU | [DNS + SSL + webhook](./deploy/SITE-RU-VPS.md) шаги 6–8 |
| 5 | NL | `YOOKASSA_PROXY` → restart бота |

---

## Схема: один VPS

Всё на одной машине: бот + сайт + Postgres + домен. Без Squid.

**[SINGLE-VPS.md](./deploy/SINGLE-VPS.md)** — полная инструкция.

```bash
sudo bash deploy/install-systemd.sh          # оба сервиса
sudo bash deploy/setup-domain.sh домен.ru admin@домен.ru
./release.sh
```

---

## Env-файлы

| Файл | Где | Шаблон |
|------|-----|--------|
| `.env.bot` | VPS с ботом | `.env.bot.example` |
| `.env.site` | VPS с сайтом | `.env.site.example` |

На **одном VPS** — оба файла, один `DATABASE_URL` (`127.0.0.1`), без `YOOKASSA_PROXY`.

На **двух VPS** — `DATABASE_URL` на RU указывает на `NL_VPS_IP`; на NL — `YOOKASSA_PROXY` → Squid на RU.

**Совпадают на всех серверах:** `TELEGRAM_BOT_TOKEN`, `YOOKASSA_*`, `TOPUP_PACKAGES`, `PUBLIC_SITE_URL`.

---

## Скрипты

| Скрипт | Когда |
|--------|-------|
| `install-systemd.sh` | Один VPS — без флагов; NL — `--bot-only`; RU — `--site-only` |
| `setup-domain.sh` | VPS с сайтом и доменом |
| `release.sh` | Обновление кода |

---

## Локально

```bash
docker compose up -d && npm install
cp .env.example .env && npm run db:init
npm run dev
```

---

## См. также

- [PAYMENTS.md](./PAYMENTS.md) — тарифы
- [deploy/DBEAVER.md](./deploy/DBEAVER.md) — DBeaver
