# Оплата и тарифы

## Где настраивать тарифы

**Тарифы задаются только в `.env` проекта**, не в личном кабинете ЮKassa.

| Переменная | Что делает | Пример |
|------------|------------|--------|
| `TOPUP_PACKAGES` | Публичные тарифы: рубли:кол-во вопросов | `111:5,199:10,300:20` |
| `ADMIN_TOPUP_PACKAGE` | Тестовый тариф только для админов (`off` — выкл.) | `1:10` |
| `REQUESTS_PER_MESSAGE` | Списание за один ответ AI | `1` |
| `WELCOME_BONUS_REQUESTS` | Бесплатные вопросы новому пользователю (базовый разбор не списывается) | `1` |

Логика расчёта — в `src/pricing.js` и `src/config.js`.

Чтобы добавить пакет 400 ₽ на 15 вопросов: `TOPUP_PACKAGES=111:5,199:10,300:20` и перезапустите бота (`systemctl restart ai-tg-bot`).

В ЮKassa вы настраиваете только **подключение магазина** (shop_id, secret key, webhook). Суммы платежей бот передаёт в API автоматически из выбранного пакета.

---

## Как работает оплата

1. Пользователь выбирает пакет в боте
2. Бот создаёт платёж в [API ЮKassa](https://yookassa.ru/developers) и показывает кнопку «Оплатить»
3. После оплаты ЮKassa шлёт webhook → вопросы начисляются автоматически

---

## Подключение ЮKassa

### 1. Личный кабинет

1. Зарегистрируйте магазин в [ЮKassa](https://yookassa.ru/)
2. **Интеграция → Ключи API** — скопируйте `shopId` и `secret key`
3. Для тестов используйте тестовый магазин и тестовые карты ([документация](https://yookassa.ru/developers/payment-acceptance/testing-and-going-live/testing))

### 2. Переменные в `.env`

```env
YOOKASSA_SHOP_ID=123456
YOOKASSA_SECRET_KEY=live_xxxxxxxx
YOOKASSA_RETURN_URL=https://t.me/your_bot_username

# Опционально: чек 54-ФЗ (если подключена онлайн-касса)
# YOOKASSA_RECEIPT_EMAIL=receipts@yourdomain.com
# YOOKASSA_VAT_CODE=1
```

### 3. Webhook (обязательно для автоначисления)

Webhook должен быть доступен **публично по HTTPS** (в отличие от админки через SSH-tunnel).

**URL для личного кабинета ЮKassa:**

```
https://ВАШ_ДОМЕН/payments/yookassa/webhook
```

Бот слушает этот путь на порту `ADMIN_WEB_PORT` (по умолчанию `3080`).

#### Nginx (пример)

```nginx
server {
    listen 443 ssl;
    server_name pay.example.com;

    location /payments/yookassa/webhook {
        proxy_pass http://127.0.0.1:3080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

В кабинете ЮKassa: **Интеграция → HTTP-уведомления** → URL выше, событие `payment.succeeded`.

IP-адреса ЮKassa проверяются автоматически ([список](https://yookassa.ru/developers/using-api/webhooks#ip)). Для локальной отладки: `YOOKASSA_SKIP_IP_CHECK=true` (только dev).

### 4. Применить схему БД и перезапуск

```bash
npm run db:init
systemctl restart ai-tg-bot
```

---

## Проверка

**Тестовый платёж:**

1. Тестовые ключи ЮKassa в `.env`
2. В боте: «Пополнить» → выбрать пакет → «Оплатить»
3. Оплатить тестовой картой `5555 5555 5555 4444`
4. В логах webhook, пользователю приходит «Оплата прошла успешно»

---

## Файлы в проекте

| Файл | Назначение |
|------|------------|
| `src/shared/pricing.js` | Тарифы и пакеты |
| `src/bot/topup.js` | UI пополнения (ЮKassa) |
| `src/shared/payments.js` | Заявки и начисление после оплаты |
| `src/yookassa/client.js` | HTTP-клиент API ЮKassa |
| `src/yookassa/webhook.js` | Обработчик `payment.succeeded` |
| `src/yookassa/service.js` | Создание платежа при выборе пакета |
