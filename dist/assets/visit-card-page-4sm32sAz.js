import{i as d}from"./shell-C31QxwEL.js";function l(t){return String(t!=null?t:"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}function m(t){let e=l(t);return e=e.replace(/&lt;b&gt;/gi,"<strong>").replace(/&lt;\/b&gt;/gi,"</strong>"),e=e.replace(/&lt;i&gt;/gi,"<em>").replace(/&lt;\/i&gt;/gi,"</em>"),e=e.replace(/\n/g,"<br>"),e}function o(t){return String(t!=null?t:"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}function p(){var e;const t=window.location.pathname.match(/^\/code\/(\d{10})\/?$/);return(e=t==null?void 0:t[1])!=null?e:""}async function u(t){const e=await fetch(`/api/visit-card/${encodeURIComponent(t)}`);if(e.status===404)return null;if(!e.ok)throw new Error("Не удалось загрузить визитку");return e.json()}function h(t){return t!=null&&t.length?t.map(e=>`<div class="code-part"><span>${o(e.label)}</span><strong>${o(e.value)}</strong></div>`).join(""):""}function g(t){const e=document.getElementById("share-btn"),a=document.getElementById("share-status"),n=s=>{a&&(a.textContent=s)},i=async()=>{var r;try{if((r=navigator.clipboard)!=null&&r.writeText){await navigator.clipboard.writeText(t),n("Ссылка скопирована ✓");return}}catch(c){}const s=document.createElement("textarea");s.value=t,s.style.position="fixed",s.style.opacity="0",document.body.appendChild(s),s.select();try{document.execCommand("copy"),n("Ссылка скопирована ✓")}catch(c){n("Не удалось скопировать — выделите ссылку вручную")}document.body.removeChild(s)};e==null||e.addEventListener("click",async()=>{if(navigator.share)try{await navigator.share({title:"Мой код личности",text:"Посмотри мой код личности",url:t}),n("Спасибо, что поделились ✓");return}catch(s){if((s==null?void 0:s.name)==="AbortError")return}await i()})}function v(t){var c;const e=document.getElementById("visit-card-page"),a=document.getElementById("visit-card-not-found"),n=document.getElementById("visit-card-loading");if(!t){n==null||n.classList.add("is-hidden"),a==null||a.classList.remove("is-hidden"),document.title="Визитка не найдена";return}const i=t.botUsername?`@${t.botUsername}`:"нашем боте",s=h(t.breakdown),r=m((c=t.content)!=null?c:"");e.innerHTML=`
    <p class="badge">Визитка</p>
    <h1>Твой личный <br> Код личности</h1>
    <p class="lead">Публичная страница с разбором — без имени, даты и места рождения.</p>
    <div class="code-hero">
      <div class="code-label">Код личности</div>
      <div class="code-value">${o(t.personalityCode)}</div>
    </div>
    ${s?`<div class="code-grid">${s}</div>`:""}
    <div class="visit-content prose">${r}</div>
    <div class="share-row">
      <button type="button" class="share-btn" id="share-btn">🔗 Поделиться визиткой</button>
      ${t.askBotLink?`<a class="ask-btn" href="${o(t.askBotLink)}" target="_blank" rel="noopener">❓ Задать вопрос</a>`:""}
      <div class="share-status" id="share-status"></div>
    </div>
    <p class="share-note">
      Хотите свой код? Пройдите анкету в ${o(i)}.
      ${t.botLink?`<a href="${o(t.botLink)}">Открыть бота</a>`:""}
    </p>
  `,document.title=`Код ${t.personalityCode}`,n==null||n.classList.add("is-hidden"),e.classList.remove("is-hidden"),g(t.shareUrl)}function b(t){const e=document.getElementById("visit-card-not-found"),a=document.getElementById("visit-card-loading"),n=t!=null&&t.botUsername?`@${t.botUsername}`:"Telegram-боте";e.innerHTML=`
    <p class="badge">Визитка</p>
    <h1>Страница не найдена</h1>
    <p class="lead">
      Такой код личности не опубликован или ссылка указана неверно.
      Получить свой код можно в ${o(n)}.
    </p>
    <div class="cta-row">
      ${t!=null&&t.botLink?`<a class="cta" href="${o(t.botLink)}">Открыть бота</a>`:""}
      <a class="cta-secondary" href="/">На главную</a>
    </div>
  `,a==null||a.classList.add("is-hidden"),e.classList.remove("is-hidden"),document.title="Визитка не найдена"}async function L(){var n;const t=document.getElementById("visit-card-loading"),e=document.getElementById("visit-card-error"),a=p();if(!a){t==null||t.classList.add("is-hidden"),e&&(e.textContent="Некорректный код визитки",e.classList.remove("is-hidden"));return}try{const i=await d({activeNav:""}),s=await u(a);if(!s){b(i);return}v(s)}catch(i){t==null||t.classList.add("is-hidden"),e&&(e.textContent=(n=i==null?void 0:i.message)!=null?n:"Ошибка загрузки",e.classList.remove("is-hidden"))}}export{L as initVisitCardPage};
