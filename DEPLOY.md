# Деплой на Ubuntu (облачный сервер)

Пошаговая инструкция: что установить, в каком порядке, как запустить бота и админку в production.

**Стек на сервере:** Ubuntu 22.04/24.04, Node.js 20+, PostgreSQL 16 (Docker), PM2, опционально Nginx.

---

## 1. Что понадобится до начала

| Что | Зачем |
|-----|--------|
| VPS с Ubuntu | 1 GB RAM минимум, 2 GB комфортнее |
| SSH-доступ | `ssh root@IP` или пользователь с sudo |
| Токен Telegram | [@BotFather](https://t.me/BotFather) |
| Ключ OpenAI | [platform.openai.com](https://platform.openai.com) (если `AI_PROVIDER=openai`) |
| Домен (опционально) | HTTPS для веб-админки |

Порты:

| Порт | Сервис | Доступ |
|------|--------|--------|
| 22 | SSH | только вы |
| 3080 (или свой) | Админка | только вы / через Nginx |
| 5432 | PostgreSQL | **только localhost**, не открывать в интернет |

Telegram и OpenAI API серверу доступны **исходящие** HTTPS-запросы (обычно по умолчанию разрешены).

---

## 2. Подключение к серверу

```bash
ssh user@ВАШ_IP
sudo apt update && sudo apt upgrade -y
```

---

## 3. Установка базовых пакетов

```bash
sudo apt install -y git curl ca-certificates ufw
```

### Файрвол

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp    # если будет Nginx + HTTPS
sudo ufw allow 443/tcp
# Админку наружу лучше НЕ открывать, а зайти через SSH-туннель (см. §10)
sudo ufw enable
sudo ufw status
```

---

## 4. Docker (для PostgreSQL)

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
```

Выйдите из SSH и зайдите снова, чтобы группа `docker` применилась.

Проверка:

```bash
docker --version
docker compose version
```

---

## 5. Node.js 20 LTS

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # v20.x
npm -v
```

---

## 6. PM2 (автозапуск бота после перезагрузки)

```bash
sudo npm install -g pm2
```

---

## 7. Загрузка проекта на сервер

### Вариант A — Git (рекомендуется)

На сервере:

```bash
cd ~
git clone https://github.com/ВАШ_РЕПОЗИТОРИЙ/ai-tg-bot.git
cd ai-tg-bot
```

### Вариант B — копирование с Mac

На **локальной** машине:

```bash
rsync -avz --exclude node_modules --exclude .env \
  /Users/yakovlev/Desktop/Freelance/ai-tg-bot/ \
  user@ВАШ_IP:~/ai-tg-bot/
```

На сервере:

```bash
cd ~/ai-tg-bot
```

---

## 8. PostgreSQL в Docker

В проекте уже есть `docker-compose.yml`. На сервере **смените пароль** — не используйте `postgres/postgres` в production.

```bash
cd ~/ai-tg-bot
nano docker-compose.yml
```

Пример для production (БД только на localhost):

```yaml
services:
  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: СЛОЖНЫЙ_ПАРОЛЬ_БД
      POSTGRES_DB: ai_tg_bot
    ports:
      - '127.0.0.1:5432:5432'
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  postgres_data:
```

Запуск:

```bash
docker compose up -d
docker compose ps
```

---

## 9. Файл `.env` на сервере

```bash
cp .env.example .env
nano .env
```

Обязательно заполните:

```env
TELEGRAM_BOT_TOKEN=реальный_токен_от_BotFather
DATABASE_URL=postgresql://postgres:СЛОЖНЫЙ_ПАРОЛЬ_БД@127.0.0.1:5432/ai_tg_bot

AI_PROVIDER=openai
OPENAI_API_KEY=sk-...

ADMIN_TELEGRAM_IDS=ваш_telegram_id
ADMIN_WEB_PORT=3080
ADMIN_WEB_USER=admin
ADMIN_WEB_PASSWORD=длинный_случайный_пароль

PAYMENT_DETAILS=...
PAYMENT_SUPPORT_USERNAME=@...
```

Права на файл (только владелец читает секреты):

```bash
chmod 600 .env
```

Промпты специалистов уже в `prompts/specialists/` — при необходимости отредактируйте на сервере.

---

## 10. Установка зависимостей и БД

```bash
cd ~/ai-tg-bot
npm ci --omit=dev
npm run db:init
```

Ожидаемый вывод: `Database schema applied`.

`db:init` нужен только `DATABASE_URL` в `.env`. Токен Telegram проверяется при `npm start` / PM2.

### Если ошибка SYSTEM_PROMPT_FILE not found

Файл `prompts/system.txt` в git **нет** (личный промпт). На сервере либо **удалите** строку из `.env`:

```bash
nano .env
# закомментируйте или удалите: SYSTEM_PROMPT_FILE=prompts/system.txt
```

либо создайте файл:

```bash
cp prompts/system.example.txt prompts/system.txt
```

Специалисты (таролог и т.д.) используют `prompts/specialists/*.txt` — они уже в репозитории.

Обновите код (`git pull`) — `npm run db:init` не должен загружать `config.js`.

В `.env` на одной строке, без кавычек и пробелов:

```env
TELEGRAM_BOT_TOKEN=1234567890:AAHxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Токен берётся в [@BotFather](https://t.me/BotFather) → ваш бот → **API Token** (не username бота).

Проверка одноразового запуска:

```bash
npm start
```

Должно появиться:

```text
Admin panel: http://localhost:3080/admin
Bot is running (AI_PROVIDER=openai)
```

Остановите: `Ctrl+C`.

---

## 11. Запуск через PM2 (production)

В проекте есть `ecosystem.config.cjs`:

```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

Последняя команда выведет строку с `sudo env ...` — **скопируйте и выполните её**, чтобы бот поднимался после перезагрузки VPS.

Полезные команды:

```bash
pm2 status
pm2 logs ai-tg-bot
pm2 restart ai-tg-bot
pm2 stop ai-tg-bot
```

---

## 12. Доступ к веб-админке

### Безопасный способ — SSH-туннель (без открытия порта в интернет)

На **вашем Mac**:

```bash
ssh -L 3080:127.0.0.1:3080 user@ВАШ_IP
```

Откройте в браузере: http://localhost:3080/admin  
Логин/пароль из `ADMIN_WEB_USER` / `ADMIN_WEB_PASSWORD`.

### Через интернет (опционально)

1. Откройте порт только для своего IP (не для всего мира), или  
2. Поставьте **Nginx + HTTPS** и Basic Auth (см. §13).

Не оставляйте админку на `0.0.0.0:3080` без пароля и без HTTPS в открытом доступе.

---

## 13. Nginx + HTTPS (опционально, если нужен домен)

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
```

Пример сайта `/etc/nginx/sites-available/ai-tg-bot-admin`:

```nginx
server {
    listen 80;
    server_name admin.ваш-домен.ru;

    location / {
        proxy_pass http://127.0.0.1:3080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/ai-tg-bot-admin /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d admin.ваш-домен.ru
```

---

## 14. Обновление бота после изменений

```bash
cd ~/ai-tg-bot
git pull          # или rsync снова
npm ci --omit=dev
npm run db:init   # безопасно повторять — схема IF NOT EXISTS
pm2 restart ai-tg-bot
```

---

## 15. Чеклист «всё работает»

- [ ] `docker compose ps` — postgres `running`
- [ ] `pm2 status` — `ai-tg-bot` online
- [ ] `pm2 logs` — нет ошибок `getMe`, `ECONNREFUSED` к БД
- [ ] Бот отвечает в Telegram
- [ ] Админка открывается (через туннель или Nginx)
- [ ] `.env` с правами `600`, пароли не `postgres` / не из example

---

## 16. Типичные проблемы

| Симптом | Решение |
|---------|---------|
| `getMe` 404 / 401 | Неверный `TELEGRAM_BOT_TOKEN` |
| `ECONNREFUSED 127.0.0.1:5432` | `docker compose up -d`, проверьте `DATABASE_URL` |
| `insufficient_quota` | Пополнить OpenAI, пока `AI_PROVIDER=mock` |
| Админка не открывается | `pm2 logs`, проверьте `ADMIN_WEB_PASSWORD`, порт `3080` |
| Бот падал после деплоя | `npm ci`, `pm2 restart`, смотреть логи |
| `getMe failed` / timeout | `curl .../getMe`, затем `git pull` (fix IPv4), `pm2 restart` |

---

## 17. Порядок установки (кратко)

1. Ubuntu + обновления  
2. Git, UFW  
3. Docker → PostgreSQL  
4. Node.js 20  
5. PM2  
6. Клонировать проект  
7. `docker compose up -d`  
8. `.env` + `chmod 600`  
9. `npm ci` → `npm run db:init`  
10. `pm2 start` → `pm2 save` → `pm2 startup`  
11. SSH-туннель или Nginx для админки  

Готово.
