import { randomUUID } from 'node:crypto';
import { Agent, ProxyAgent, fetch as undiciFetch } from 'undici';
import { config } from '../config.js';

const API_URL = 'https://api.yookassa.ru/v3/payments';
const TIMEOUT_MS = Number(process.env.YOOKASSA_REQUEST_TIMEOUT_MS || 30000);

let cachedDispatcher = null;
function getDispatcher() {
  if (cachedDispatcher) return cachedDispatcher;

  if (config.yookassaProxy) {
    cachedDispatcher = new ProxyAgent({
      uri: config.yookassaProxy,
      connect: { family: 4, timeout: TIMEOUT_MS },
      bodyTimeout: TIMEOUT_MS,
      headersTimeout: TIMEOUT_MS,
    });
    console.log(
      `[yookassa] using proxy: ${config.yookassaProxy.replace(/\/\/[^@]+@/, '//***@')}`,
    );
  } else {
    cachedDispatcher = new Agent({
      connect: { family: 4, timeout: TIMEOUT_MS },
      bodyTimeout: TIMEOUT_MS,
      headersTimeout: TIMEOUT_MS,
    });
    console.log('[yookassa] direct connection (no proxy), forcing IPv4');
  }

  return cachedDispatcher;
}

function authHeader() {
  const token = Buffer.from(`${config.yookassaShopId}:${config.yookassaSecretKey}`).toString(
    'base64',
  );
  return `Basic ${token}`;
}

function buildReceipt(amountRub, description) {
  const amount = { value: Number(amountRub).toFixed(2), currency: 'RUB' };
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
    return await undiciFetch(url, { ...init, dispatcher: getDispatcher() });
  } catch (err) {
    const cause = err?.cause;
    const code = cause?.code || cause?.errno || err?.code;
    const via = config.yookassaProxy ? ' via proxy' : '';
    const where = `${new URL(url).host}${via}`;
    const message = code ? `network error (${code}) reaching ${where}` : (err?.message || 'fetch failed');
    const wrapped = new Error(message);
    wrapped.cause = cause || err;
    throw wrapped;
  }
}

export async function createPayment({ amountRub, description, metadata }) {
  const body = {
    amount: { value: Number(amountRub).toFixed(2), currency: 'RUB' },
    capture: true,
    confirmation: { type: 'redirect', return_url: config.yookassaReturnUrl },
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
