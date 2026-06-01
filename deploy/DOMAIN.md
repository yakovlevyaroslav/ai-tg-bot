# Домен, лендинг, админка и webhook ЮKassa

Пошаговая настройка публичного сайта на VPS.

**Что получится:**

| URL | Назначение |
|-----|------------|
| `https://ваш-домен.ru/` | Лендинг |
| `https://ваш-домен.ru/admin` | Админка (логин/пароль) |
| `https://ваш-домен.ru/payments/yookassa/webhook` | Webhook ЮKassa |

---

## 1. Купить домен и привязать к серверу

У регистратора (Reg.ru, Timeweb, Cloudflare и т.д.) создайте **A-запись**:

```
@    →  IP_ВАШЕГО_VPS
www  →  IP_ВАШЕГО_VPS
```

Подождите 5–30 минут, проверьте:

```bash
dig +short ваш-домен.ru
```

Должен вернуть IP сервера.

---

## 2. Переменные в `.env` на сервере

```env
# Сайт
PUBLIC_SITE_NAME=Obormot Musoroglot
PUBLIC_BOT_USERNAME=ObormotMusoroglot_bot
PUBLIC_SITE_URL=https://ваш-домен.ru

# HTTP только на localhost — снаружи заходит nginx
ADMIN_WEB_HOST=127.0.0.1
ADMIN_WEB_PORT=3080
ADMIN_WEB_USER=adm1n
ADMIN_WEB_PASSWORD=надёжный_пароль

# ЮKassa
PAYMENT_PROVIDER=yookassa
YOOKASSA_SHOP_ID=...
YOOKASSA_SECRET_KEY=...
YOOKASSA_RETURN_URL=https://t.me/ObormotMusoroglot_bot
```

Перезапуск:

```bash
pm2 restart ai-tg-bot
pm2 logs ai-tg-bot --lines 20
```

В логах должно быть:

```
Site: http://127.0.0.1:3080/
YooKassa webhook: POST https://ваш-домен.ru/payments/yookassa/webhook
```

---

## 3. Nginx + SSL (автоматически)

На сервере, из папки проекта:

```bash
chmod +x deploy/setup-domain.sh
sudo bash deploy/setup-domain.sh ваш-домен.ru admin@ваш-домен.ru
```

Скрипт установит nginx, certbot и получит бесплатный SSL (Let's Encrypt).

**Вручную** (если нужно): конфиг в `deploy/nginx/ai-tg-bot.conf` — замените `example.com` на свой домен.

---

## 4. Webhook в личном кабинете ЮKassa

1. [yookassa.ru](https://yookassa.ru) → **Интеграция → HTTP-уведомления**
2. URL:

```
https://ваш-домен.ru/payments/yookassa/webhook
```

3. Событие: **`payment.succeeded`**
4. Сохранить

---

## 5. Проверка

```bash
# Лендинг
curl -sI https://ваш-домен.ru/ | head -1

# Health
curl -s https://ваш-домен.ru/health

# Webhook (должен ответить не 502)
curl -s -o /dev/null -w "%{http_code}" -X POST https://ваш-домен.ru/payments/yookassa/webhook
# Ожидается 403 (IP не ЮKassa) или 200 — главное не 502
```

В Telegram: **Пополнить** → сумма → **Оплатить** → после оплаты кредиты начислятся автоматически.

Админка в браузере: `https://ваш-домен.ru/admin` (SSH-тunnel больше не нужен).

---

## Локальная разработка

`ADMIN_WEB_HOST=0.0.0.0` — сайт на http://localhost:3080/  
Webhook локально не работает → кнопка **«Проверить оплату»** в боте.

---

## Обновление SSL

Certbot продлевает сертификат сам. Проверка:

```bash
sudo certbot renew --dry-run
```
