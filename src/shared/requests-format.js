/** Склонение «токен / токена / токенов» */
export function pluralTokens(n) {
  const abs = Math.abs(Number(n));
  const mod10 = abs % 10;
  const mod100 = abs % 100;

  if (mod100 >= 11 && mod100 <= 14) {
    return 'токенов';
  }
  if (mod10 === 1) {
    return 'токен';
  }
  if (mod10 >= 2 && mod10 <= 4) {
    return 'токена';
  }
  return 'токенов';
}

export function formatTokens(n) {
  return `${Number(n)} ${pluralTokens(n)}`;
}

/** Склонение «вопрос / вопроса / вопросов» — для счётчика заданных вопросов */
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

/** @deprecated используйте formatTokens */
export function formatRequests(n) {
  return formatTokens(n);
}

/** @deprecated используйте pluralTokens */
export function pluralRequests(n) {
  return pluralTokens(n);
}
