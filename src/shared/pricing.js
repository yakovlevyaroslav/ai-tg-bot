import { config } from './config.js';
import { formatQuestions } from './requests-format.js';

const PACKAGE_EMOJIS = ['💫', '✨', '🔮', '💎', '🌟'];
const PACKAGE_TITLES = ['Стартовый', 'Популярный', 'Глубокий', 'Премиум', 'Максимум'];

export function isAdminTelegramId(telegramId) {
  return config.adminTelegramIds.includes(Number(telegramId));
}

export function getTopupPackagesForUser(telegramId) {
  const packages = config.topupPackages.map(({ rub, requests }) => ({ rub, requests }));

  if (
    config.adminTopupPackage &&
    isAdminTelegramId(telegramId) &&
    !packages.some((p) => p.rub === config.adminTopupPackage.rub)
  ) {
    packages.unshift({ ...config.adminTopupPackage });
  }

  return packages;
}

export function resolveTopupPackage(rub, telegramId) {
  const amount = Number(rub);
  const pub = config.topupPackages.find((p) => p.rub === amount);
  if (pub) {
    return { rub: pub.rub, requests: pub.requests };
  }

  if (
    config.adminTopupPackage &&
    config.adminTopupPackage.rub === amount &&
    isAdminTelegramId(telegramId)
  ) {
    return { rub: config.adminTopupPackage.rub, requests: config.adminTopupPackage.requests };
  }

  return null;
}

/** @deprecated используйте resolveTopupPackage */
export function getRequestsForRub(rub) {
  const pkg = config.topupPackages.find((p) => p.rub === rub);
  return pkg?.requests ?? 0;
}

export function getTopupPackages() {
  return config.topupPackages.map(({ rub, requests }) => ({ rub, requests }));
}

export function getTopupRubAmounts(telegramId) {
  return getTopupPackagesForUser(telegramId).map((p) => p.rub);
}

function isAdminPackage(pkg) {
  return Boolean(config.adminTopupPackage && pkg.rub === config.adminTopupPackage.rub);
}

export function getPackagePresentation(pkg, publicIndex = 0) {
  if (isAdminPackage(pkg)) {
    return { emoji: '🛠', title: 'Тестовый' };
  }

  const index = Math.max(0, publicIndex);
  return {
    emoji: PACKAGE_EMOJIS[index % PACKAGE_EMOJIS.length],
    title: PACKAGE_TITLES[index % PACKAGE_TITLES.length],
  };
}

export function formatTariffPackageLine(pkg, publicIndex = 0) {
  const { emoji, title } = getPackagePresentation(pkg, publicIndex);
  return `${emoji} ${title} — ${pkg.rub} ₽ · ${formatQuestions(pkg.requests)}`;
}

export function formatTariffsMessage(telegramId = null) {
  const packages =
    telegramId != null ? getTopupPackagesForUser(telegramId) : config.topupPackages;

  const freeQuestions =
    config.welcomeBonusRequests > 0
      ? `🎁 Бесплатно при регистрации: ${formatQuestions(config.welcomeBonusRequests)}`
      : '🎁 Бесплатно при регистрации: 2 вопроса';

  let publicIndex = 0;
  const packageLines = packages.map((pkg) => {
    const line = formatTariffPackageLine(pkg, isAdminPackage(pkg) ? -1 : publicIndex);
    if (!isAdminPackage(pkg)) {
      publicIndex += 1;
    }
    return line;
  });

  return (
    '📋 Тарифы\n\n' +
    'Каждый ответ — один вопрос с учётом вашего кода личности.\n\n' +
    `${freeQuestions}\n\n` +
    'Пакеты вопросов:\n' +
    `${packageLines.join('\n')}\n\n` +
    'Выберите пакет ниже 👇'
  );
}

export function formatPackagesLine(telegramId = null) {
  const packages =
    telegramId != null ? getTopupPackagesForUser(telegramId) : config.topupPackages;

  return packages
    .map(({ rub, requests }) => `${rub} ₽ — ${formatQuestions(requests)}`)
    .join('\n');
}

export function formatPackagesInline(telegramId = null) {
  const packages =
    telegramId != null ? getTopupPackagesForUser(telegramId) : config.topupPackages;

  return packages
    .map(({ rub, requests }) => `${rub} ₽ → ${formatQuestions(requests)}`)
    .join(' · ');
}
