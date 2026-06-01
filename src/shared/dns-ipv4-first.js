import dns from 'node:dns';

// На VPS curl часто идёт по IPv4, Node — по IPv6 → таймаут к Telegram API
dns.setDefaultResultOrder('ipv4first');
