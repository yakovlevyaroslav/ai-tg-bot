# HTTP-прокси на отдельном VPS (Squid)

Инструкция для **своего** HTTP-прокси на отдельном сервере (часто RU VPS).  
Клиент подключается так: `http://логин:пароль@IP_ПРОКСИ:3128`.

Папка `/var/www/proxy` к Squid не относится — сервис использует `/etc/squid/`.

---

## Что должно получиться

| Параметр | Значение |
|----------|----------|
| Сервис | `squid` |
| Порт | `3128` (по умолчанию) |
| Авторизация | Basic, файл `/etc/squid/passwords` |
| HTTPS | через метод CONNECT на порт 443 |

---

## 1. Проверить, что Squid уже работает

На **прокси-сервере**:

```bash
systemctl status squid --no-pager
grep -E '^http_port|^auth_param|^http_access|^acl ' /etc/squid/squid.conf | grep -v '^#'
ss -tlnp | grep 3128
```

Типичный рабочий вывод:

```
http_port 3128
auth_param basic program /usr/lib/squid/basic_ncsa_auth /etc/squid/passwords
auth_param basic realm YooKassa Proxy
acl authenticated proxy_auth REQUIRED
http_access allow authenticated
http_access deny all
```

Узнать публичный IP прокси:

```bash
curl -s ifconfig.me; echo
```

---

## 2. Установка с нуля (Ubuntu/Debian)

Выполнять на сервере, который будет прокси.

### 2.1. Пакеты

```bash
apt update
apt install -y squid apache2-utils
```

### 2.2. Пользователь и пароль

```bash
export PROXY_USER="myuser"
export PROXY_PASS="MyStrongPass123"

htpasswd -cb /etc/squid/passwords "$PROXY_USER" "$PROXY_PASS"
chmod 640 /etc/squid/passwords
chown proxy:proxy /etc/squid/passwords
```

### 2.3. Конфиг

**Вариант A** — доступ с любого IP (только по логину/паролю):

```bash
cat > /etc/squid/squid.conf <<'EOF'
http_port 3128

auth_param basic program /usr/lib/squid/basic_ncsa_auth /etc/squid/passwords
auth_param basic realm YooKassa Proxy

acl SSL_ports port 443
acl Safe_ports port 80 443
acl CONNECT method CONNECT
acl authenticated proxy_auth REQUIRED

http_access deny !Safe_ports
http_access deny CONNECT !SSL_ports
http_access allow authenticated
http_access deny all

coredump_dir /var/spool/squid
EOF
```

**Вариант B** — только с IP клиента (например, VPS с ботом):

```bash
export BOT_IP="1.2.3.4"

cat > /etc/squid/squid.conf <<EOF
http_port 3128

auth_param basic program /usr/lib/squid/basic_ncsa_auth /etc/squid/passwords
auth_param basic realm YooKassa Proxy

acl SSL_ports port 443
acl Safe_ports port 80 443
acl CONNECT method CONNECT
acl authenticated proxy_auth REQUIRED
acl allowed_client src ${BOT_IP}

http_access deny !Safe_ports
http_access deny CONNECT !SSL_ports
http_access allow allowed_client authenticated
http_access deny all

coredump_dir /var/spool/squid
EOF
```

### 2.4. Запуск

```bash
squid -k parse
squid -z
systemctl enable --now squid
systemctl status squid --no-pager
```

### 2.5. Файрвол (опционально, ufw)

Только с IP клиента:

```bash
ufw allow from BOT_IP to any port 3128 proto tcp
ufw deny 3128/tcp
ufw reload
```

Или открыть порт всем (хуже):

```bash
ufw allow 3128/tcp
ufw reload
```

---

## 3. Проверка с другой машины

Подставь IP прокси-сервера, логин и пароль:

```bash
curl -x http://PROXY_USER:PROXY_PASS@PROXY_IP:3128 -sS --max-time 10 https://ifconfig.me
echo
```

Должен вернуться **IP прокси-сервера**, не клиента.

HTTPS:

```bash
curl -x http://PROXY_USER:PROXY_PASS@PROXY_IP:3128 -sS --max-time 10 \
  -o /dev/null -w "%{http_code}\n" https://google.com
```

Ожидается `200` или `301`.

---

## 4. Строка подключения для приложений

```text
http://PROXY_USER:PROXY_PASS@PROXY_IP:3128
```

В `curl`:

```bash
curl -x http://PROXY_USER:PROXY_PASS@PROXY_IP:3128 URL
```

Схема к самому прокси — **`http://`**, даже если целевой сайт HTTPS.

---

## 5. Управление пользователями

Посмотреть логины (пароль в файле — хеш):

```bash
cat /etc/squid/passwords
```

Добавить пользователя:

```bash
htpasswd -b /etc/squid/passwords NEW_USER NEW_PASS
```

Сменить пароль:

```bash
htpasswd -b /etc/squid/passwords EXISTING_USER NEW_PASS
```

Применить:

```bash
squid -k parse && systemctl reload squid
```

---

## 6. Ограничить доступ по IP (если изначально не делали)

```bash
export BOT_IP="1.2.3.4"
nano /etc/squid/squid.conf
```

Перед `http_access allow authenticated` добавь:

```
acl allowed_client src BOT_IP
```

И замени строку доступа на:

```
http_access allow allowed_client authenticated
```

Проверка и перезагрузка:

```bash
squid -k parse
systemctl reload squid
```

---

## 7. Логи и диагностика

```bash
tail -f /var/log/squid/access.log
journalctl -u squid -f
```

После правки конфига:

```bash
squid -k parse
systemctl reload squid
# или при ошибках:
systemctl restart squid
```

---

## 8. Частые ошибки

| Симптом | Причина |
|---------|---------|
| `407 Proxy Authentication Required` | неверный логин/пароль |
| `Connection refused` на 3128 | squid не запущен или порт закрыт файрволом |
| HTTPS не идёт | нет `acl CONNECT` / `deny CONNECT !SSL_ports` или порядок `http_access` неверный |
| Таймаут | прокси-сервер без исходящего интернета или порт 3128 недоступен с клиента |

---

## 9. Безопасность

- Используй длинный пароль в `/etc/squid/passwords`.
- По возможности ограничь доступ **по IP** (`acl allowed_client`) и **ufw**.
- Не открывай 3128 в интернет без auth.
- Прокси — отдельный сервис; не путать с nginx reverse proxy на сайте бота.
