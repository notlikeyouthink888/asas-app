// شاشة اللعبة: معاينة تعمل دائمًا بالأعلى، وتبويبات: طوّر (طلبات + تطوير تلقائي)، الخطة، الإصدارات.

import { $, $$, esc, toast, ask, sheet, sleep, uid, money, tokens, ago, md, roadmapProgress, android } from './util.js';
import { projects, settings, addVersion } from './store.js';
import { modelFor } from './models.js';
import { buildDoc, exportDoc, createGame, improveGame, autoDevelop, fixGame, describeReport } from './engine.js';
import { go, pickModel, saveFile } from './app.js';

let P = null;          // اللعبة المفتوحة
let runner = null;
let op = null;         // العملية الجارية { ac, kind }
let tab = 'dev';
let fullscreen = false;

const FOCUS = ['إصلاح الأخطاء', 'مراحل ومحتوى أكثر', 'رسوم وتأثيرات أجمل', 'أصوات وموسيقى', 'تحكم لمس أسهل', 'توازن الصعوبة', 'قوائم وإعدادات', 'أداء أسرع'];

/* ── مشغّل اللعبة والاختبار ────────────────────────────── */

const captures = new Map();
window.__onCapture = (id, b64) => { captures.get(id)?.(b64 || null); captures.delete(id); };

function captureFrame(frame) {
  if (!android?.capture) return Promise.resolve(null);
  return new Promise((resolve) => {
    const id = uid();
    captures.set(id, resolve);
    const r = frame.getBoundingClientRect();
    android.capture(id, r.left, r.top, r.width, r.height);
    setTimeout(() => { if (captures.has(id)) { captures.delete(id); resolve(null); } }, 4000);
  });
}

class Runner {
  constructor(frame) {
    this.frame = frame;
    this.errors = [];
    this.testing = false;
    this.pending = null;
    this.onMsg = this.onMsg.bind(this);
    window.addEventListener('message', this.onMsg);
  }

  destroy() { window.removeEventListener('message', this.onMsg); }

  onMsg(e) {
    const d = e.data;
    if (!d || !d.__gs || e.source !== this.frame.contentWindow) return;
    if (d.type === 'error') { this.errors.push(d.error); if (!this.testing) { showErrors(); maybeAutoFix(); } }
    if (d.type === 'storage' && !this.testing && P) { P.storage = d.data; saveSoon(); }
    if (d.type === 'report' && this.pending?.id === d.id) this.pending.resolve(d.report);
  }

  /**
   * كل تشغيل بإطار جديد: نطلب من النسخة السابقة تحرير WebGL والصوت ثم نحذفها،
   * لأن الهاتف يحد عدد السياقات الرسومية فيفشل إنشاء سياق جديد إن تراكمت.
   */
  async load(code, test) {
    this.errors = [];
    this.testing = test;
    this.code = code;
    $('#stage .empty')?.remove();
    const old = this.frame;
    try { old.contentWindow?.postMessage({ __gsCmd: 'release' }, '*'); } catch { /* الإطار حُذف */ }
    await sleep(60);
    const f = document.createElement('iframe');
    f.id = 'game';
    f.setAttribute('sandbox', 'allow-scripts allow-pointer-lock');
    f.setAttribute('allow', 'autoplay; fullscreen; gamepad; accelerometer; gyroscope');
    const loaded = new Promise((r) => f.addEventListener('load', r, { once: true }));
    f.srcdoc = buildDoc(code, { test, storage: JSON.parse(JSON.stringify(P?.storage || {})) });
    if (old.isConnected) old.replaceWith(f); else $('#stage')?.prepend(f);
    this.frame = f;
    await Promise.race([loaded, sleep(8000)]);
  }

  play(code) {
    // إن شُغّلت والتطبيق بالخلفية نعيد تشغيلها عند الرجوع (الرسم كان متوقفًا)
    this.replay = document.hidden;
    showErrors([]);
    return this.load(code, false);
  }

  /**
   * يشغّل اللعبة، يجرب لمسات وأزرارًا، ويرجع تقريرًا (مع لقطة شاشة إن طُلبت).
   * يعمل حتى والتطبيق بالخلفية (المِجس يشغّل حلقة اللعبة بمؤقت)، لكن بلا رسم ولا لقطة، فيُعلَّم hidden
   * ويُعاد التحقق منه تلقائيًا حين ترجع للتطبيق.
   */
  async test(code, { capture = false } = {}) {
    let hidden = document.hidden;
    const onVis = () => { if (document.hidden) hidden = true; };
    document.addEventListener('visibilitychange', onVis);
    try {
      await this.load(code, true);
      await sleep(2200);
      this.frame.contentWindow?.postMessage({ __gsCmd: 'poke' }, '*');
      await sleep(2000);
      const report = (await this.report()) || {
        timeout: true, errors: this.errors, frames: 0, uptime: 0, canvases: [], text: '', buttons: 0, vw: 0, vh: 0, scrollW: 0, scrollH: 0,
      };
      if (capture && !hidden && !document.hidden) report.shot = await captureFrame(this.frame);
      report.hidden = hidden || document.hidden;
      showErrors(report.errors);
      return report;
    } finally {
      document.removeEventListener('visibilitychange', onVis);
      this.testing = false;
    }
  }

  report() {
    return new Promise((resolve) => {
      const id = uid();
      this.pending = { id, resolve: (r) => { this.pending = null; resolve(r); } };
      this.frame.contentWindow?.postMessage({ __gsCmd: 'report', id }, '*');
      // بالخلفية المؤقتات أبطأ، فننتظر أكثر قبل أن نعدّ الصفحة متجمدة
      setTimeout(() => { if (this.pending?.id === id) this.pending.resolve(null); }, document.hidden ? 15000 : 2500);
    });
  }
}

// حفظ مؤجل بحد أقصى مرة كل 800ms (اللعبة قد تحفظ كل إطار، فالتأجيل المتجدد لن يحفظ أبدًا)
let saveTimer = null;
function saveSoon() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; if (P) projects.put(P); }, 800);
}

/* ── إصلاح تلقائي للأخطاء أثناء اللعب ───────────────────── */

// حد الإصلاحات التلقائية المتتالية لكل لعبة، حتى لا يصرف بلا نهاية إن تعذر الإصلاح
const AUTO_FIX_LIMIT = 3;
let autoFixTimer = null;

function autoFixAllowed() {
  return settings.get('autofix', true) && !op && P?.code && runner && !document.hidden && (P.autoFix?.streak || 0) < AUTO_FIX_LIMIT;
}

function startAutoFix(errs, why) {
  const v = P.versions.at(-1);
  P.autoFix = { v: v.n, streak: (P.autoFix?.streak || 0) + 1 };
  addChat('sys', why);
  runOp('fix', modelFor('build'), async (ctx) => {
    const r = await fixGame(ctx, P, errs);
    if (!r.fixed) addChat('ai', '✅ تحققت منها وهي تشتغل بدون أخطاء.');
    else addChat('ai', (r.ok ? '✅ ' : '⚠️ ') + (r.summary || 'صلحت الأخطاء.') + (r.ok ? '' : '\nبقت أخطاء، راح أحاول مرة ثانية من تشغلها.'));
  });
}

/** خطأ ظهر أثناء اللعب ← إصلاح تلقائي (مرة لكل إصدار، وحتى 3 مرات متتالية). */
function maybeAutoFix() {
  if (!autoFixAllowed()) return;
  const v = P.versions?.at(-1);
  if (!v || P.autoFix?.v === v.n || runner.code !== P.code) return;
  if (!runner.errors.some((e) => e.kind !== 'console' && e.kind !== 'resource')) return;
  clearTimeout(autoFixTimer);
  // ننتظر قليلًا حتى تتجمع الأخطاء المرتبطة
  autoFixTimer = setTimeout(() => {
    if (!autoFixAllowed() || P.autoFix?.v === v.n || runner.code !== P.code) return;
    const errs = runner.errors.slice(0, 8);
    startAutoFix(errs, `🔧 ظهر ${errs.length} خطأ أثناء التشغيل (${errs[0]?.msg?.slice(0, 70) || ''})، أصلحه تلقائيًا…`);
  }, 2500);
}

/** إصدار انحفظ بلا اختبار مرئي (التطبيق كان بالخلفية) أو بقيت فيه أخطاء ← نختبره ونصلحه وأنت داخل التطبيق. */
function maybeVerify() {
  const v = P?.versions?.at(-1);
  if (!v || P.verify !== v.n || P.autoFix?.v === v.n || !autoFixAllowed()) return;
  startAutoFix([], '🔍 أتحقق من اللعبة وهي ظاهرة على الشاشة، وإذا بيها خطأ أصلحه…');
}

// الرجوع للتطبيق: إعادة تشغيل اللعبة إن شُغّلت وهو بالخلفية، ثم التحقق منها
document.addEventListener('visibilitychange', () => {
  if (document.hidden || op || !P?.code) return;
  if (runner?.replay) runner.play(P.code);
  setTimeout(maybeVerify, 1200);
});

// رجع الإنترنت بعد أن أوقف انقطاعُه صنعَ لعبة: نكمل تلقائيًا
let resumeOnline = false;
addEventListener('online', () => {
  if (resumeOnline && P && !P.code && !op) { resumeOnline = false; addChat('sys', '📶 رجع الإنترنت، أكمل صنع اللعبة…'); startCreate(); }
});

/** أول عملية: إذن الإشعارات، واستثناء توفير البطارية حتى يكمل الشغل بالخلفية. */
async function askBackgroundOnce() {
  if (!android?.backgroundAllowed) return;
  if (!android.notificationsAllowed() && !settings.get('asked.notif')) {
    settings.set('asked.notif', true);
    android.requestNotifications();
    return;
  }
  if (!android.backgroundAllowed() && !settings.get('asked.bg')) {
    settings.set('asked.bg', true);
    const yes = await ask('حتى يكمل التطبيق شغله وأنت طالع منه بدون ما ينقطع الاتصال، اسمح له يشتغل بالخلفية (استثناء من توفير البطارية).', { ok: 'اسمح', cancel: 'لاحقًا' });
    if (yes) android.requestBackground();
  }
}

/* ── الشاشة ────────────────────────────────────────────── */

export async function projectScreen(app, id) {
  if (P?.id === id && runner && $('#game')) return;
  clearTimeout(autoFixTimer);
  leaveProject();
  P = await projects.get(id);
  if (!P) { toast('اللعبة غير موجودة'); return go(''); }
  tab = 'dev';
  app.className = 'proj';
  app.innerHTML = `
    <header class="top"><button class="icon" id="back">→</button><h2 class="title" id="pname">${esc(P.name)}</h2>
      <button class="icon" id="menu">⋮</button></header>
    <div class="stage" id="stage">
      <iframe id="game" sandbox="allow-scripts allow-pointer-lock" allow="autoplay; fullscreen; gamepad; accelerometer; gyroscope"></iframe>
      ${P.code ? '' : '<div class="empty">اللعبة تُبنى… راح تظهر هنا</div>'}
      <div class="stage-bar"><button id="run">↻ تشغيل</button><button id="fs">⛶ العب</button><button id="tall">↕</button>
        <button id="errs" hidden></button></div>
      <button class="fs-exit" id="fsExit">✕</button>
    </div>
    <nav class="tabs"><button data-tab="dev" class="on">🛠️ طوّر</button><button data-tab="plan">📝 الخطة</button><button data-tab="versions">🕘 الإصدارات</button></nav>
    <section class="page" id="tab"></section>`;
  runner = new Runner($('#game'));
  if (P.code) runner.play(P.code);
  $('#back').onclick = () => { if (!projectBack()) go(''); };
  $('#menu').onclick = menu;
  $('#run').onclick = () => P.code && runner.play(P.code);
  $('#fs').onclick = () => setFullscreen(true);
  $('#fsExit').onclick = () => setFullscreen(false);
  $('#tall').onclick = () => $('#stage').classList.toggle('tall');
  $('#errs').onclick = errorsSheet;
  $$('.tabs button').forEach((b) => (b.onclick = () => { tab = b.dataset.tab; renderTab(); }));
  renderTab();

  // بناء لعبة جديدة مباشرة بعد شاشة الوصف، أو إكمال بناء انقطع
  if (sessionStorage.getItem('gs.autobuild') === P.id) {
    sessionStorage.removeItem('gs.autobuild');
    startCreate();
  } else setTimeout(maybeVerify, 1500);
}

export function leaveProject() {
  if (op) op.ac.abort();
  clearTimeout(autoFixTimer);
  resumeOnline = false;
  if (fullscreen) setFullscreen(false);
  runner?.destroy();
  runner = null;
  if (P) projects.put(P);
  P = null;
}

/** زر الرجوع داخل شاشة اللعبة: يرجع true إن تعامل معه. */
export function projectBack() {
  if (fullscreen) { setFullscreen(false); return true; }
  if (op) { toast('في عملية شغالة — اضغط «إيقاف» أولًا'); return true; }
  return false;
}

function setFullscreen(on) {
  fullscreen = on;
  $('#stage')?.classList.toggle('fs', on);
  android?.fullscreen(on);
  android?.setOrientation(on ? (P?.options?.orientation || 'auto') : 'auto');
}

function renderTab() {
  $$('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  ({ dev: devTab, plan: planTab, versions: versionsTab })[tab]();
}

/* ── تبويب التطوير ─────────────────────────────────────── */

function chatHtml() {
  return (P.chat || []).slice(-60).map((m) => `<div class="msg ${m.role}">${esc(m.text)}</div>`).join('');
}

function addChat(role, text) {
  P.chat ||= [];
  P.chat.push({ role, text, at: Date.now() });
  if (P.chat.length > 150) P.chat.splice(0, P.chat.length - 150);
  const c = $('#chat');
  if (c) { c.innerHTML = chatHtml(); c.lastElementChild?.scrollIntoView({ block: 'nearest' }); }
  saveSoon();
}

function devTab() {
  const auto = settings.get('auto', { rounds: 5, budget: 1, focus: ['إصلاح الأخطاء', 'مراحل ومحتوى أكثر'], extra: '' });
  const bm = modelFor('build'), am = modelFor('auto');
  $('#tab').innerHTML = `
    <div class="card busy" id="busy" hidden>
      <div class="phase"><span class="spin"></span><span id="phase" class="grow">…</span><span class="muted" id="lines"></span></div>
      <div class="progress" id="prog" hidden><i></i></div>
      <div class="think" id="think"></div>
      <pre class="stream" id="stream"></pre>
      <div class="row"><span class="muted grow" id="cost"></span><button class="btn sm danger" id="stop">إيقاف</button></div>
      <div class="log" id="log"></div>
    </div>
    ${!P.code && !op ? `<div class="card warn"><b>صنع اللعبة توقف قبل ما يكمل</b>
      <p class="muted">التقدم محفوظ: ${P.design ? '✅' : '⬜'} الخطة · ${P.draft?.code ? '✅' : '⬜'} الكود. اضغط «أكمل» ويكمل من حيث توقف، بدون ما يعيد الشي اللي خلص.</p>
      <button class="btn primary" id="rebuild">▶ أكمل من حيث توقف</button></div>` : ''}
    <div class="chat" id="chat">${chatHtml()}</div>
    <div class="composer"><textarea id="req" rows="2" placeholder="اطلب أي تعديل: ضيف مرحلة، خلي البطل يطير، غيّر الألوان، صلّح شي…"></textarea>
      <button class="btn primary" id="send">إرسال</button></div>
    <div class="model"><span class="grow"><b>${esc(bm?.name || '—')}</b><span class="muted">ينفذ طلباتك</span></span><button class="btn sm" id="pb">تغيير</button></div>
    <div class="card">
      <h3>🤖 التطوير التلقائي</h3>
      <p class="muted">النموذج يطوّر اللعبة وحده جولة بعد جولة: يشغّلها، يشوف لقطة الشاشة والأخطاء، يصلح، ويضيف ميزات من الخطة.
        كل جولة تنحفظ كإصدار، وإذا انكسرت اللعبة يتراجع تلقائيًا. تگدر تطلع من التطبيق والشغل يكمل (يظهر إشعار).</p>
      <div class="model"><span class="grow"><b>${esc(am?.name || '—')}</b><span class="muted">نموذج التطوير التلقائي</span></span><button class="btn sm" id="pa">تغيير</button></div>
      <label class="field">عدد الجولات: <b id="rv">${auto.rounds}</b><input type="range" id="rounds" min="1" max="20" value="${auto.rounds}"></label>
      <label class="field">أقصى صرف لهذه المرة (دولار)<input type="number" id="budget" min="0.1" step="0.5" value="${auto.budget}"></label>
      <div class="chips" id="focus">${FOCUS.map((f) => `<button class="chip ${auto.focus.includes(f) ? 'on' : ''}">${esc(f)}</button>`).join('')}</div>
      <input type="text" id="extra" placeholder="هدف إضافي (اختياري): مثلًا خلي اللعبة مثل ماريو" value="${esc(auto.extra)}">
      <button class="btn primary" id="auto">▶ ابدأ التطوير التلقائي</button>
    </div>
    <p class="muted">صُرف على هذه اللعبة: ${money(P.spent)} · ${tokens(P.tokens)} رمز</p>`;
  const c = $('#chat');
  c.lastElementChild?.scrollIntoView({ block: 'nearest' });
  const saveAuto = () => settings.set('auto', {
    rounds: +$('#rounds').value, budget: +$('#budget').value || 1,
    focus: $$('#focus .chip.on').map((x) => x.textContent), extra: $('#extra').value,
  });
  $('#rounds').oninput = () => { $('#rv').textContent = $('#rounds').value; saveAuto(); };
  $('#budget').onchange = saveAuto;
  $('#extra').onchange = saveAuto;
  $$('#focus .chip').forEach((x) => (x.onclick = () => { x.classList.toggle('on'); saveAuto(); }));
  $('#pb').onclick = () => pickModel('build', devTab);
  $('#pa').onclick = () => pickModel('auto', devTab);
  $('#send').onclick = sendRequest;
  $('#auto').onclick = startAuto;
  $('#stop').onclick = () => op?.ac.abort();
  $('#rebuild')?.addEventListener('click', startCreate);
  if (op) showBusy(true);
}

/* ── تشغيل العمليات ────────────────────────────────────── */

let streamBuf = '', thinkBuf = '', streamLines = 0, drawQueued = false;
function draw() {
  drawQueued = false;
  const s = $('#stream'), t = $('#think'), l = $('#lines');
  if (s) s.textContent = streamBuf.slice(-1400);
  if (t) t.textContent = thinkBuf ? '💭 ' + thinkBuf.slice(-220) : '';
  if (l) l.textContent = streamLines ? `✍️ ${streamLines} سطر` : '';
}
function queueDraw() { if (!drawQueued) { drawQueued = true; requestAnimationFrame(draw); } }

function showBusy(on) {
  const b = $('#busy');
  if (b) b.hidden = !on;
  ['#send', '#auto', '#rebuild'].forEach((s) => { const x = $(s); if (x) x.disabled = on; });
}

function uiCallbacks() {
  return {
    phase: (t) => {
      const p = $('#phase');
      if (p) p.textContent = t;
      streamBuf = ''; thinkBuf = ''; streamLines = 0;
      queueDraw();
      android?.progress?.(`${P?.name || ''}: ${t}`);
    },
    text: (d) => {
      streamBuf += d;
      for (let i = d.indexOf('\n'); i >= 0; i = d.indexOf('\n', i + 1)) streamLines++;
      if (streamBuf.length > 4000) streamBuf = streamBuf.slice(-2000);
      queueDraw();
    },
    retry: (n, max) => { const l = $('#log'); if (l) l.insertAdjacentHTML('beforeend', `<div>📶 انقطع الاتصال، أنتظر وأعيد المحاولة (${n}/${max})…</div>`); },
    thinking: (d) => { thinkBuf += d; if (thinkBuf.length > 1000) thinkBuf = thinkBuf.slice(-400); queueDraw(); },
    spent: (now) => { const c = $('#cost'); if (c) c.textContent = `صُرف الآن ${money(now)} · كل اللعبة ${money(P?.spent)}`; },
    log: (t) => { const l = $('#log'); if (l) l.insertAdjacentHTML('beforeend', `<div>${esc(t)}</div>`); addChat('sys', t); },
    round: (i, n) => { const g = $('#prog'); if (g) { g.hidden = false; g.firstElementChild.style.width = `${((i - 1) / n) * 100}%`; } },
    version: () => { $('#pname').textContent = P.name; },
  };
}

async function runOp(kind, model, fn) {
  if (op) return toast('في عملية شغالة');
  if (!model) { toast('أضف مفتاحًا واختر نموذجًا من الإعدادات'); return go('settings'); }
  const ac = new AbortController();
  op = { ac, kind };
  const project = P;
  if (kind !== 'fix') P.autoFix = null;
  android?.busy?.(true, `${P.name}: ${OP_TITLES[kind]}`);
  askBackgroundOnce();
  // إعادة رسم التبويب تخفي ما لا يصلح أثناء العملية (مثل «البناء لم يكتمل») وتُظهر لوحة التقدم
  tab = 'dev';
  renderTab();
  const ctx = {
    model, runner, effort: settings.get('effort', 'high'), signal: ac.signal, spent: 0, ui: uiCallbacks(),
    budget: kind === 'auto' ? (+settings.get('auto', {}).budget || 1) : 0,
  };
  let failure = null;
  try {
    await fn(ctx);
  } catch (e) {
    if (e.stop) addChat('sys', 'أوقفت العملية.');
    else {
      failure = e;
      addChat('err', e.message + (kind === 'create' ? '\nالتقدم محفوظ — اضغط «أكمل» ويكمل من حيث توقف.' : ''));
      console.error(e);
      if (e.network && kind === 'create') resumeOnline = true;
    }
  } finally {
    op = null;
    android?.busy?.(false, '');
    // إشعار بالنتيجة إن كان المستخدم خارج التطبيق
    if (document.hidden && !ac.signal.aborted) {
      android?.notifyDone?.(failure ? `⚠️ توقف العمل على «${project.name}»` : `✅ «${project.name}» جاهزة`,
        failure ? `${failure.message} — التقدم محفوظ، ادخل واضغط «أكمل».` : `${OP_TITLES[kind]} خلص. ادخل وجرّبها!`);
    }
    if (P === project) {
      await projects.put(P);
      if (P.code) runner?.play(P.code);
      $('#pname').textContent = P.name;
      renderTab();
      if (ctx.spent) addChat('sys', `تكلفة العملية: ${money(ctx.spent)}`);
      if (!failure) setTimeout(maybeVerify, 1500);
    }
  }
}

const OP_TITLES = { create: 'صنع اللعبة', edit: 'تنفيذ طلبك', auto: 'التطوير التلقائي', fix: 'إصلاح الأخطاء' };

function startCreate() {
  runOp('create', modelFor('build'), async (ctx) => {
    addChat('sys', P.design ? `▶ ${ctx.model.name} يكمل صنع اللعبة من حيث توقف…` : `🎨 ${ctx.model.name} يصمم اللعبة…`);
    P.status = 'building';
    const t = await createGame(ctx, P);
    const errs = t.report?.errors || [];
    const status = t.report?.hidden
      ? '📱 اختبرتها والتطبيق بالخلفية؛ راح أتحقق منها مرة ثانية أول ما تفتحها.'
      : errs.length ? `⚠️ بقت ${errs.length} مشكلة (${errs[0].msg.slice(0, 80)})، راح أكمل إصلاحها تلقائيًا.` : '✅ اختبرتها وتشتغل بدون أخطاء.';
    addChat('ai', `${P.versions.at(-1)?.note || 'الإصدار الأول جاهز'}\n${status}\n\nجرّبها فوق (⛶ العب)، واطلب أي تعديل، أو شغّل التطوير التلقائي.`);
  });
}

function sendRequest() {
  const text = $('#req').value.trim();
  if (!text) return;
  if (!P.code) return toast('اللعبة لم تُبنَ بعد');
  $('#req').value = '';
  addChat('user', text);
  runOp('edit', modelFor('build'), async (ctx) => {
    const r = await improveGame(ctx, P, text);
    addChat('ai', r.summary || 'تم التعديل.');
  });
}

function startAuto() {
  if (!P.code) return toast('اللعبة لم تُبنَ بعد');
  const a = settings.get('auto', { rounds: 5, focus: [], extra: '' });
  const focus = [...(a.focus || []), a.extra].filter(Boolean).join('، ');
  const model = modelFor('auto');
  addChat('sys', `🤖 بدأ التطوير التلقائي: ${a.rounds} جولات بـ ${model?.name || ''}، بحد ${money(+a.budget || 1)}`);
  runOp('auto', model, async (ctx) => {
    try {
      await autoDevelop(ctx, P, { rounds: a.rounds, focus });
      addChat('ai', `خلص التطوير التلقائي. صار عندك ${P.versions.length} إصدار. جرّب اللعبة!`);
    } catch (e) {
      if (e.budget) addChat('sys', '💰 ' + e.message);
      else throw e;
    }
  });
}

/* ── الأخطاء أثناء اللعب ───────────────────────────────── */

function showErrors(list) {
  const b = $('#errs');
  if (!b || !runner) return;
  const errs = list || runner.errors;
  b.hidden = !errs.length;
  b.className = errs.length ? 'badge-err' : '';
  b.textContent = `⚠️ ${errs.length}`;
}

function errorsSheet() {
  const errs = runner?.errors || [];
  const s = sheet(`<div class="row"><h3 class="grow">أخطاء اللعبة</h3><button class="icon" data-close>✕</button></div>
    ${errs.map((e) => `<div class="card err ltr"><b>${esc(e.msg)}</b><span class="muted">${e.line ? 'line ' + e.line : ''} ${e.count > 1 ? '×' + e.count : ''}</span></div>`).join('') || '<p class="muted">ماكو أخطاء.</p>'}
    ${errs.length ? '<button class="btn primary" id="fixErr">🔧 اطلب إصلاحها</button>' : ''}`);
  $('#fixErr', s.el)?.addEventListener('click', () => {
    s.close();
    const text = 'صلّح هذه الأخطاء اللي تظهر أثناء اللعب:\n' + errs.slice(0, 6).map((e) => `- ${e.msg}${e.line ? ` (line ${e.line})` : ''}`).join('\n');
    tab = 'dev';
    renderTab();
    $('#req').value = text;
    sendRequest();
  });
}

/* ── الخطة ─────────────────────────────────────────────── */

function planTab(edit = false) {
  const pr = roadmapProgress(P.roadmap);
  $('#tab').innerHTML = edit ? `
    <label class="field">تصميم اللعبة<textarea id="design" rows="12">${esc(P.design)}</textarea></label>
    <label class="field">خطة التطوير (- [ ] للمطلوب، - [x] للمنجز)<textarea id="roadmap" rows="10">${esc(P.roadmap)}</textarea></label>
    <label class="field">تعليمات خاصة لهذه اللعبة (اختياري) — النموذج يلتزم بيها بكل طلب وتطوير
      <textarea id="instr" rows="4" placeholder="مثلًا: لا تغيّر شكل البطل، خلي الألوان هادئة، كل النصوص بالعراقي">${esc(P.instructions || '')}</textarea></label>
    <div class="row end"><button class="btn ghost" id="cancel">إلغاء</button><button class="btn primary" id="save">حفظ</button></div>`
    : `<div class="card plan">
        <div class="row"><h3 class="grow">خطة التطوير</h3><span class="muted">${pr.total ? `${pr.done}/${pr.total} منجز` : ''}</span></div>
        ${pr.total ? `<div class="progress"><i style="width:${(pr.done / pr.total) * 100}%"></i></div>` : ''}
        ${md(P.roadmap) || '<p class="muted">ماكو خطة بعد.</p>'}</div>
      <div class="card plan"><h3>تصميم اللعبة</h3>${md(P.design) || '<p class="muted">ماكو تصميم بعد.</p>'}</div>
      ${P.instructions ? `<div class="card"><h3>تعليماتك الخاصة لهذه اللعبة</h3><p>${esc(P.instructions)}</p></div>` : ''}
      ${P.description ? `<div class="card"><h3>وصفك الأصلي</h3><p>${esc(P.description)}</p></div>` : ''}
      <button class="btn" id="edit">✏️ عدّل الخطة بنفسك</button>
      <p class="muted">التطوير التلقائي يمشي على هذه الخطة بندًا بندًا، فأي شي تضيفه هنا راح يسويه.</p>`;
  if (edit) {
    $('#cancel').onclick = () => planTab();
    $('#save').onclick = async () => {
      P.design = $('#design').value;
      P.roadmap = $('#roadmap').value;
      P.instructions = $('#instr').value.trim();
      await projects.put(P);
      toast('انحفظت');
      planTab();
    };
  } else $('#edit').onclick = () => planTab(true);
}

/* ── الإصدارات ─────────────────────────────────────────── */

function versionsTab() {
  const vs = [...(P.versions || [])].reverse();
  $('#tab').innerHTML = vs.length ? vs.map((v) => `
    <div class="card"><div class="row"><b class="grow">الإصدار ${v.n}${v.code === P.code ? ' · الحالي' : ''}</b><span class="muted">${ago(v.at)}</span></div>
      <p>${esc(v.note || '')}</p>
      <div class="row"><button class="btn sm" data-try="${v.n}">▶ جرّب</button>
        ${v.code === P.code ? '' : `<button class="btn sm" data-restore="${v.n}">↩ استرجع</button>`}
        <span class="muted grow">${(v.code.length / 1024).toFixed(0)}KB</span></div></div>`).join('')
    : '<p class="muted">ماكو إصدارات بعد.</p>';
  const find = (n) => P.versions.find((v) => v.n === +n);
  $$('[data-try]').forEach((b) => (b.onclick = () => { runner.play(find(b.dataset.try).code); toast('تعمل الآن نسخة الإصدار ' + b.dataset.try); }));
  $$('[data-restore]').forEach((b) => (b.onclick = async () => {
    if (op) return toast('في عملية شغالة');
    const v = find(b.dataset.restore);
    addVersion(P, v.code, `استرجاع الإصدار ${v.n}`);
    await projects.put(P);
    runner.play(P.code);
    addChat('sys', `↩ رجعت للإصدار ${v.n}`);
    versionsTab();
  }));
}

/* ── القائمة ───────────────────────────────────────────── */

function fileName() {
  return (P.name || 'game').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) + '.html';
}

function menu() {
  const s = sheet(`<div class="row"><h3 class="grow">${esc(P.name)}</h3><button class="icon" data-close>✕</button></div>
    <button class="opt" data-a="share">📤 مشاركة اللعبة (ملف HTML يشتغل بأي متصفح)</button>
    <button class="opt" data-a="download">💾 حفظ في التنزيلات</button>
    <button class="opt" data-a="code">🧾 عرض وتعديل الكود</button>
    <button class="opt" data-a="report">🩺 آخر تقرير اختبار</button>
    <button class="opt" data-a="rename">✏️ إعادة التسمية</button>
    <button class="opt" data-a="delete">🗑️ حذف اللعبة</button>`);
  s.el.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (!a) return;
    s.close();
    if ((a === 'code' || a === 'delete') && op) return toast('في عملية شغالة');
    if (!P.code && ['share', 'download', 'code', 'report'].includes(a)) return toast('اللعبة لم تُبنَ بعد');
    if (a === 'share') saveFile(fileName(), exportDoc(P.code), 'text/html');
    if (a === 'download') saveFile(fileName(), exportDoc(P.code), 'text/html', { downloads: true });
    if (a === 'code') codeSheet();
    if (a === 'report') reportSheet();
    if (a === 'rename') renameSheet();
    if (a === 'delete' && (await ask(`حذف «${P.name}» وكل إصداراتها؟`, { ok: 'حذف', danger: true }))) {
      const id = P.id;
      P = null;
      await projects.del(id);
      go('');
    }
  });
}

function codeSheet() {
  const s = sheet(`<div class="row"><h3 class="grow">الكود</h3><button class="icon" data-close>✕</button></div>
    <textarea class="code" id="code" spellcheck="false">${esc(P.code)}</textarea>
    <div class="row end"><button class="btn sm" id="copy">نسخ</button><button class="btn sm primary" id="saveCode">حفظ كإصدار جديد</button></div>`);
  $('#copy', s.el).onclick = () => navigator.clipboard?.writeText(P.code).then(() => toast('انتسخ'), () => toast('تعذر النسخ'));
  $('#saveCode', s.el).onclick = async () => {
    const code = $('#code', s.el).value;
    if (code === P.code) return s.close();
    addVersion(P, code, 'تعديل يدوي للكود');
    await projects.put(P);
    runner.play(P.code);
    s.close();
    toast('انحفظ');
  };
}

function reportSheet() {
  const text = P.lastReport ? describeReport(P.lastReport, P.code) : 'ماكو تقرير بعد.';
  sheet(`<div class="row"><h3 class="grow">آخر تقرير اختبار</h3><button class="icon" data-close>✕</button></div>
    <pre class="stream ltr" style="height:auto;max-height:60vh;overflow:auto;display:block">${esc(text)}</pre>`);
}

function renameSheet() {
  const s = sheet(`<h3>إعادة التسمية</h3><input type="text" id="nn" value="${esc(P.name)}">
    <div class="row end"><button class="btn ghost" data-close>إلغاء</button><button class="btn primary" id="ok">حفظ</button></div>`);
  $('#ok', s.el).onclick = async () => {
    P.name = $('#nn', s.el).value.trim() || P.name;
    $('#pname').textContent = P.name;
    await projects.put(P);
    s.close();
  };
}
