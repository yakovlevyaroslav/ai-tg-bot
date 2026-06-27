/** Склонение «вопрос / вопроса / вопросов» */
export function pluralQuestions(n) {
  const abs = Math.abs(Number(n));
  const mod10 = abs % 10;
  const mod100 = abs % 100;

  if (mod100 >= 11 && mod100 <= 14) {
    return 'вопросов';
  }
  if (mod10 === 1) {
    return 'вопрос';
  }
  if (mod10 >= 2 && mod10 <= 4) {
    return 'вопроса';
  }
  return 'вопросов';
}

export function formatQuestions(n) {
  return `${Number(n)} ${pluralQuestions(n)}`;
}

/** Префикс строк о изменении баланса (списание / начисление) */
export const BALANCE_CHANGE_PREFIX = '✨';

export function formatBalanceRemaining(balance) {
  return `${BALANCE_CHANGE_PREFIX} Осталось: ${formatQuestions(balance)}`;
}

export function formatBalanceCredit(amount) {
  return `${BALANCE_CHANGE_PREFIX} +${formatQuestions(amount)}`;
}

export function formatBalanceDeduction(charged, balanceAfter) {
  return `${BALANCE_CHANGE_PREFIX} −${formatQuestions(charged)} · осталось: ${formatQuestions(balanceAfter)}`;
}

/** Подпись под ответом бота или в сообщении об ошибке */
export function formatBalanceChangeFooter(balanceAfter, charged = null) {
  const line =
    charged !== null
      ? formatBalanceDeduction(charged, balanceAfter)
      : formatBalanceRemaining(balanceAfter);
  return `\n\n${line}`;
}

/** @deprecated используйте formatQuestions */
export function formatTokens(n) {
  return formatQuestions(n);
}

/** @deprecated используйте pluralQuestions */
export function pluralTokens(n) {
  return pluralQuestions(n);
}

/** @deprecated используйте formatQuestions */
export function formatRequests(n) {
  return formatQuestions(n);
}

/** @deprecated используйте pluralQuestions */
export function pluralRequests(n) {
  return pluralQuestions(n);
}
