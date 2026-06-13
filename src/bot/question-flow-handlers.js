import * as db from '../shared/db.js';
import {
  buildQuestionConfirmMessage,
  buildFinalQuestionPrompt,
  questionConfirmInlineKeyboard,
  QUESTION_ADDON_TEXT,
  QUESTION_CHANGE_TEXT,
  CUSTOM_QUESTION_TEXT,
  isQuestionFlowActive,
} from './question-flow.js';
import { customQuestionInlineKeyboard, questionsMenuInlineKeyboard } from './keyboards.js';

export { isQuestionFlowActive };

export async function beginCustomQuestion(ctx, userId) {
  await db.setOnboardingStep(userId, 'custom_question', { pending_question: null });
  await ctx.reply(CUSTOM_QUESTION_TEXT, customQuestionInlineKeyboard());
}

export async function startPendingQuestion(ctx, userId, basePrompt) {
  const pending = {
    base_prompt: basePrompt,
    additions: [],
  };

  await db.setOnboardingStep(userId, 'question_confirm', {
    pending_question: pending,
  });

  await ctx.reply(
    buildQuestionConfirmMessage(pending),
    questionConfirmInlineKeyboard(),
  );
}

export async function sendQuestionConfirmPrompt(ctx, userId) {
  const profile = await db.getUserProfile(userId);
  const pending = profile?.onboarding_data?.pending_question;

  if (!pending?.base_prompt) {
    await ctx.reply('Вопрос не найден. Выберите вопрос заново.');
    return;
  }

  await ctx.reply(
    buildQuestionConfirmMessage(pending),
    questionConfirmInlineKeyboard(),
  );
}

export async function beginQuestionChange(ctx, userId) {
  const profile = await db.getUserProfile(userId);
  if (profile?.onboarding_step !== 'question_confirm') {
    await ctx.answerCbQuery?.('Сначала выберите вопрос');
    return false;
  }

  await db.setOnboardingStep(userId, 'completed', { pending_question: null });
  await ctx.reply(QUESTION_CHANGE_TEXT, questionsMenuInlineKeyboard());
  return true;
}

export async function beginQuestionAddon(ctx, userId) {
  const profile = await db.getUserProfile(userId);
  if (profile?.onboarding_step !== 'question_confirm') {
    await ctx.answerCbQuery?.('Сначала выберите вопрос');
    return false;
  }

  await db.setOnboardingStep(userId, 'question_addon');
  await ctx.reply(QUESTION_ADDON_TEXT);
  return true;
}

export async function handleQuestionAddonText(ctx, userId, text) {
  const profile = await db.getUserProfile(userId);
  const pending = profile?.onboarding_data?.pending_question;

  if (!pending?.base_prompt) {
    await db.setOnboardingStep(userId, 'completed', { pending_question: null });
    await ctx.reply('Вопрос устарел. Выберите вопрос заново.');
    return true;
  }

  const additions = [...(pending.additions || []), text.trim()].filter(Boolean);

  await db.setOnboardingStep(userId, 'question_confirm', {
    pending_question: {
      ...pending,
      additions,
    },
  });

  await sendQuestionConfirmPrompt(ctx, userId);
  return true;
}

export async function finalizePendingQuestion(userId) {
  const profile = await db.getUserProfile(userId);
  const pending = profile?.onboarding_data?.pending_question;

  if (!pending?.base_prompt) {
    return null;
  }

  const prompt = buildFinalQuestionPrompt(pending);

  await db.setOnboardingStep(userId, 'completed', {
    pending_question: null,
  });

  return prompt;
}

export async function handleQuestionConfirmReminder(ctx) {
  await ctx.reply(
    'Можете добавить уточнение, поменять вопрос или получить ответ — выберите кнопку ниже.',
    questionConfirmInlineKeyboard(),
  );
}
