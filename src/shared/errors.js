import { formatQuestions } from './requests-format.js';

export function getUserErrorMessage(err) {
  if (err?.code === 'PERSONALITY_CODE_CONFLICT') {
    return (
      'Такой код личности уже зарегистрирован в системе.\n\n' +
      'Если вы считаете, что это ошибка — напишите в поддержку.'
    );
  }

  if (err?.code === 'INSUFFICIENT_CREDITS') {
    return (
      `Недостаточно вопросов.\n` +
      `Осталось: ${formatQuestions(err.balance)}, нужно: ${formatQuestions(err.required)}.\n\n` +
      'Пополните баланс — нажмите «Тарифы» ниже.'
    );
  }

  const code = err?.code ?? err?.error?.code;

  if (code === 'insufficient_quota') {
    return (
      'На аккаунте OpenAI закончилась квота или не подключена оплата.\n\n' +
      'Проверьте баланс: https://platform.openai.com/account/billing\n' +
      'После пополнения перезапустите бота и напишите снова.'
    );
  }

  if (err?.status === 401 || code === 'invalid_api_key') {
    return 'Неверный OPENAI_API_KEY. Создайте новый ключ и обновите .env';
  }

  if (err?.status === 429 && code !== 'insufficient_quota') {
    return 'Слишком много запросов к OpenAI. Подождите минуту и попробуйте снова.';
  }

  if (err?.status === 403) {
    return 'Доступ к OpenAI API запрещён для этого ключа или региона.';
  }

  return 'Не удалось получить ответ. Попробуйте позже.';
}
