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
