// الواجهة: الرئيسية، لعبة جديدة، الإعدادات، واختيار النماذج. شاشة اللعبة في project.js.

import { $, $$, esc, toast, ask, sheet, modalStack, money, ago, uid, android, deviceInfo } from './util.js';
import { projects, settings, keys, addVersion } from './store.js';
import {
  CLAUDE_MODELS, TIERS, openRouterModels, openRouterUpdatedAt, refreshOpenRouter, modelFor, setModelFor,
} from './models.js';
import { claudeModels, openRouterBalance } from './llm.js';
import { loadProbe, DEFAULT_RULES } from './engine.js';
import { projectScreen, leaveProject, projectBack } from './project.js';

const app = $('#app');

/* ── التنقل ─────────────────────────────────────────────── */

const routes = {
  '': home,
  new: newGame,
  settings: settingsScreen,
  p: (id) => projectScreen(app, id),
};

async function route() {
  const [name, arg] = location.hash.replace(/^#\/?/, '').split('/');
  if (name !== 'p') { leaveProject(); app.className = ''; }
  window.scrollTo(0, 0);
  await (routes[name] || home)(arg);
}

export function go(path) { location.hash = '#/' + path; }

window.addEventListener('hashchange', route);

// زر الرجوع في أندرويد
window.onAndroidBack = () => {
  if (modalStack.length) { modalStack.at(-1)(); return true; }
  const name = location.hash.replace(/^#\/?/, '').split('/')[0];
  if (name === 'p' && projectBack()) return true;
  if (name) { history.length > 1 ? history.back() : go(''); return true; }
  return false;
};

/* ── الرئيسية ──────────────────────────────────────────── */

const ICONS = ['🎮', '🚀', '🏰', '🏎️', '🐉', '⚽', '🧩', '👾', '🗡️', '🌌'];

async function home() {
  const list = await projects.all();
  const noKeys = !keys.openrouter && !keys.anthropic;
  app.innerHTML = `
    <header class="top"><h1>🎮 استوديو الألعاب</h1><button class="icon" id="set" aria-label="الإعدادات">⚙️</button></header>
    <main class="page">
      ${noKeys ? `<div class="card warn"><b>ابدأ بإضافة مفتاح</b>
        <p class="muted">ضع مفتاح OpenRouter (لكل النماذج) أو مفتاح كلود (للتطوير التلقائي بـ Claude). المفاتيح تبقى على جهازك فقط.</p>
        <button class="btn primary" id="toSet">فتح الإعدادات</button></div>` : ''}
      <button class="btn primary big" id="new">✨ لعبة جديدة من وصفك</button>
      <label class="btn ghost">📥 استيراد لعبة HTML<input type="file" id="imp" accept=".html,.htm,text/html" hidden></label>
      <h3>ألعابي ${list.length ? `<span class="muted">(${list.length})</span>` : ''}</h3>
      <div class="list">
        ${list.length ? list.map((p, i) => `
          <button class="game" data-id="${esc(p.id)}">
            <span class="ico">${ICONS[i % ICONS.length]}</span>
            <span class="meta"><b>${esc(p.name || 'بلا اسم')}</b>
              <span class="muted">${p.status === 'building' && !p.code ? '⏳ لم يكتمل البناء' : `${(p.versions || []).length} إصدار`} · ${ago(p.updatedAt)}${p.spent ? ' · ' + money(p.spent) : ''}</span></span>
          </button>`).join('') : '<p class="muted">ما عندك ألعاب بعد. اضغط «لعبة جديدة» واوصف اللعبة اللي تريدها.</p>'}
      </div>
    </main>`;
  $('#set').onclick = () => go('settings');
  $('#toSet')?.addEventListener('click', () => go('settings'));
  $('#new').onclick = () => go('new');
  $$('.game').forEach((b) => (b.onclick = () => go('p/' + b.dataset.id)));
  $('#imp').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const code = await f.text();
    const p = {
      id: uid(), name: f.name.replace(/\.html?$/i, ''), description: '', options: {}, design: '', roadmap: '',
      chat: [{ role: 'sys', text: 'استوردت هذه اللعبة من ملف.', at: Date.now() }], createdAt: Date.now(), status: 'ready',
    };
    addVersion(p, code, 'مستوردة من ملف');
    await projects.put(p);
    go('p/' + p.id);
  };
}

/* ── لعبة جديدة ────────────────────────────────────────── */

const EXAMPLES = [
  'لعبة مغامرات ثنائية الأبعاد: بطل يقفز بين المنصات، يجمع عملات، يتجنب الوحوش، 5 مراحل وزعيم بالنهاية',
  'لعبة سيارات ثلاثية الأبعاد: سباق بشارع بيه زحمة، أتجنب السيارات وأجمع وقود، والسرعة تزيد تدريجيًا',
  'لعبة فضاء: مركبة تضرب النيازك والأعداء، ترقيات للسلاح، وزعيم كل 5 موجات',
  'لعبة ألغاز: أربط الألوان المتشابهة، 30 مرحلة تصعب تدريجيًا، ونجوم لكل مرحلة',
  'لعبة هروب: أهرب من بيت مظلم بمصباح يدوي، أجمع مفاتيح، وأتجنب الشبح',
];

function seg(name, options, value) {
  return `<div class="seg" data-seg="${name}">${options.map(([v, l]) => `<button data-v="${v}" class="${v === value ? 'on' : ''}">${l}</button>`).join('')}</div>`;
}

function readSeg(root, name) {
  return $(`[data-seg="${name}"] .on`, root)?.dataset.v;
}

function bindSegs(root) {
  $$('.seg', root).forEach((s) => s.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    $$('button', s).forEach((x) => x.classList.toggle('on', x === b));
    s.dispatchEvent(new Event('change'));
  }));
}

function newGame() {
  const draft = settings.get('draft') || {};
  const m = modelFor('build');
  app.innerHTML = `
    <header class="top"><button class="icon" id="back">→</button><h1>لعبة جديدة</h1></header>
    <main class="page">
      <label class="field">وصف اللعبة (اختياري): فكرتها، البطل، الأعداء، المراحل، الشكل… إذا تتركه فاضي، الذكاء الاصطناعي يخترع لعبة تناسب اختياراتك
        <textarea id="desc" rows="7" placeholder="مثلًا: لعبة نينجا يركض على السطوح ويقفز فوق الفجوات، يرمي نجوم على الأعداء، كل مرحلة بمدينة مختلفة...">${esc(draft.desc || '')}</textarea>
      </label>
      <div class="chips">${EXAMPLES.map((e, i) => `<button class="chip" data-ex="${i}">${esc(e.split(':')[0])}</button>`).join('')}</div>
      <div class="card">
        <label class="field">الأبعاد ${seg('dim', [['auto', 'تلقائي'], ['2D', '2D'], ['3D', '3D']], draft.dim || 'auto')}</label>
        <label class="field">اتجاه الشاشة ${seg('orientation', [['portrait', 'عمودي'], ['landscape', 'أفقي']], draft.orientation || 'portrait')}</label>
        <label class="field">الشكل ${seg('style', [['auto', 'تلقائي'], ['cartoon', 'كرتوني'], ['pixel', 'بكسل'], ['neon', 'نيون'], ['realistic', 'واقعي']], draft.style || 'auto')}</label>
        <label class="field">لغة نصوص اللعبة ${seg('lang', [['Arabic', 'عربي'], ['English', 'English']], draft.lang || 'Arabic')}</label>
      </div>
      <details class="card" ${draft.instr ? 'open' : ''}><summary>📜 تعليمات خاصة لهذه اللعبة (اختياري)</summary>
        <textarea id="instr" rows="3" placeholder="مثلًا: كل النصوص بالعراقي، لا تستخدم دم، خلي التحكم بإصبع واحد">${esc(draft.instr || '')}</textarea></details>
      <div class="model">${m ? `<span class="grow"><b>${esc(m.name)}</b><span class="muted">النموذج اللي راح يصمم ويبني</span></span>` : '<span class="grow muted">لا يوجد مفتاح بعد</span>'}
        <button class="btn sm" id="pick">تغيير</button></div>
      <button class="btn primary big" id="make"></button>
      <p class="muted">النموذج يكتب خطة اللعبة أولًا، ثم يبني الإصدار الأول، يختبره، ويصلح أخطاءه تلقائيًا. تگدر تطلع من التطبيق والشغل يكمل،
        وإذا انقطع النت يكمل من حيث توقف. بعدها تطورها بالطلبات أو تلقائيًا.</p>
    </main>`;
  bindSegs(app);
  const label = () => { $('#make').textContent = $('#desc').value.trim() ? '🚀 اصنع اللعبة' : '🎲 فاجئني بلعبة (بدون وصف)'; };
  const save = () => {
    label();
    settings.set('draft', {
      desc: $('#desc').value, instr: $('#instr').value, dim: readSeg(app, 'dim'), orientation: readSeg(app, 'orientation'), style: readSeg(app, 'style'), lang: readSeg(app, 'lang'),
    });
  };
  label();
  $('#desc').oninput = save;
  $('#instr').oninput = save;
  $$('.seg', app).forEach((s) => s.addEventListener('change', save));
  $$('[data-ex]').forEach((b) => (b.onclick = () => { $('#desc').value = EXAMPLES[b.dataset.ex]; save(); }));
  $('#back').onclick = () => history.back();
  $('#pick').onclick = () => pickModel('build', () => newGame());
  $('#make').onclick = async () => {
    const desc = $('#desc').value.trim();
    if (!modelFor('build')) { toast('أضف مفتاحًا أولًا'); return go('settings'); }
    save();
    const p = {
      id: uid(), name: 'لعبة جديدة', description: desc, instructions: $('#instr').value.trim(), design: '', roadmap: '', status: 'building', createdAt: Date.now(),
      options: { dim: readSeg(app, 'dim'), orientation: readSeg(app, 'orientation'), style: readSeg(app, 'style'), lang: readSeg(app, 'lang') },
      chat: [{ role: 'user', text: desc || '🎲 فاجئني بلعبة من اختيارك', at: Date.now() }], versions: [], code: '',
    };
    await projects.put(p);
    settings.set('draft', null);
    sessionStorage.setItem('gs.autobuild', p.id);
    go('p/' + p.id);
  };
}

/* ── اختيار النموذج ────────────────────────────────────── */

function modelRow(m, selected) {
  const price = m.in || m.out ? `$${fmt(m.in)} / $${fmt(m.out)} لكل مليون رمز` : 'السعر حسب النموذج';
  const ctx = m.ctx ? ` · سياق ${m.ctx >= 1e6 ? Math.round(m.ctx / 1e6) + 'M' : Math.round(m.ctx / 1000) + 'k'}` : '';
  return `<button class="opt ${selected ? 'on' : ''}" data-p="${m.provider}" data-id="${esc(m.id)}">
    <span class="grow"><b>${m.recommended ? '⭐ ' : ''}${esc(m.name)}</b>
      <small class="ltr">${esc(m.id)}</small>
      <small>${price}${ctx}${m.vision ? ' · 👁 يشوف لقطات الشاشة' : ''}</small>
      ${m.note ? `<small>${esc(m.note)}</small>` : ''}</span></button>`;
}

const fmt = (v) => (v >= 10 ? v.toFixed(0) : v >= 1 ? v.toFixed(2).replace(/\.?0+$/, '') : v.toFixed(3).replace(/\.?0+$/, ''));

export function pickModel(task, done) {
  const cur = modelFor(task);
  const isSel = (m) => cur && cur.provider === m.provider && cur.id === m.id;
  const or = openRouterModels();
  const html = `
    <div class="row"><h3 class="grow">${task === 'auto' ? 'نموذج التطوير التلقائي' : 'نموذج الصنع والتعديل'}</h3><button class="icon" data-close>✕</button></div>
    <p class="muted">مرتبة حسب قوتها في برمجة الألعاب. ⭐ = اختيارنا. السعر للدخل / للخرج.</p>
    <div class="tier">Claude مباشرة (مفتاح كلود)</div>
    ${keys.anthropic ? CLAUDE_MODELS.map((m) => modelRow(m, isSel(m))).join('') : '<p class="muted">أضف مفتاح كلود بالإعدادات لتفعيل هذه النماذج.</p>'}
    <div class="tier">OpenRouter ${openRouterUpdatedAt() ? `<span class="muted">(تحدثت ${ago(openRouterUpdatedAt())})</span>` : '<span class="muted">(قائمة احتياطية — حدّثها من الإعدادات)</span>'}</div>
    ${keys.openrouter ? TIERS.map((t) => {
      const ms = or.filter((m) => m.tier === t.id);
      return ms.length ? `<div class="tier">${t.label}</div>${ms.map((m) => modelRow(m, isSel(m))).join('')}` : '';
    }).join('') : '<p class="muted">أضف مفتاح OpenRouter بالإعدادات لتفعيل هذه النماذج.</p>'}
    <label class="field">أو اكتب اسم أي نموذج من openrouter.ai/models
      <div class="row"><input type="text" id="custom" class="ltr grow" placeholder="provider/model-name"><button class="btn sm" id="useCustom">استخدم</button></div></label>`;
  const s = sheet(html);
  s.el.addEventListener('click', (e) => {
    const b = e.target.closest('.opt');
    if (!b) return;
    const m = [...CLAUDE_MODELS, ...or].find((x) => x.provider === b.dataset.p && x.id === b.dataset.id);
    setModelFor(task, m);
    s.close();
    toast('تم اختيار ' + m.name);
    done?.();
  });
  $('#useCustom', s.el).onclick = () => {
    const id = $('#custom', s.el).value.trim();
    if (!id.includes('/')) return toast('الاسم يكون مثل provider/model');
    if (!keys.openrouter) return toast('يحتاج مفتاح OpenRouter');
    setModelFor(task, { provider: 'openrouter', id });
    s.close();
    done?.();
  };
}

/* ── الإعدادات ─────────────────────────────────────────── */

function keyCard(id, title, value, link, linkText) {
  return `<div class="card"><h3>🔑 ${title}</h3>
    <div class="row"><input type="password" id="${id}" class="ltr grow" value="${esc(value)}" placeholder="الصق المفتاح هنا" autocomplete="off">
      <button class="btn sm" data-eye="${id}">👁</button></div>
    <div class="row"><button class="btn sm primary" data-save="${id}">حفظ</button><button class="btn sm" data-test="${id}">فحص</button>
      <span class="muted grow" id="${id}-st"></span></div>
    <a href="${link}" class="muted">${linkText}</a></div>`;
}

function settingsScreen() {
  const b = modelFor('build'), a = modelFor('auto');
  const effort = settings.get('effort', 'high');
  app.innerHTML = `
    <header class="top"><button class="icon" id="back">→</button><h1>الإعدادات</h1></header>
    <main class="page">
      ${keyCard('kor', 'مفتاح OpenRouter', keys.openrouter, 'https://openrouter.ai/keys', 'احصل على مفتاح من openrouter.ai/keys')}
      ${keyCard('kan', 'مفتاح كلود (Anthropic)', keys.anthropic, 'https://console.anthropic.com/settings/keys', 'احصل على مفتاح من console.anthropic.com')}
      <p class="muted">المفاتيح محفوظة داخل التطبيق على جهازك فقط، وتُرسل فقط إلى OpenRouter أو Anthropic عند الطلب. الألعاب نفسها تعمل معزولة ولا تقدر توصل للمفاتيح.</p>
      <div class="card"><h3>🧠 النماذج</h3>
        <div class="model"><span class="grow"><b>${esc(b?.name || '—')}</b><span class="muted">الصنع والتعديل بالطلب</span></span><button class="btn sm" id="pb">تغيير</button></div>
        <div class="model"><span class="grow"><b>${esc(a?.name || '—')}</b><span class="muted">التطوير التلقائي</span></span><button class="btn sm" id="pa">تغيير</button></div>
        <label class="field">عمق التفكير (لنماذج كلود): أعمق = أذكى وأبطأ وأغلى
          ${seg('effort', [['low', 'خفيف'], ['medium', 'متوسط'], ['high', 'عالي'], ['xhigh', 'أقصى']], effort)}</label>
        <div class="row"><button class="btn sm" id="refresh">🔄 تحديث قائمة OpenRouter</button>
          <span class="muted" id="refst">${openRouterUpdatedAt() ? 'آخر تحديث ' + ago(openRouterUpdatedAt()) : 'لم تُحدَّث بعد'}</span></div>
      </div>
      <div class="card"><h3>📜 تعليمات النموذج (البرومبت)</h3>
        <p class="muted">انت تختار: تعليماتنا الجاهزة لصنع الألعاب، أو تضيف عليها، أو تكتب تعليماتك انت بالكامل. صيغة الرد تنضاف دائمًا لأن التطبيق يحتاجها حتى يقرأ الكود.</p>
        ${seg('pmode', [['default', 'الجاهزة'], ['extra', 'الجاهزة + إضافاتي'], ['custom', 'تعليماتي فقط']], settings.get('prompt.mode', 'default'))}
        <textarea id="pextra" rows="4" placeholder="إضافاتك: مثلًا كل الألعاب بأسلوب كرتوني، الأصوات هادئة، النصوص بالعراقي…">${esc(settings.get('prompt.extra') || '')}</textarea>
        <textarea id="pcustom" class="ltr" rows="10" placeholder="اكتب تعليماتك الكاملة للنموذج…">${esc(settings.get('prompt.custom') || '')}</textarea>
        <div class="row"><button class="btn sm" id="pcopy">انسخ الجاهزة هنا حتى أعدلها</button><button class="btn sm" id="pview">عرض الجاهزة</button></div>
      </div>
      <div class="card"><h3>📶 الشغل بالخلفية</h3>
        <p class="muted">صنع اللعبة والتطوير التلقائي يكملون وانت طالع من التطبيق (يظهر إشعار بالتقدم، وإشعار ثاني لما يخلص).
          حتى ما يوقفه نظام توفير البطارية، اسمح للتطبيق يشتغل بالخلفية.</p>
        <div class="row"><span class="grow" id="bgst"></span><button class="btn sm" id="bg">اسمح بالخلفية</button></div>
        <label class="row"><input type="checkbox" id="autofix" ${settings.get('autofix', true) ? 'checked' : ''}> إصلاح تلقائي لأي خطأ يظهر أثناء تشغيل اللعبة</label>
      </div>
      <div class="card"><h3>💾 النسخ الاحتياطي</h3>
        <p class="muted">احفظ كل ألعابك بملف واحد (مثلًا قبل تغيير الجهاز)، أو استرجعها.</p>
        <div class="row"><button class="btn sm" id="backup">تصدير نسخة احتياطية</button>
          <label class="btn sm">استيراد نسخة<input type="file" id="restore" accept=".json,application/json" hidden></label></div>
      </div>
      <p class="muted">استوديو الألعاب ${esc(android?.appVersion?.() || '')}</p>
    </main>`;
  bindSegs(app);
  $('[data-seg="effort"]').addEventListener('change', () => settings.set('effort', readSeg(app, 'effort')));
  const promptUi = () => {
    const mode = readSeg(app, 'pmode');
    $('#pextra').hidden = mode !== 'extra';
    $('#pcustom').hidden = mode !== 'custom';
    $('#pcopy').hidden = mode !== 'custom';
  };
  promptUi();
  $('[data-seg="pmode"]').addEventListener('change', () => {
    const mode = readSeg(app, 'pmode');
    if (mode === 'custom' && !$('#pcustom').value.trim()) $('#pcustom').value = DEFAULT_RULES;
    settings.set('prompt.mode', mode);
    settings.set('prompt.custom', $('#pcustom').value);
    promptUi();
  });
  $('#pextra').oninput = () => settings.set('prompt.extra', $('#pextra').value);
  $('#pcustom').oninput = () => settings.set('prompt.custom', $('#pcustom').value);
  $('#pcopy').onclick = () => { $('#pcustom').value = DEFAULT_RULES; settings.set('prompt.custom', DEFAULT_RULES); toast('انحطت التعليمات الجاهزة، عدّلها مثل ما تريد'); };
  $('#pview').onclick = () => sheet(`<div class="row"><h3 class="grow">التعليمات الجاهزة</h3><button class="icon" data-close>✕</button></div>
    <pre class="stream ltr" style="height:auto;max-height:65vh;overflow:auto;display:block;white-space:pre-wrap">${esc(DEFAULT_RULES)}</pre>`);
  const bgState = () => {
    const ok = !android || android.backgroundAllowed?.();
    $('#bgst').textContent = ok ? '✅ مسموح' : '⚠️ غير مسموح — قد ينقطع الشغل إذا طلعت';
    $('#bg').hidden = !!ok;
  };
  bgState();
  $('#bg').onclick = () => { android?.requestBackground?.(); setTimeout(bgState, 1500); };
  document.addEventListener('visibilitychange', () => { if (!document.hidden && $('#bgst')) bgState(); });
  $('#autofix').onchange = (e) => settings.set('autofix', e.target.checked);
  $('#back').onclick = () => history.back();
  $('#pb').onclick = () => pickModel('build', settingsScreen);
  $('#pa').onclick = () => pickModel('auto', settingsScreen);
  $$('[data-eye]').forEach((x) => (x.onclick = () => { const i = $('#' + x.dataset.eye); i.type = i.type === 'password' ? 'text' : 'password'; }));
  const setKey = (id) => {
    const v = $('#' + id).value.trim();
    if (id === 'kor') keys.openrouter = v; else keys.anthropic = v;
  };
  $$('[data-save]').forEach((x) => (x.onclick = () => { setKey(x.dataset.save); toast('تم الحفظ'); settingsScreen(); }));
  $$('[data-test]').forEach((x) => (x.onclick = async () => {
    const id = x.dataset.test;
    setKey(id);
    const st = $(`#${id}-st`);
    st.textContent = 'جاري الفحص…';
    try {
      if (id === 'kor') {
        const bal = await openRouterBalance();
        st.textContent = bal == null ? '✅ المفتاح يعمل' : `✅ يعمل · الرصيد ${money(bal)}`;
      } else {
        const ids = await claudeModels();
        const ok = CLAUDE_MODELS.filter((m) => ids.includes(m.id)).map((m) => m.name.replace('Claude ', ''));
        st.textContent = `✅ يعمل · ${ok.length ? ok.join('، ') : ids.length + ' نموذج'}`;
      }
    } catch (e) {
      st.textContent = '❌ ' + e.message;
    }
  }));
  $('#refresh').onclick = async () => {
    $('#refst').textContent = 'جاري التحديث…';
    try {
      const list = await refreshOpenRouter({ force: true });
      $('#refst').textContent = `✅ ${list.length} نموذج مختار ومرتب`;
    } catch (e) {
      $('#refst').textContent = '❌ ' + e.message;
    }
  };
  $('#backup').onclick = async () => {
    const all = await projects.all();
    saveFile('gamestudio-backup.json', JSON.stringify({ app: 'gamestudio', version: 1, projects: all }), 'application/json');
  };
  $('#restore').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      const list = Array.isArray(data) ? data : data.projects;
      if (!Array.isArray(list)) throw new Error('ملف غير صالح');
      if (!(await ask(`استرجاع ${list.length} لعبة؟ الألعاب بنفس المعرّف تُستبدل.`))) return;
      for (const p of list) if (p?.id) await projects.put(p);
      toast('تم الاسترجاع');
    } catch (err) {
      toast('تعذر الاسترجاع: ' + err.message);
    }
  };
}

/** مشاركة أو حفظ ملف: بالأندرويد عبر نافذة المشاركة، وبالمتصفح كتنزيل. */
export function saveFile(name, content, mime, { downloads = false } = {}) {
  if (android) {
    if (downloads) {
      if (android.saveToDownloads(name, content, mime)) return toast('انحفظ في التنزيلات: ' + name);
    }
    return android.share(name, content, mime);
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type: mime }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ── البدء ─────────────────────────────────────────────── */

loadProbe().catch(() => {});
// مواصفات الهاتف (الشاشة، المعالج الرسومي، WebGL) تُرسل للنموذج حتى يكتب لعبة تناسبه
try { settings.set('device', deviceInfo()); } catch { /* غير ضروري */ }
// تحديث قائمة OpenRouter بالخلفية مرة باليوم
refreshOpenRouter().catch(() => {});
route();
