import { config } from '../../shared/config.js';

function isPersonalityCodeRequest(messages) {
  const system = messages.find((m) => m.role === 'system')?.content ?? '';
  return system.includes('системы «Код личности»');
}

function isConclusionRequest(messages) {
  const system = messages.find((m) => m.role === 'system')?.content ?? '';
  return system.includes('ТОЛЬКО финальный блок «Общий вывод»');
}

function extractCode(system, label, fallback) {
  const match = system.match(new RegExp(`${label}.*?:\\s*(\\d{2})`));
  return match?.[1] ?? fallback;
}

function buildMockPersonalityCode(system) {
  const fullCode = system.match(/Полный код личности:\s*(\d+)/)?.[1] ?? '4523184765';
  const astrology = extractCode(system, 'Код астрологии', fullCode.slice(0, 2));
  const humanDesign = extractCode(system, 'Код Human Design', fullCode.slice(2, 4));
  const numerology = extractCode(system, 'Нумерологическое число', fullCode.slice(4, 6));
  const sucai = extractCode(system, 'Код Сюцай', fullCode.slice(6, 8));
  const jyotish = extractCode(system, 'Код ведической астрологии', fullCode.slice(8, 10));

  return (
    `✨ <b>Твой Код личности № ${fullCode}</b>\n\n` +
    `Код собран из пяти направлений: астрология <b>${astrology}</b>, Human Design <b>${humanDesign}</b>, ` +
    `нумерология <b>${numerology}</b>, Сюцай <b>${sucai}</b>, ведическая астрология (Джойтиш) <b>${jyotish}</b>.\n\n` +
    `🌙 <b>1. Астрология — ${astrology}</b>\n` +
    `В тебе сочетаются яркая воля и чувствительность к ритму жизни. Ты умеешь чувствовать момент, ` +
    `когда пора действовать, и не торопишь события раньше времени.\n\n` +
    `💫 <b>2. Human Design — ${humanDesign}</b>\n` +
    `Твоя стратегия — сначала откликнуться внутренним «да», потом включаться в процесс. ` +
    `Когда идёшь в согласии с собой, энергия держится дольше и решения получаются точнее.\n\n` +
    `🔢 <b>3. Нумерология — ${numerology}</b>\n` +
    `Числовое ядро даёт тебе сочетание интуиции и практичности. ` +
    `Тебе важно чувствовать смысл в том, что делаешь, иначе энергия уходит в сомнения.\n\n` +
    `🌿 <b>4. Сюцай — ${sucai}</b>\n` +
    `По Сюцай в тебе заложен потенциал собирать ресурсы и превращать идеи в устойчивый результат. ` +
    `Главное — не распыляться и держать баланс между действием и восстановлением.\n\n` +
    `✨ <b>5. Ведическая астрология (Джойтиш) — ${jyotish}</b>\n` +
    `Ведический взгляд показывает кармический вектор служения своему пути. ` +
    `Сила проявляется, когда ты опираешься на внутреннюю правду, а не на чужие ожидания.\n\n` +
    `📌 <b>Коротко: сильные и слабые стороны</b>\n` +
    `Сила — сочетание чуткости и стратегии; зона роста — не растворяться в чужих задачах.\n\n` +
    `[mock · ${config.aiProvider}]`
  );
}

function buildMockConclusion() {
  return (
    `💡 <b>Общий вывод</b>\n\n` +
    `1. 🎯 <b>Жизненная миссия / предназначение</b>\n\n` +
    `Ты идёшь путём, где важно соединять смысл и действие. Когда выбор совпадает с внутренней правдой, энергия удерживается дольше.\n\n` +
    `2. ⚡ <b>Вызовы / внутренние противоречия</b>\n\n` +
    `Главное напряжение — между желанием поддержать других и потребностью беречь свой ресурс. Баланс здесь решает почти всё.\n\n` +
    `3. ❤️ <b>Отношения / совместимость</b>\n\n` +
    `В союзе тебе нужны доверие и общее направление, а не идеальная картинка. С тем, кто уважает границы, ты раскрываешься мягче и глубже.\n\n` +
    `4. 💰 <b>Деньги / профессиональная реализация</b>\n\n` +
    `Деньги приходят устойчивее там, где ты соединяешь анализ, влияние на людей и живой смысл. Роли наставника, консультанта, стратегии — твой коридор.\n\n` +
    `5. ✨ <b>Скрытые таланты</b>\n\n` +
    `Ты быстро считываешь суть ситуации и умеешь собирать из хаоса понятный вектор. Этот талант усиливается, когда ты не торопишь решение раньше внутреннего «да».\n\n` +
    `🪞 <b>Как я тебя вижу</b>\n\n` +
    `Я вижу человека, который многое держит внутри и часто откладывает прямой разговор с собой о том, чего реально хочет. ` +
    `Слепая зона — привычка сглаживать напряжение вместо того, чтобы назвать его вслух: стоит копнуть, где именно ты сейчас себя приглушаешь.\n\n` +
    `❓ <b>Мне интересно:</b>\n` +
    `о какой сфере ты хочешь узнать подробнее — про отношения, предназначение, деньги или внутреннее состояние и эмоции?\n\n` +
    `[mock · ${config.aiProvider}]`
  );
}

export async function complete(messages) {
  const system = messages.find((m) => m.role === 'system')?.content ?? '';
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  const question = lastUser?.content ?? '…';

  if (isConclusionRequest(messages)) {
    const content = buildMockConclusion();
    return {
      content,
      usage: {
        prompt_tokens: Math.ceil(system.length / 4),
        completion_tokens: Math.ceil(content.length / 4),
      },
      model: 'mock',
    };
  }

  if (isPersonalityCodeRequest(messages)) {
    const content = buildMockPersonalityCode(system);
    return {
      content,
      usage: {
        prompt_tokens: Math.ceil(system.length / 4),
        completion_tokens: Math.ceil(content.length / 4),
      },
      model: 'mock',
    };
  }

  const content =
    `[mock · ${config.aiProvider} · Код личности]\n\n` +
    `✨ Сейчас OpenAI не используется — режим разработки.\n\n` +
    `Ваш вопрос: «${question.slice(0, 500)}»\n\n` +
    `💡 <b>Заглушка:</b> когда подключите API, поставьте AI_PROVIDER=openai в .env — ответы придут с оформлением.`;

  return {
    content,
    usage: {
      prompt_tokens: Math.ceil(question.length / 4),
      completion_tokens: Math.ceil(content.length / 4),
    },
    model: 'mock',
  };
}
