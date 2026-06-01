import { Markup } from 'telegraf';

export const BUTTONS = {
  START: '▶️ Старт',
  RESTART: '🔄 Рестарт',
  BALANCE: '💰 Баланс',
  TOPUP: '💳 Пополнить',
  SPECIALIST: '🧙 Специалист',
};

export const TOPUP_BACK = '◀️ Назад';

export function mainKeyboard() {
  return Markup.keyboard([
    [BUTTONS.SPECIALIST],
    [BUTTONS.START, BUTTONS.RESTART],
    [BUTTONS.BALANCE, BUTTONS.TOPUP],
  ])
    .resize()
    .persistent();
}
