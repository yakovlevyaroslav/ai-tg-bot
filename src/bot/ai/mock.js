import { config } from '../../shared/config.js';

function isPersonalityCodeRequest(messages) {
  const system = messages.find((m) => m.role === 'system')?.content ?? '';
  return system.includes('системы «Код личности»');
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
    `Твой Код личности № ${fullCode}\n\n` +
    `Код собран из пяти направлений: астрология ${astrology}, Human Design ${humanDesign}, ` +
    `нумерология ${numerology}, Сюцай ${sucai}, ведическая астрология (Джойтиш) ${jyotish}.\n\n` +
    `1. Астрология — ${astrology}\n` +
    `В тебе сочетаются яркая воля и чувствительность к ритму жизни. Ты умеешь чувствовать момент, ` +
    `когда пора действовать, и не торопишь события раньше времени.\n\n` +
    `2. Human Design — ${humanDesign}\n` +
    `Твоя стратегия — сначала откликнуться внутренним «да», потом включаться в процесс. ` +
    `Когда идёшь в согласии с собой, энергия держится дольше и решения получаются точнее.\n\n` +
    `3. Нумерология — ${numerology}\n` +
    `Числовое ядро даёт тебе сочетание интуиции и практичности. ` +
    `Тебе важно чувствовать смысл в том, что делаешь, иначе энергия уходит в сомнения.\n\n` +
    `4. Сюцай — ${sucai}\n` +
    `По Сюцай в тебе заложен потенциал собирать ресурсы и превращать идеи в устойчивый результат. ` +
    `Главное — не распыляться и держать баланс между действием и восстановлением.\n\n` +
    `5. Ведическая астрология (Джойтиш) — ${jyotish}\n` +
    `Ведический взгляд показывает кармический вектор служения своему пути. ` +
    `Сила проявляется, когда ты опираешься на внутреннюю правду, а не на чужие ожидания.\n\n` +
    `Основной вывод о тебе как о человеке:\n` +
    `Ты человек с внутренней глубиной и редкой способностью видеть суть ситуации, а не только поверхность. ` +
    `Тебе не чужды амбиции, но они всегда связаны с желанием жить честно по отношению к себе.\n\n` +
    `В сильных сторонах — чувствительность, стратегичность, умение восстанавливаться после кризисов. ` +
    `Ты умеешь быть мягким, но в ключевые моменты проявляешь твёрдость, когда речь о ценностях.\n\n` +
    `Зона роста — не брать на себя слишком много чужой ответственности. ` +
    `Когда ты пытаешься «спасти» всех вокруг, теряется твой собственный вектор.\n\n` +
    `В любви тебе нужен партнёр, с которым можно расти: не идеальная картинка, а живой союз, ` +
    `где есть доверие, уважение к границам и общее чувство направления.\n\n` +
    `В работе тебе подходят роли, где важны анализ, смысл и влияние на людей: консультирование, ` +
    `творчество, управление проектами, наставничество, всё, где ты соединяешь идею и практику.\n\n` +
    `Твой жизненный вектор — раскрывать свой код через честность с собой и постепенное усиление того, ` +
    `что уже работает. Ближайший совет: выбери одну сферу, где давно чувствуешь зов, и сделай в ней ` +
    `первый конкретный шаг в течение 7 дней.\n\n` +
    `[mock · ${config.aiProvider}]`
  );
}

export async function complete(messages) {
  const system = messages.find((m) => m.role === 'system')?.content ?? '';
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  const question = lastUser?.content ?? '…';

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
    `Сейчас OpenAI не используется — режим разработки.\n\n` +
    `Ваш вопрос: «${question.slice(0, 500)}»\n\n` +
    `Когда подключите API, поставьте AI_PROVIDER=openai в .env.`;

  return {
    content,
    usage: {
      prompt_tokens: Math.ceil(question.length / 4),
      completion_tokens: Math.ceil(content.length / 4),
    },
    model: 'mock',
  };
}
