# Оплата и тарифы

## Где настраивать тарифы

**Тарифы задаются только в `.env` проекта**, не в личном кабинете ЮKassa.

| Переменная | Что делает | Пример |
|------------|------------|--------|
| `TOPUP_PACKAGES_RUB` | Суммы кнопок «Пополнить» в боте | `100,300,500,1000` |
| `CREDITS_PER_RUB` | Сколько кредитов за 1 ₽ | `10` → 100 ₽ = 1000 кредитов |
| `CREDITS_PER_MESSAGE` | Списание за один ответ AI | `10` |
| `WELCOME_BONUS_CREDITS` | Бонус новому пользователю | `300` |

Логика расчёта — в `src/pricing.js` и `src/config.js`.

Чтобы добавить пакет 200 ₽: измените `TOPUP_PACKAGES_RUB=100,200,300,500,1000` и перезапустите бота (`pm2 restart ai-tg-bot`).

В ЮKassa вы настраиваете только **подключение магазина** (shop_id, secret key, webhook). Суммы платежей бот передаёт в API автоматически из выбранного пакета.

---

## Режимы оплаты

### `PAYMENT_PROVIDER=manual` (по умолчанию)

1. Пользователь выбирает пакет
2. Бот показывает реквизиты (`PAYMENT_DETAILS`) и код `PAY-XXXXXX`
3. Админ подтверждает: `/confirm PAY-XXXXXX` или кнопка в веб-админке

### `PAYMENT_PROVIDER=yookassa`

1. Пользователь выбирает пакет
2. Бот создаёт платёж в [API ЮKassa](https://yookassa.ru/developers) и показывает кнопку «Оплатить»
3. После оплаты ЮKassa шлёт webhook → кредиты начисляются автоматически

---

## Подключение ЮKassa

### 1. Личный кабинет

1. Зарегистрируйте магазин в [ЮKassa](https://yookassa.ru/)
2. **Интеграция → Ключи API** — скопируйте `shopId` и `secret key`
3. Для тестов используйте тестовый магазин и тестовые карты ([документация](https://yookassa.ru/developers/payment-acceptance/testing-and-going-live/testing))

### 2. Переменные в `.env`

```env
PAYMENT_PROVIDER=yookassa

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
pm2 restart ai-tg-bot
```

---

## Проверка

**Тестовый платёж:**

1. `PAYMENT_PROVIDER=yookassa` + тестовые ключи
2. В боте: «Пополнить» → выбрать пакет → «Оплатить»
3. Оплатить тестовой картой `5555 5555 5555 4444`
4. В логах webhook, пользователю приходит «Оплата прошла успешно»

**Ручной режим** — оставьте `PAYMENT_PROVIDER=manual` или не задавайте переменную.

---

## Файлы в проекте

| Файл | Назначение |
|------|------------|
| `src/pricing.js` | Расчёт кредитов из рублей |
| `src/topup.js` | UI пополнения (manual / yookassa) |
| `src/payments.js` | Заявки, подтверждение, начисление |
| `src/yookassa/client.js` | HTTP-клиент API ЮKassa |
| `src/yookassa/webhook.js` | Обработчик `payment.succeeded` |
| `src/yookassa/service.js` | Создание платежа при выборе пакета |
