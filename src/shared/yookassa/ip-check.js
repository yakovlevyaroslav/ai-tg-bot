/** @see https://yookassa.ru/developers/using-api/webhooks#ip */
const ALLOWED_IPV4_CIDRS = [
  '185.71.76.0/27',
  '185.71.77.0/27',
  '77.75.153.0/25',
  '77.75.156.11/32',
  '77.75.156.35/32',
  '77.75.154.128/25',
];

const YOOKASSA_IPV6_PREFIX = '2a02:5180';

function parseIpv4(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => p < 0 || p > 255 || !Number.isInteger(p))) {
    return null;
  }
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function isIpv4InCidr(ip, cidr) {
  const [network, bitsStr] = cidr.split('/');
  const bits = Number(bitsStr);
  const ipNum = parseIpv4(ip);
  const netNum = parseIpv4(network);
  if (ipNum === null || netNum === null || !Number.isFinite(bits)) {
    return false;
  }
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipNum & mask) === (netNum & mask);
}

function isYookassaIpv6(ip) {
  const normalized = ip.toLowerCase();
  if (!normalized.includes(':')) {
    return false;
  }
  const parts = normalized.split(':').filter(Boolean);
  if (parts[0] === '2a02' && parts[1] === '5180') {
    return true;
  }
  return normalized.startsWith(`${YOOKASSA_IPV6_PREFIX}:`);
}

export function isYookassaIp(ip) {
  if (!ip) return false;

  const normalized = ip.replace(/^::ffff:/i, '');
  if (normalized.includes(':')) {
    return isYookassaIpv6(normalized);
  }

  return ALLOWED_IPV4_CIDRS.some((cidr) => isIpv4InCidr(normalized, cidr));
}
