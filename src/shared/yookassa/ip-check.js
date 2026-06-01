/** @see https://yookassa.ru/developers/using-api/webhooks#ip */
const ALLOWED_IPV4_PREFIXES = [
  '185.71.76.',
  '185.71.77.',
  '77.75.153.',
  '77.75.154.',
  '77.75.155.',
  '77.75.156.',
];

export function isYookassaIp(ip) {
  if (!ip) return false;
  const normalized = ip.replace(/^::ffff:/, '');
  return ALLOWED_IPV4_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}
