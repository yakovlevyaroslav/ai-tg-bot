import { getPool } from './db.js';

export const EVENTS = {
  BOT_START: 'bot.start',
  BOT_RESTART: 'bot.restart',
  ONBOARDING_STEP: 'onboarding.step',
  ONBOARDING_COMPLETED: 'onboarding.completed',
  ONBOARDING_CONFIRM: 'onboarding.confirm',
  PERSONALITY_CODE_GENERATED: 'personality_code.generated',
  PERSONALITY_CODE_FAILED: 'personality_code.failed',
  QUESTION_ASKED: 'question.asked',
  QUESTION_ANSWERED: 'question.answered',
  QUESTION_INSUFFICIENT_BALANCE: 'question.insufficient_balance',
  TARIFFS_OPENED: 'tariffs.opened',
  PAYMENT_PACKAGE_SELECTED: 'payment.package_selected',
  PAYMENT_CREATED: 'payment.created',
  PAYMENT_COMPLETED: 'payment.completed',
  VISIT_CARD_OPENED: 'visit_card.opened',
  VISIT_CARD_BUY_CLICKED: 'visit_card.buy_clicked',
  VISIT_CARD_PUBLISHED: 'visit_card.published',
  FOLLOWUP_CONTINUE: 'followup.continue',
  FOLLOWUP_NEW: 'followup.new',
  IDLE_NUDGE_SENT: 'idle_nudge.sent',
  IDLE_NUDGE_TOPIC: 'idle_nudge.topic',
};

/** Fire-and-forget: не блокирует бота при ошибке записи */
export function trackEvent(userId, eventName, meta = {}, step = null) {
  if (!userId || !eventName) {
    return;
  }

  const payload =
    meta && typeof meta === 'object' && !Array.isArray(meta) ? meta : { value: meta };

  getPool()
    .query(
      `INSERT INTO analytics_events (user_id, event_name, step, meta)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [userId, eventName, step, JSON.stringify(payload)],
    )
    .catch((err) => {
      console.warn('[analytics] track failed:', err?.message ?? err);
    });
}

export function trackOnboardingStep(userId, step) {
  trackEvent(userId, EVENTS.ONBOARDING_STEP, {}, step);

  if (step === 'completed') {
    trackEvent(userId, EVENTS.ONBOARDING_COMPLETED);
  }
}
