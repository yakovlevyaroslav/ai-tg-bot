export function getUserErrorMessage(err) {
  if (err?.code === 'INSUFFICIENT_CREDITS') {
    return (
      `Недостаточно кредитов.\n` +
      `Баланс: ${err.balance}, нужно: ${err.required}.\n\n` +
      `Нажмите ${'💰 Баланс'} или обратитесь к администратору для пополнения.`
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
