import { config } from '../../shared/config.js';

export async function complete(messages) {
  const system = messages.find((m) => m.role === 'system')?.content ?? '';
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  const question = lastUser?.content ?? '…';
  const roleHint = system.includes('таролог')
    ? '🔮 Таролог'
    : system.includes('нумеролог')
      ? '🔢 Нумеролог'
      : system.includes('родолог')
        ? '🌳 Родолог'
        : 'Специалист';

  const content =
    `[mock · ${config.aiProvider} · ${roleHint}]\n\n` +
    `Сейчас OpenAI не используется — режим разработки.\n\n` +
    `Ваш вопрос: «${question.slice(0, 500)}»\n\n` +
    `Когда подключите оплату API, поставьте AI_PROVIDER=openai в .env.`;

  return {
    content,
    usage: {
      prompt_tokens: Math.ceil(question.length / 4),
      completion_tokens: Math.ceil(content.length / 4),
    },
    model: 'mock',
  };
}
