import { config } from '../../shared/config.js';
import {
  BROADCAST_MAX_RECIPIENTS,
  BROADCAST_SORT_OPTIONS,
  ONBOARDING_STEP_OPTIONS,
  AUDIENCE_STAGE_OPTIONS,
  parseAudienceFilters,
} from './broadcast-queries.js';
import {
  isLocalPhotoRef,
  resolveAdminPhotoPreviewUrl,
  resolveCampaignPhotoPreviewUrl,
} from '../../shared/broadcast/media.js';
import { BROADCAST_MEDIA_MAX_BYTES } from './broadcast-media.js';
import { esc, formatDate, exportFilterSection, userLabel } from './html.js';

const STATUS_LABELS = {
  draft: 'Черновик',
  queued: 'В очереди',
  running: 'Отправляется',
  paused: 'Пауза',
  completed: 'Завершена',
  cancelled: 'Отменена',
};

function exportSelect(name, options, current = '') {
  return `<select name="${name}" class="export-select">
    ${options
      .map(({ value, label }) => {
        const selected = String(current) === String(value) ? ' selected' : '';
        return `<option value="${esc(value)}"${selected}>${esc(label)}</option>`;
      })
      .join('')}
  </select>`;
}

function exportPeriodOptions(current) {
  return [
    { value: 7, label: '7 дней' },
    { value: 30, label: '30 дней' },
    { value: 90, label: '90 дней' },
    { value: 0, label: 'Всё время' },
  ]
    .map(({ value, label }) => {
      const selected = Number(current) === value ? ' selected' : '';
      return `<option value="${value}"${selected}>${label}</option>`;
    })
    .join('');
}

function audienceFilterFields(filters) {
  const stepOptions = [
    { value: '', label: 'Любой шаг' },
    ...ONBOARDING_STEP_OPTIONS.map(({ value, label }) => ({ value, label })),
  ];
  const stepDisabled = filters.audienceStage !== 'in_progress';

  return `
    ${exportFilterSection(
      'Период регистрации',
      `
      <label class="export-field">
        <span>Период</span>
        <select name="period" class="export-select">${exportPeriodOptions(filters.days ?? 30)}</select>
      </label>
      <label class="export-field">
        <span>Дата с</span>
        <input type="date" name="date_from" value="${esc(filters.dateFrom ?? '')}">
      </label>
      <label class="export-field">
        <span>Дата по</span>
        <input type="date" name="date_to" value="${esc(filters.dateTo ?? '')}">
      </label>
    `,
    )}
    ${exportFilterSection(
      'Профиль и анкета',
      `
      <label class="export-field export-field-wide">
        <span>Поиск</span>
        <input type="search" name="search" value="${esc(filters.search)}" placeholder="ID, telegram, имя, код…">
      </label>
      <label class="export-field">
        <span>Статус пользователя</span>
        <select name="audience_stage" id="audience-stage" class="export-select">${AUDIENCE_STAGE_OPTIONS.map(({ value, label }) => {
          const selected = String(filters.audienceStage) === String(value) ? ' selected' : '';
          return `<option value="${esc(value)}"${selected}>${esc(label)}</option>`;
        }).join('')}</select>
      </label>
      <label class="export-field${stepDisabled ? ' export-field-disabled' : ''}" id="onboarding-step-field">
        <span>Шаг анкеты</span>
        <select name="onboarding_step" id="onboarding-step-select" class="export-select"${stepDisabled ? ' disabled' : ''}>${stepOptions
          .map(({ value, label }) => {
            const selected = String(filters.onboardingStep) === String(value) ? ' selected' : '';
            return `<option value="${esc(value)}"${selected}>${esc(label)}</option>`;
          })
          .join('')}</select>
      </label>
      <label class="export-field">
        <span>Пол</span>
        ${exportSelect('gender', [
          { value: '', label: 'Любой' },
          { value: 'male', label: 'Мужской' },
          { value: 'female', label: 'Женский' },
        ], filters.gender)}
      </label>
    `,
    )}
    ${exportFilterSection(
      'Источник (?start=)',
      `
      <label class="export-field">
        <span>Метка ?start=</span>
        <input type="search" name="start_payload" value="${esc(filters.startPayload)}" placeholder="vk_march…">
      </label>
      <label class="export-field">
        <span>Есть метку</span>
        ${exportSelect('has_start_payload', [
          { value: '', label: 'Все' },
          { value: 'yes', label: 'Да (любая из истории)' },
          { value: 'no', label: 'Нет (органика)' },
        ], filters.hasStartPayload)}
      </label>
    `,
    )}
    ${exportFilterSection(
      'Баланс и активность',
      `
      <label class="export-field">
        <span>Стартовый бонус</span>
        ${exportSelect('welcome_bonus', [
          { value: '', label: 'Все' },
          { value: 'yes', label: 'Получен' },
          { value: 'no', label: 'Нет' },
        ], filters.welcomeBonus)}
      </label>
      <label class="export-field">
        <span>Была оплата</span>
        ${exportSelect('has_payment', [
          { value: '', label: 'Все' },
          { value: 'yes', label: 'Да' },
          { value: 'no', label: 'Нет' },
        ], filters.hasPayment)}
      </label>
      <label class="export-field">
        <span>Баланс от</span>
        <input type="number" name="min_credits" min="0" value="${filters.minCredits ?? ''}" placeholder="0">
      </label>
      <label class="export-field">
        <span>Баланс до</span>
        <input type="number" name="max_credits" min="0" value="${filters.maxCredits ?? ''}" placeholder="∞">
      </label>
      <label class="export-field">
        <span>Неактивны (дней)</span>
        <input type="number" name="inactive_days" min="0" value="${filters.inactiveDays ?? ''}" placeholder="напр. 7">
      </label>
    `,
    )}
    ${exportFilterSection(
      'Параметры рассылки',
      `
      <label class="export-field">
        <span>Сортировка получателей</span>
        ${exportSelect('sort_order', BROADCAST_SORT_OPTIONS, filters.sortOrder)}
      </label>
      <label class="export-field">
        <span>Лимит получателей</span>
        <input type="number" name="limit" min="1" max="${BROADCAST_MAX_RECIPIENTS}" value="${esc(filters.limit)}">
      </label>
      <label class="export-field export-field-check">
        <input type="checkbox" name="exclude_admins" value="1"${filters.excludeAdmins ? ' checked' : ''}>
        <span>Исключить ADMIN_TELEGRAM_IDS</span>
      </label>
    `,
    )}`;
}

function campaignRows(campaigns) {
  if (!campaigns.length) {
    return `<tr><td colspan="6" class="empty">Рассылок пока не было</td></tr>`;
  }

  return campaigns
    .map((c) => {
      const done = Number(c.sent_count) + Number(c.failed_count) + Number(c.skipped_count);
      const progress =
        c.total_recipients > 0 ? Math.round((done / c.total_recipients) * 100) : 0;

      return `<tr>
        <td><a href="/admin/broadcast/${c.id}">#${c.id}</a></td>
        <td>${esc(c.name)}</td>
        <td><span class="badge badge-muted">${esc(STATUS_LABELS[c.status] || c.status)}</span></td>
        <td>${esc(c.sent_count)} / ${esc(c.total_recipients)} (${progress}%)</td>
        <td>${esc(c.failed_count)} ошибок</td>
        <td>${formatDate(c.created_at)}</td>
      </tr>`;
    })
    .join('');
}

function renderPhotoFields(query = {}) {
  const photoLocal =
    String(query.photo_local ?? '').trim() ||
    (isLocalPhotoRef(query.photo_url) ? String(query.photo_url).trim() : '');
  const previewUrl = resolveAdminPhotoPreviewUrl(photoLocal);
  const externalUrl = isLocalPhotoRef(query.photo_url) ? '' : String(query.photo_url ?? '');

  return `
    <label class="export-field export-field-wide">
      <span>Картинка — загрузить файл</span>
      <input type="file" name="photo_file" accept="image/jpeg,image/png,image/webp,image/gif">
      <span class="muted-text">JPEG, PNG, WebP или GIF · до ${Math.round(BROADCAST_MEDIA_MAX_BYTES / (1024 * 1024))} МБ</span>
    </label>
    ${
      previewUrl
        ? `<div class="broadcast-photo-preview">
             <img src="${esc(previewUrl)}" alt="Текущая картинка">
             <p class="muted-text">Картинка сохранена. Чтобы заменить — выберите новый файл.</p>
           </div>
           <input type="hidden" name="photo_local" value="${esc(photoLocal)}">`
        : ''
    }
    <label class="export-field export-field-wide">
      <span>Или URL картинки (если файл не загружаете)</span>
      <input type="url" name="photo_url" value="${esc(externalUrl)}" placeholder="https://example.com/image.jpg">
    </label>`;
}

function helpCode(text) {
  return `<code>${esc(text)}</code>`;
}

function helpRow(button, action, note = '') {
  return `<tr>
    <td>${esc(button)}</td>
    <td>${helpCode(action)}</td>
    <td class="muted-text">${esc(note)}</td>
  </tr>`;
}

function helpUrlExampleRow(label, url, note = '') {
  return helpRow(label, `${label} => ${url}`, note);
}

function renderBroadcastButtonsHelp() {
  const site = config.publicSiteUrl || 'https://ваш-домен.ru';
  const botLink = config.publicBotLink || 'https://t.me/YourBot';
  const packages = config.topupPackages ?? [];
  const buyRows = packages
    .map((pkg) =>
      helpRow(
        `Купить ${pkg.rub} ₽ (${pkg.requests} вопр.)`,
        `callback:buy:${pkg.rub}`,
        'сразу создаёт платёж ЮKassa',
      ),
    )
    .join('');

  const popularPickRows = [
    ['1. Предназначение', '0'],
    ['2. Что тормозит рост', '1'],
    ['3. Отношения', '2'],
    ['4. Сфера работы', '3'],
  ]
    .map(([label, id]) =>
      helpRow(label, `callback:post:questions:pick:${id}`, 'открывает подвопросы темы'),
    )
    .join('');

  const popularAskRows = [
    ['Предназначение → главная миссия', '0:0'],
    ['Предназначение → ключевые таланты', '0:1'],
    ['Предназначение → свой путь', '0:2'],
    ['Рост → внутренние страхи', '1:0'],
    ['Рост → что тянет назад', '1:1'],
    ['Рост → первый шаг', '1:2'],
    ['Отношения → кому я ближе', '2:0'],
    ['Отношения → ошибки в общении', '2:1'],
    ['Отношения → мои потребности', '2:2'],
    ['Работа → роли с энергией', '3:0'],
    ['Работа → без выгорания', '3:1'],
    ['Работа → вектор на 1–2 года', '3:2'],
  ]
    .map(([label, ids]) =>
      helpRow(label, `callback:post:questions:ask:${ids}`, 'сразу задаёт этот вопрос боту'),
    )
    .join('');

  const idleRows = [
    ['❤️ Отношения', '0'],
    ['💼 Карьера и деньги', '1'],
    ['✨ Предназначение', '2'],
    ['🌱 Внутренние блоки', '3'],
    ['⚡ Энергия и ресурс', '4'],
  ]
    .map(([label, id]) =>
      helpRow(label, `callback:post:idle:${id}`, 'готовый вопрос по теме (нужна пройденная анкета)'),
    )
    .join('');

  return `
    <div class="card broadcast-help" id="buttons-help">
      <div class="card-header">Справка: поле «Кнопки»</div>
      <div class="broadcast-help-body">

        <h3 class="broadcast-help-title">Формат</h3>
        <ul class="broadcast-help-list">
          <li><strong>Одна строка</strong> — один ряд кнопок под сообщением.</li>
          <li><strong>Несколько кнопок в ряду</strong> — разделитель <code>||</code> (пробелы необязательны).</li>
          <li><strong>Ссылка:</strong> <code>Текст на кнопке => https://адрес</code></li>
          <li><strong>Действие в боте:</strong> <code>Текст на кнопке => callback:код_действия</code></li>
          <li><strong>Сразу ответ на вопрос:</strong> <code>Текст => question:Текст вопроса для AI</code> — бот ответит без подтверждения (нужна анкета).</li>
          <li>Можно писать <code>Текст | https://…</code> — сработает так же, как <code>=&gt;</code>.</li>
          <li>Callback без префикса тоже принимается: <code>Текст => post:tariffs</code> (= <code>callback:post:tariffs</code>).</li>
          <li>Лимит Telegram: до <strong>64 символов</strong> в <code>callback:…</code>, до <strong>8 кнопок</strong> в ряд.</li>
          <li>Кнопки Web App («Мой код личности» в меню) в рассылке <strong>не поддерживаются</strong> — используйте callback или ссылку на сайт.</li>
        </ul>

        <h3 class="broadcast-help-title">Примеры для копирования</h3>
        <pre class="broadcast-preview">❓ Задать вопрос => callback:post:questions || 📋 Тарифы => callback:post:tariffs
✍️ Свой вопрос => callback:post:questions:custom || 🔥 Популярные => callback:post:questions:popular
✨ Предназначение => question:В чём моё предназначение по коду личности?
💼 Карьера => question:В какой сфере работы я реализуюсь лучше всего?
🪪 Мой код личности => callback:post:menu:open
🌐 Сайт => ${site}</pre>

        <h3 class="broadcast-help-title">Кнопки с готовым вопросом (сразу ответ)</h3>
        <p class="muted-text">
          Формат: <code>Текст кнопки => question:…</code>. Текст вопроса может быть любой длины — в Telegram уходит короткий код.
          Пользователь должен пройти анкету. С баланса списывается 1 вопрос, как при обычном запросе к AI.
        </p>
        <div class="table-wrap">
          <table class="broadcast-help-table">
            <thead><tr><th>Пример для поля «Кнопки»</th><th>Что произойдёт</th></tr></thead>
            <tbody>
              <tr><td>${helpCode('✨ Предназначение => question:В чём моё предназначение?')}</td><td class="muted-text">мгновенный ответ AI</td></tr>
              <tr><td>${helpCode('❤️ Отношения => question:Какой тип людей мне подходит?')}</td><td class="muted-text">мгновенный ответ AI</td></tr>
              <tr><td>${helpCode('💼 Работа => question:Куда двигаться в карьере?')}</td><td class="muted-text">мгновенный ответ AI</td></tr>
            </tbody>
          </table>
        </div>

        <h3 class="broadcast-help-title">UTM для ссылок на сайт</h3>
        <p class="muted-text">
          В форме рассылки блок «UTM для URL-кнопок» — параметры автоматически добавятся ко всем
          <strong>https-кнопкам</strong> при отправке. Callback-кнопки бота не меняются.
          Для отслеживения перехода <strong>в бота</strong> используйте отдельные ссылки
          <code>t.me/бот?start=метка</code> (не utm_*).
        </p>
        <pre class="broadcast-preview">Кнопка: 🌐 Сайт => ${site}
utm_source=telegram · utm_medium=broadcast · utm_campaign=march
→ ${site}/?utm_source=telegram&utm_medium=broadcast&utm_campaign=march</pre>

        <h3 class="broadcast-help-title">Ссылки (URL-кнопки)</h3>
        <p class="muted-text">Открываются в браузере. Подставьте свой домен из <code>PUBLIC_SITE_URL</code>.</p>
        <div class="table-wrap">
          <table class="broadcast-help-table">
            <thead><tr><th>Назначение</th><th>Пример для поля «Кнопки»</th><th>Примечание</th></tr></thead>
            <tbody>
              ${helpUrlExampleRow('🌐 Главная сайта', site, 'лендинг')}
              ${helpUrlExampleRow('📄 Политика конфиденциальности', `${site}/privacy`, 'PRIVACY_POLICY_URL')}
              ${helpUrlExampleRow('🍪 Cookies', `${site}/cookies`, '')}
              ${helpUrlExampleRow('📝 Анкета (заглушка)', `${site}/onboarding`, 'если код ещё не получен')}
              ${helpUrlExampleRow('🤖 Открыть бота', botLink, 'PUBLIC_BOT_USERNAME')}
              ${helpUrlExampleRow('💬 Поддержка по оплате', `https://t.me/${String(config.paymentSupportUsername || '@yakovlev_dev').replace(/^@/, '')}`, 'PAYMENT_SUPPORT_USERNAME')}
            </tbody>
          </table>
        </div>
        <p class="muted-text">
          Персональная визитка <code>/code/XXXXXXXXXX</code> у каждого пользователя своя — в рассылке лучше
          ${helpCode('callback:post:menu:open')}: бот пришлёт ссылку на визитку этого человека.
          Ссылку «Оплатить» из ЮKassa в рассылку не вставляют — она одноразовая и создаётся при выборе тарифа.
        </p>

        <h3 class="broadcast-help-title">Главное меню и вопросы</h3>
        <p class="muted-text">Подходят большинству пользователей с пройденной анкетой.</p>
        <div class="table-wrap">
          <table class="broadcast-help-table">
            <thead><tr><th>Кнопка в боте</th><th>callback для рассылки</th><th>Что делает</th></tr></thead>
            <tbody>
              ${helpRow('❓ Вопросы', 'post:questions', 'меню: свой / популярные вопросы')}
              ${helpRow('✍️ Свой вопрос', 'post:questions:custom', 'режим ввода своего вопроса')}
              ${helpRow('🔥 Популярные вопросы', 'post:questions:popular', 'список из 4 тем')}
              ${helpRow('📋 Тарифы', 'post:tariffs', 'экран покупки вопросов')}
              ${helpRow('🗂️ Мой код личности', 'post:menu:open', 'ссылка на визитку / анкету')}
              ${helpRow('◀️ Назад (к главному)', 'post:questions:back', 'текст после анкеты + меню')}
              ${helpRow('◀️ Назад (меню вопросов)', 'post:questions:menu', 'выбор типа вопроса')}
              ${helpRow('◀️ Назад (из тарифов)', 'post:tariffs:back', 'главное меню после анкеты')}
              ${helpRow('❓ Другой вопрос', 'post:questions', 'из напоминания idle-nudge')}
            </tbody>
          </table>
        </div>

        <h3 class="broadcast-help-title">Популярные вопросы — темы</h3>
        <div class="table-wrap">
          <table class="broadcast-help-table">
            <thead><tr><th>Тема</th><th>callback</th><th>Примечание</th></tr></thead>
            <tbody>${popularPickRows}</tbody>
          </table>
        </div>

        <h3 class="broadcast-help-title">Популярные вопросы — сразу задать подвопрос</h3>
        <div class="table-wrap">
          <table class="broadcast-help-table">
            <thead><tr><th>Подвопрос</th><th>callback</th><th>Примечание</th></tr></thead>
            <tbody>${popularAskRows}</tbody>
          </table>
        </div>

        <h3 class="broadcast-help-title">Темы напоминания (idle-nudge)</h3>
        <div class="table-wrap">
          <table class="broadcast-help-table">
            <thead><tr><th>Тема</th><th>callback</th><th>Примечание</th></tr></thead>
            <tbody>${idleRows}</tbody>
          </table>
        </div>

        <h3 class="broadcast-help-title">После ответа бота (follow-up)</h3>
        <div class="table-wrap">
          <table class="broadcast-help-table">
            <thead><tr><th>Кнопка</th><th>callback</th><th>Примечание</th></tr></thead>
            <tbody>
              ${helpRow('🔁 Продолжить эту тему', 'post:followup:continue', 'уточнение к прошлому ответу')}
              ${helpRow('✨ Начать новую', 'post:followup:new', 'новый вопрос с нуля')}
              ${helpRow('◀️ Назад', 'post:followup:back', 'к меню после ответа')}
              ${helpRow('▶️ /start', 'menu:cmd:start', 'главное меню')}
              ${helpRow('💰 /balance', 'menu:cmd:balance', 'баланс вопросов')}
              ${helpRow('🔄 /restart', 'menu:cmd:restart', 'сброс анкеты')}
              ${helpRow('💳 /topup', 'menu:cmd:topup', 'только ADMIN_TELEGRAM_IDS')}
              ${helpRow('❓ /help', 'menu:cmd:help', 'только ADMIN_TELEGRAM_IDS')}
              ${helpRow('⏭ /skip_onboarding', 'menu:cmd:skip_onboarding', 'только ADMIN_TELEGRAM_IDS')}
            </tbody>
          </table>
        </div>

        <h3 class="broadcast-help-title">Оплата и тарифы</h3>
        <p class="muted-text">Суммы из <code>TOPUP_PACKAGES</code> в .env (сейчас: ${packages.map((p) => `${p.rub}₽→${p.requests} вопр.`).join(', ') || 'не заданы'}).</p>
        <div class="table-wrap">
          <table class="broadcast-help-table">
            <thead><tr><th>Действие</th><th>callback</th><th>Примечание</th></tr></thead>
            <tbody>
              ${helpRow('📋 Тарифы (экран)', 'post:tariffs', 'список пакетов')}
              ${buyRows}
              ${helpRow('◀️ Назад из оплаты', 'pay:back', 'если пользователь уже на экране оплаты')}
              ${helpRow('◀️ Отмена topup-меню', 'buy:cancel', 'закрывает сообщение с тарифами')}
            </tbody>
          </table>
        </div>

        <h3 class="broadcast-help-title">Подтверждение своего вопроса</h3>
        <p class="muted-text">Работают, только если пользователь уже в режиме подтверждения вопроса.</p>
        <div class="table-wrap">
          <table class="broadcast-help-table">
            <thead><tr><th>Кнопка</th><th>callback</th><th>Примечание</th></tr></thead>
            <tbody>
              ${helpRow('➕ Добавить информацию', 'post:question:add', 'дополнить вопрос')}
              ${helpRow('✏️ Поменять вопрос', 'post:question:change', 'переписать вопрос')}
              ${helpRow('✅ Получить ответ', 'post:question:answer', 'отправить вопрос в AI')}
            </tbody>
          </table>
        </div>

        <h3 class="broadcast-help-title">Анкета (onboarding)</h3>
        <p class="muted-text">Имеет смысл только для пользователей, которые сейчас заполняют анкету.</p>
        <div class="table-wrap">
          <table class="broadcast-help-table">
            <thead><tr><th>Кнопка</th><th>callback</th><th>Примечание</th></tr></thead>
            <tbody>
              ${helpRow('Мужской', 'onboard:gender:male', 'шаг «пол»')}
              ${helpRow('Женский', 'onboard:gender:female', 'шаг «пол»')}
              ${helpRow('Да (начинаем расчёт)', 'onboard:confirm:yes', 'подтверждение данных')}
              ${helpRow('Нет (заполнить сначала)', 'onboard:confirm:no', 'вернуться к правкам')}
            </tbody>
          </table>
        </div>

        <h3 class="broadcast-help-title">Готовые шаблоны рассылок</h3>
        <pre class="broadcast-preview">📋 Купить вопросы => callback:post:tariffs

❓ Задать вопрос => callback:post:questions:custom || 🔥 Популярные => callback:post:questions:popular
📋 Тарифы => callback:post:tariffs || 🪪 Мой код => callback:post:menu:open

✨ Предназначение => callback:post:idle:2 || 💼 Карьера => callback:post:idle:1
❤️ Отношения => callback:post:idle:0 || ❓ Свой вопрос => callback:post:questions:custom

💫 Стартовый пакет => callback:buy:${packages[0]?.rub ?? 200} || 📋 Все тарифы => callback:post:tariffs</pre>
      </div>
    </div>`;
}

export function renderBroadcastFormPage({ query = {}, campaigns = [], flash = '' }) {
  const filters = parseAudienceFilters(query);
  const adminIds = config.adminTelegramIds.filter(Number.isFinite);
  const testHint =
    adminIds.length > 0
      ? `Тест уйдёт на telegram_id: ${adminIds.join(', ')}`
      : 'Задайте ADMIN_TELEGRAM_IDS для тестовой отправки';

  return `
    ${flash}
    <h1 class="page-title">Рассылка в бот</h1>
    <p class="page-subtitle">
      Сообщения уходят через Telegram Bot API · воркер на процессе бота · макс. ${BROADCAST_MAX_RECIPIENTS} получателей
    </p>

    <form method="post" action="/admin/broadcast" enctype="multipart/form-data" class="card" style="margin-bottom:1rem" id="broadcast-form">
      <div class="card-header">1. Сообщение</div>
      <div class="export-form">
        ${exportFilterSection(
          'Текст',
          `
          <label class="export-field export-field-wide">
            <span>Название кампании (для себя)</span>
            <input type="text" name="name" required maxlength="120" value="${esc(query.name ?? '')}" placeholder="Например: Акция на тарифы">
          </label>
          <label class="export-field export-field-wide">
            <span>Текст (HTML: &lt;b&gt;, &lt;i&gt;, &lt;a href=""&gt;)</span>
            <textarea name="message_text" class="broadcast-textarea" required placeholder="Текст рассылки…">${esc(query.message_text ?? '')}</textarea>
          </label>
        `,
        )}
        ${exportFilterSection('Картинка', renderPhotoFields(query))}
        ${exportFilterSection(
          'Кнопки',
          `
          <label class="export-field export-field-wide" id="buttons-field">
            <span>Необязательно · <a href="#buttons-help">полная справка ↓</a></span>
            <textarea name="buttons_text" class="broadcast-textarea broadcast-textarea-sm" placeholder="📋 Тарифы => callback:post:tariffs || 🌐 Сайт => https://personality-code.ru">${esc(query.buttons_text ?? '')}</textarea>
          </label>
        `,
        )}
        ${exportFilterSection(
          'UTM для URL-кнопок',
          `
          <label class="export-field">
            <span>utm_source</span>
            <input type="text" name="utm_source" value="${esc(query.utm_source ?? '')}" placeholder="telegram">
          </label>
          <label class="export-field">
            <span>utm_medium</span>
            <input type="text" name="utm_medium" value="${esc(query.utm_medium ?? '')}" placeholder="broadcast">
          </label>
          <label class="export-field">
            <span>utm_campaign</span>
            <input type="text" name="utm_campaign" value="${esc(query.utm_campaign ?? '')}" placeholder="march_sale">
          </label>
          <label class="export-field">
            <span>utm_content</span>
            <input type="text" name="utm_content" value="${esc(query.utm_content ?? '')}" placeholder="btn_site">
          </label>
          <label class="export-field">
            <span>utm_term</span>
            <input type="text" name="utm_term" value="${esc(query.utm_term ?? '')}" placeholder="">
          </label>
        `,
        )}
        <p class="muted-text export-hint">
          <strong>Кратко:</strong> строка = ряд кнопок; в ряду — через <code>||</code>.
          Ссылка: <code>Текст => https://…</code>.
          Бот: <code>Текст => callback:post:tariffs</code> (или без префикса <code>callback:</code>).
          <strong>Сразу ответ:</strong> <code>Текст => question:Ваш вопрос</code>.
          UTM добавляется только к <strong>URL-кнопкам</strong> (сайт, не <code>t.me?start=</code>).
          ${esc(testHint)}.
        </p>
      </div>

      <div class="card-header">2. Аудитория</div>
      <div class="export-form">${audienceFilterFields(filters)}</div>

      <div class="export-actions" style="padding:0 1rem 1.25rem">
        <button type="submit" name="action" value="test" class="btn">Тест себе</button>
        <button type="submit" name="action" value="start" class="btn btn-success"
                onclick="return confirm('Запустить рассылку? Сообщения начнут уходить получателям.');">
          Запустить рассылку
        </button>
      </div>
    </form>

    ${renderBroadcastButtonsHelp()}

    <div class="card">
      <div class="card-header">Последние кампании</div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>ID</th><th>Название</th><th>Статус</th><th>Прогресс</th><th>Ошибки</th><th>Создана</th></tr>
          </thead>
          <tbody>${campaignRows(campaigns)}</tbody>
        </table>
      </div>
    </div>

    <script>
      (function () {
        const stageSelect = document.getElementById('audience-stage');
        const stepSelect = document.getElementById('onboarding-step-select');
        const stepField = document.getElementById('onboarding-step-field');
        if (!stageSelect || !stepSelect || !stepField) return;

        function syncOnboardingStepField() {
          const enabled = stageSelect.value === 'in_progress';
          stepSelect.disabled = !enabled;
          stepField.classList.toggle('export-field-disabled', !enabled);
          if (!enabled) {
            stepSelect.value = '';
          }
        }

        stageSelect.addEventListener('change', syncOnboardingStepField);
        syncOnboardingStepField();
      })();
    </script>`;
}

export function renderBroadcastStatusPage({ campaign, failures = [], flash = '' }) {
  const done =
    Number(campaign.sent_count) + Number(campaign.failed_count) + Number(campaign.skipped_count);
  const progress =
    campaign.total_recipients > 0 ? Math.round((done / campaign.total_recipients) * 100) : 0;

  const failureRows = failures.length
    ? failures
        .map(
          (row) => `<tr>
          <td><a href="/admin/users/${row.user_id}">${esc(userLabel(row))}</a></td>
          <td><code>${esc(row.telegram_id)}</code></td>
          <td>${esc(row.error_description || '—')}</td>
        </tr>`,
        )
        .join('')
    : `<tr><td colspan="3" class="empty">Ошибок пока нет</td></tr>`;

  const controls =
    campaign.status === 'running'
      ? `<form method="post" action="/admin/broadcast/${campaign.id}/pause" style="display:inline">
           <button type="submit" class="btn btn-sm">Пауза</button>
         </form>
         <form method="post" action="/admin/broadcast/${campaign.id}/cancel" style="display:inline"
               onsubmit="return confirm('Отменить рассылку? Неотправленные сообщения будут пропущены.');">
           <button type="submit" class="btn btn-danger btn-sm">Отменить</button>
         </form>`
      : campaign.status === 'paused'
        ? `<form method="post" action="/admin/broadcast/${campaign.id}/resume" style="display:inline">
             <button type="submit" class="btn btn-success btn-sm">Продолжить</button>
           </form>
           <form method="post" action="/admin/broadcast/${campaign.id}/cancel" style="display:inline"
                 onsubmit="return confirm('Отменить рассылку?');">
             <button type="submit" class="btn btn-danger btn-sm">Отменить</button>
           </form>`
        : '';

  return `
    ${flash}
    <p><a href="/admin/broadcast">← Все рассылки</a></p>
    <h1 class="page-title">${esc(campaign.name)}</h1>
    <p class="page-subtitle">
      #${campaign.id} · ${esc(STATUS_LABELS[campaign.status] || campaign.status)} ·
      ${esc(campaign.sent_count)} отправлено · ${esc(campaign.failed_count)} ошибок ·
      ${esc(campaign.skipped_count)} пропущено · ${progress}% готово
    </p>

    <div class="toolbar">${controls}
      ${campaign.status === 'running' || campaign.status === 'queued' ? '<span class="muted-text">Страница обновляется воркером бота каждые несколько секунд</span>' : ''}
      ${campaign.status === 'running' || campaign.status === 'queued' ? `<a href="/admin/broadcast/${campaign.id}" class="btn btn-ghost btn-sm">Обновить</a>` : ''}
    </div>

    <div class="card" style="margin-bottom:1rem">
      <div class="card-header">Текст</div>
      <pre class="broadcast-preview">${esc(campaign.message_text)}</pre>
      ${
        resolveCampaignPhotoPreviewUrl(campaign.photo_url)
          ? `<div class="broadcast-photo-preview" style="padding:0 1rem 1rem">
               <img src="${esc(resolveCampaignPhotoPreviewUrl(campaign.photo_url))}" alt="Картинка рассылки">
             </div>`
          : ''
      }
    </div>

    <div class="card">
      <div class="card-header">Последние ошибки</div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Пользователь</th><th>Telegram</th><th>Ошибка</th></tr></thead>
          <tbody>${failureRows}</tbody>
        </table>
      </div>
    </div>`;
}

export { STATUS_LABELS };
