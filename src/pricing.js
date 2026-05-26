import { config } from './config.js';

/** 100 ₽ → 1000 кредитов при CREDITS_PER_RUB=10 */
export function creditsFromRub(rub) {
  return Math.floor(rub * config.creditsPerRub);
}

export function rubFromCredits(credits) {
  return credits / config.creditsPerRub;
}

export function formatRateLine() {
  const creditsPer100 = creditsFromRub(100);
  return `100 ₽ = ${creditsPer100} кредитов (${config.creditsPerRub} кредитов за 1 ₽)`;
}

export function getTopupPackages() {
  return config.topupPackagesRub.map((rub) => ({
    rub,
    credits: creditsFromRub(rub),
  }));
}
