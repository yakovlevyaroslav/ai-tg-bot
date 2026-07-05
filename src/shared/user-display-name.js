export const DEFAULT_USER_DISPLAY_NAME = 'Уважаемый пользователь';

/** Имя из онбординга (если пройден), иначе first_name из Telegram, иначе дефолт */
export function resolveUserDisplayName(user = {}) {
  if (user.onboarding_completed) {
    const onboardingName = String(user.onboarding_data?.name ?? '').trim();
    if (onboardingName) {
      return onboardingName;
    }
  }

  const telegramName = String(user.first_name ?? '').trim();
  if (telegramName) {
    return telegramName;
  }

  return DEFAULT_USER_DISPLAY_NAME;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Подставляет {name} в текст рассылки или сообщения бота */
export function applyUserMessagePlaceholders(text, user = {}, { html = false } = {}) {
  const name = resolveUserDisplayName(user);
  const value = html ? escapeHtml(name) : name;
  return String(text ?? '').replace(/\{name\}/g, value);
}
