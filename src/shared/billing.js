import { config } from './config.js';
import { withTransaction } from './db.js';

export class InsufficientCreditsError extends Error {
  constructor(balance, required) {
    super(`Insufficient credits: have ${balance}, need ${required}`);
    this.code = 'INSUFFICIENT_CREDITS';
    this.balance = balance;
    this.required = required;
  }
}

async function ensureBalanceRow(client, userId) {
  await client.query(
    `INSERT INTO balances (user_id, credits) VALUES ($1, 0) ON CONFLICT (user_id) DO NOTHING`,
    [userId],
  );
}

export function estimateMessageCost() {
  return config.creditsPerMessage;
}

export async function getBalance(userId) {
  const { rows } = await withTransaction(async (client) => {
    await ensureBalanceRow(client, userId);
    return client.query(`SELECT credits FROM balances WHERE user_id = $1`, [userId]);
  });
  return Number(rows[0]?.credits ?? 0);
}

export async function charge(userId, amount, meta = {}) {
  if (amount <= 0) {
    throw new Error('Charge amount must be positive');
  }

  return withTransaction(async (client) => {
    await ensureBalanceRow(client, userId);

    const { rows } = await client.query(
      `SELECT credits FROM balances WHERE user_id = $1 FOR UPDATE`,
      [userId],
    );
    const balance = Number(rows[0].credits);

    if (balance < amount) {
      throw new InsufficientCreditsError(balance, amount);
    }

    const { rows: txRows } = await client.query(
      `INSERT INTO token_transactions (user_id, amount, type, meta)
       VALUES ($1, $2, 'spend', $3)
       RETURNING id`,
      [userId, -amount, JSON.stringify(meta)],
    );

    await client.query(
      `UPDATE balances SET credits = credits - $1, updated_at = NOW() WHERE user_id = $2`,
      [amount, userId],
    );

    return { transactionId: txRows[0].id, balanceAfter: balance - amount };
  });
}

export async function refund(userId, amount, spendTransactionId, meta = {}) {
  if (amount <= 0) {
    throw new Error('Refund amount must be positive');
  }

  return withTransaction(async (client) => {
    await ensureBalanceRow(client, userId);

    const idempotencyKey = spendTransactionId
      ? `refund:spend:${spendTransactionId}`
      : null;

    if (idempotencyKey) {
      const existing = await client.query(
        `SELECT id FROM token_transactions WHERE idempotency_key = $1`,
        [idempotencyKey],
      );
      if (existing.rows.length > 0) {
        const balance = await client.query(
          `SELECT credits FROM balances WHERE user_id = $1`,
          [userId],
        );
        return {
          transactionId: existing.rows[0].id,
          balanceAfter: Number(balance.rows[0].credits),
          alreadyRefunded: true,
        };
      }
    }

    const { rows: txRows } = await client.query(
      `INSERT INTO token_transactions (user_id, amount, type, idempotency_key, meta)
       VALUES ($1, $2, 'refund', $3, $4)
       RETURNING id`,
      [
        userId,
        amount,
        idempotencyKey,
        JSON.stringify({ ...meta, spendTransactionId }),
      ],
    );

    const { rows } = await client.query(
      `UPDATE balances
       SET credits = credits + $1, updated_at = NOW()
       WHERE user_id = $2
       RETURNING credits`,
      [amount, userId],
    );

    return {
      transactionId: txRows[0].id,
      balanceAfter: Number(rows[0].credits),
      alreadyRefunded: false,
    };
  });
}

export async function grant(userId, amount, type = 'grant', meta = {}, idempotencyKey = null) {
  if (amount <= 0) {
    throw new Error('Grant amount must be positive');
  }

  return withTransaction(async (client) => {
    await ensureBalanceRow(client, userId);

    if (idempotencyKey) {
      const existing = await client.query(
        `SELECT id FROM token_transactions WHERE idempotency_key = $1`,
        [idempotencyKey],
      );
      if (existing.rows.length > 0) {
        const balance = await client.query(
          `SELECT credits FROM balances WHERE user_id = $1`,
          [userId],
        );
        return {
          transactionId: existing.rows[0].id,
          balanceAfter: Number(balance.rows[0].credits),
          alreadyGranted: true,
        };
      }
    }

    const { rows: txRows } = await client.query(
      `INSERT INTO token_transactions (user_id, amount, type, idempotency_key, meta)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [userId, amount, type, idempotencyKey, JSON.stringify(meta)],
    );

    const { rows } = await client.query(
      `UPDATE balances
       SET credits = credits + $1, updated_at = NOW()
       WHERE user_id = $2
       RETURNING credits`,
      [amount, userId],
    );

    return {
      transactionId: txRows[0].id,
      balanceAfter: Number(rows[0].credits),
      alreadyGranted: false,
    };
  });
}

export async function grantWelcomeBonus(userId) {
  if (config.welcomeBonusCredits <= 0) {
    return { granted: false, amount: 0 };
  }

  return withTransaction(async (client) => {
    const { rows: userRows } = await client.query(
      `SELECT welcome_bonus_granted FROM users WHERE id = $1 FOR UPDATE`,
      [userId],
    );

    if (!userRows.length || userRows[0].welcome_bonus_granted) {
      const balance = await getBalanceInTx(client, userId);
      return { granted: false, amount: 0, balanceAfter: balance };
    }

    await client.query(
      `UPDATE users SET welcome_bonus_granted = TRUE WHERE id = $1`,
      [userId],
    );

    await ensureBalanceRow(client, userId);

    const idempotencyKey = `welcome_bonus:${userId}`;
    const existing = await client.query(
      `SELECT id FROM token_transactions WHERE idempotency_key = $1`,
      [idempotencyKey],
    );

    if (existing.rows.length > 0) {
      const balance = await getBalanceInTx(client, userId);
      return { granted: false, amount: 0, balanceAfter: balance };
    }

    await client.query(
      `INSERT INTO token_transactions (user_id, amount, type, idempotency_key, meta)
       VALUES ($1, $2, 'bonus', $3, $4)`,
      [
        userId,
        config.welcomeBonusCredits,
        idempotencyKey,
        JSON.stringify({ reason: 'welcome' }),
      ],
    );

    const { rows } = await client.query(
      `UPDATE balances
       SET credits = credits + $1, updated_at = NOW()
       WHERE user_id = $2
       RETURNING credits`,
      [config.welcomeBonusCredits, userId],
    );

    return {
      granted: true,
      amount: config.welcomeBonusCredits,
      balanceAfter: Number(rows[0].credits),
    };
  });
}

async function getBalanceInTx(client, userId) {
  await ensureBalanceRow(client, userId);
  const { rows } = await client.query(
    `SELECT credits FROM balances WHERE user_id = $1`,
    [userId],
  );
  return Number(rows[0]?.credits ?? 0);
}

export async function recordUsage(userId, { transactionId, promptTokens, completionTokens, creditsCharged, model }) {
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO usage_events
        (user_id, transaction_id, prompt_tokens, completion_tokens, credits_charged, model)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        userId,
        transactionId ?? null,
        promptTokens ?? 0,
        completionTokens ?? 0,
        creditsCharged,
        model ?? null,
      ],
    );
  });
}
