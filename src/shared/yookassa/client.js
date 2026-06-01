import { randomUUID } from 'node:crypto';
import { ProxyAgent } from 'undici';
import { config } from '../config.js';

const API_URL = 'https://api.yookassa.ru/v3/payments';

let proxyDispatcher = null;
function getDispatcher() {
  if (!config.yookassaProxy) return undefined;
  if (!proxyDispatcher) {
    proxyDispatcher = new ProxyAgent(config.yookassaProxy);
    console.log(
      `[yookassa] using proxy: ${config.yookassaProxy.replace(/\/\/[^@]+@/, '//***@')}`,
    );
  }
  return proxyDispatcher;
}

function authHeader() {
  const token = Buffer.from(`${config.yookassaShopId}:${config.yookassaSecretKey}`).toString(
    'base64',
  );
  return `Basic ${token}`;
}

function buildReceipt(amountRub, description) {
  const amount = {
    value: Number(amountRub).toFixed(2),
    currency: 'RUB',
  };

  return {
    customer: { email: config.yookassaReceiptEmail.trim() },
    items: [
      {
        description: description.slice(0, 128),
        quantity: '1.00',
        amount,
        vat_code: config.yookassaVatCode,
        payment_mode: 'full_payment',
        payment_subject: 'service',
      },
    ],
  };
}

async function yookassaFetch(url, init = {}) {
  try {
    return await fetch(url, { ...init, dispatcher: getDispatcher() });
  } catch (err) {
    // undici оборачивает сетевые ошибки в `fetch failed`, реальная причина в cause
    const cause = err?.cause;
    const code = cause?.code || cause?.errno;
    const msg = code
      ? `network error (${code}) reaching ${new URL(url).host}${
          config.yookassaProxy ? ' via proxy' : ''
        }`
      : err?.message || 'fetch failed';
    const wrapped = new Error(msg);
    wrapped.cause = cause;
    throw wrapped;
  }
}

export async function createPayment({ amountRub, description, metadata }) {
  const body = {
    amount: {
      value: Number(amountRub).toFixed(2),
      currency: 'RUB',
    },
    capture: true,
    confirmation: {
      type: 'redirect',
      return_url: config.yookassaReturnUrl,
    },
    description,
    metadata,
  };

  if (config.yookassaSendReceipt) {
    body.receipt = buildReceipt(amountRub, description);
  }

  const response = await yookassaFetch(API_URL, {
    method: 'POST',
    headers: {
      Authorization: authHeader(),
      'Content-Type': 'application/json',
      'Idempotence-Key': randomUUID(),
    },
    body: JSON.stringify(body),
  });

  const data = await response.json();

  if (!response.ok) {
    const message = data?.description || data?.type || response.statusText;
    throw new Error(`YooKassa error: ${message}`);
  }

  return data;
}

export async function getPayment(paymentId) {
  const response = await yookassaFetch(`${API_URL}/${paymentId}`, {
    headers: { Authorization: authHeader() },
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.description || 'YooKassa get payment failed');
  }
  return data;
}
