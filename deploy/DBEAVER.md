# Подключение PostgreSQL через DBeaver

Инструкция для просмотра базы бота «Код личности» в [DBeaver Community](https://dbeaver.io/download/).

Параметры подключения берутся из `DATABASE_URL` в `.env`.

---

## Локально (Mac, разработка)

### Параметры

Из `.env`:

```
DATABASE_URL=postgresql://yakovlev@localhost:5432/ai_tg_bot
```

| Поле | Значение |
|------|----------|
| Host | `localhost` |
| Port | `5432` |
| Database | `ai_tg_bot` |
| Username | `yakovlev` (или из URL) |
| Password | пусто, если в URL нет пароля |

Если Postgres через Docker (`docker compose up -d`):

| Поле | Значение |
|------|----------|
| Username | `postgres` |
| Password | `postgres` |
| Database | `ai_tg_bot` |

### Шаги в DBeaver

1. **Database** → **New Database Connection**
2. **PostgreSQL** → **Next** (скачать драйвер, если предложит)
3. Вкладка **Main** — заполнить таблицу выше
4. **Test Connection** → **Finish**

### Полезные таблицы

| Таблица | Содержимое |
|---------|------------|
| `users` | пользователи: `id`, `telegram_id`, анкета |
| `messages` | переписка (вопросы и ответы AI) |
| `balances` | остаток вопросов |
| `analytics_events` | воронка, события |
| `token_transactions` | начисления и списания |
| `pending_payments` | оплаты ЮKassa |
| `usage_events` | запросы к AI |

Пример SQL (**SQL Editor** → `⌘↩`):

```sql
SELECT id, telegram_id, first_name, onboarding_step, onboarding_completed
FROM users
ORDER BY created_at DESC;
```

Переписка пользователя (`1` — замените на `users.id`):

```sql
SELECT role, content, created_at
FROM messages
WHERE user_id = 1
ORDER BY created_at;
```

---

## Production: база на сервере → DBeaver на Mac

На VPS PostgreSQL **не открыт в интернет** — только `127.0.0.1:5432` (см. `docker-compose.prod.yml`).  
Подключение идёт через **SSH-туннель**.

### 1. Узнать параметры на сервере

```bash
ssh user@IP_СЕРВЕРА
cd /path/to/ai-tg-bot
grep DATABASE_URL .env
```

Пример:

```
DATABASE_URL=postgresql://postgres:ПАРОЛЬ@127.0.0.1:5432/ai_tg_bot
```

| Параметр | Значение |
|----------|----------|
| User | `postgres` |
| Password | из URL (между `:` и `@`) |
| Database | `ai_tg_bot` |
| Host на сервере | `127.0.0.1` |
| Port | `5432` |

### 2. DBeaver: SSH-туннель (рекомендуется)

1. **Database** → **New Database Connection** → **PostgreSQL**

**Вкладка Main:**

| Поле | Значение |
|------|----------|
| Host | `localhost` или `127.0.0.1` |
| Port | `5432` |
| Database | `ai_tg_bot` |
| Username | `postgres` |
| Password | пароль из `DATABASE_URL` на сервере |

> Host именно `localhost`, не IP сервера — так работает туннель.

**Вкладка SSH:**

- Включить **Use SSH Tunnel**
- **Host/IP** — IP или домен сервера
- **Port** — `22`
- **User name** — SSH-логин (`root`, `ubuntu` и т.д.)
- **Authentication** — Public Key (`~/.ssh/id_rsa`) или Password

**Test tunnel configuration** → **Test Connection** → **Finish**

### 3. Альтернатива: туннель в терминале

```bash
ssh -L 5433:127.0.0.1:5432 user@IP_СЕРВЕРА
```

Терминал **не закрывать**.

В DBeaver (без вкладки SSH):

| Поле | Значение |
|------|----------|
| Host | `localhost` |
| Port | `5433` |
| Database | `ai_tg_bot` |
| User / Password | как на сервере |

---

## Частые ошибки

| Ошибка | Решение |
|--------|---------|
| Database does not exist | На сервере: `npm run db:init` |
| Connection refused | Postgres не запущен: `docker compose -f docker-compose.prod.yml ps` |
| SSH failed | Проверить `ssh user@IP_СЕРВЕРА`, ключ, логин |
| Password authentication failed | Пароль из `.env` **на сервере**, не локальный |
| Role does not exist | Использовать `postgres` + пароль из Docker/`POSTGRES_PASSWORD` |

Проверка Postgres на сервере:

```bash
docker compose -f docker-compose.prod.yml ps
ss -tlnp | grep 5432   # должно быть 127.0.0.1:5432
```

---

## Безопасность

- **Не открывайте** порт 5432 в firewall наружу — только SSH-туннель.
- Для production по возможности не меняйте данные вручную; смотрите через SELECT или админку `/admin`.

---

## См. также

- [DEPLOY.md](../DEPLOY.md) — деплой и `DATABASE_URL`
- [DOMAIN.md](./DOMAIN.md) — домен и админка
