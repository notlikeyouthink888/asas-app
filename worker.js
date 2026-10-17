/**
 * خادم «أساس» لمدير التطبيق — Cloudflare Workers + قاعدة D1 (الخطة المجانية تكفي).
 *
 * لماذا؟ حتى ينشر المدير التطبيق للناس دون أن يحتاج أحد مفتاحًا، ويبقى هو المتحكم:
 *  - مفاتيح API كلها هنا (OpenRouter أو Claude)، ولا تصل إلى أجهزة الناس أبدًا.
 *  - تبديل تلقائي للمفتاح التالي حين تنتهي حصة مفتاح أو رصيده، مع تنبيه للمدير.
 *  - المدير يختار النماذج التي تكتب لكل المستخدمين، والحد اليومي لكل جهاز، ويوقف أي جهاز.
 *  - سجل بكل التقارير (العنوان، النوع، المادة، الاسم، النص) ورسالة لكل تقرير على تيليغرام إن أراد.
 *  - التطبيق يُعلم المستخدمين بأن تقاريرهم تصل إلى مدير التطبيق.
 *
 * النشر من لوحة Cloudflare (مرة واحدة، من الهاتف أيضًا):
 *   1. Storage & Databases ← D1 ← Create ← الاسم: asas-db
 *   2. Workers & Pages ← Create ← Worker ← الاسم: asas-server ← Deploy ← Edit code ← الصق هذا الملف ← Deploy
 *   3. إعدادات الـ Worker ← Bindings ← Add ← D1 database ← Variable name: DB ← asas-db
 *   4. إعدادات الـ Worker ← Variables and Secrets ← Add ← Secret ← ADMIN_PASSWORD = كلمة سر المدير
 *   5. في التطبيق: الإعدادات ← لوحة مدير التطبيق ← الصق رابط الـ Worker وكلمة السر.
 * أو بسطر الأوامر: انظر server/wrangler.toml.
 *
 * المسارات:
 *   GET  /api/config                    إعدادات التطبيق العامة (للمستخدمين)
 *   POST /api/log                       سجل تقرير انتهى (العنوان والنص)
 *   *    /or/api/v1/...                 بديل OpenRouter (models، key، chat/completions)
 *   POST /anthropic/v1/messages         بديل Claude (و/v1/messages للتوافق مع الخادم الوسيط القديم)
 *   *    /admin/...                     لوحة المدير (Authorization: Bearer ADMIN_PASSWORD)
 */

const OR_BASE = 'https://openrouter.ai/api/v1';
const AN_BASE = 'https://api.anthropic.com';
const TG_BASE = 'https://api.telegram.org';
const CLAUDE_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'];
const FREE_ROUTER = 'openrouter/free';

const DEFAULT_CONFIG = {
  appName: 'أساس',
  provider: 'openrouter',      // ما يكتب به المستخدمون: openrouter | anthropic
  textModels: [],              // [{ id, name, vision, structured }] حتى ثلاثة، بالترتيب (بدائل تلقائية)
  visionModel: null,           // { id, name } للتحقق من الصور
  claudeModel: 'claude-sonnet-5-5',
  dailyLimit: 10,              // تقارير لكل جهاز في اليوم (0 = بلا حد)
  open: true,                  // يقبل أجهزة جديدة
  lock: false,                 // يمنع المستخدمين من التحويل إلى مفاتيحهم
  notice: '',                  // رسالة تظهر للمستخدمين في التطبيق
  telegram: { token: '', chat: '' },
  notify: { reports: true, keys: true, users: true },
};

const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS settings (k TEXT PRIMARY KEY, v TEXT NOT NULL)',
  `CREATE TABLE IF NOT EXISTS keys (id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT, provider TEXT, secret TEXT,
    enabled INTEGER DEFAULT 1, status TEXT DEFAULT 'ok', until INTEGER DEFAULT 0, note TEXT DEFAULT '',
    uses INTEGER DEFAULT 0, day TEXT DEFAULT '', today INTEGER DEFAULT 0, last_used INTEGER DEFAULT 0, created INTEGER)`,
  `CREATE TABLE IF NOT EXISTS devices (id TEXT PRIMARY KEY, name TEXT DEFAULT '', first_seen INTEGER, last_seen INTEGER,
    reports INTEGER DEFAULT 0, requests INTEGER DEFAULT 0, blocked INTEGER DEFAULT 0, platform TEXT DEFAULT '')`,
  `CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, device TEXT, kind TEXT,
    report TEXT, title TEXT, model TEXT, key_id INTEGER, status INTEGER, ms INTEGER)`,
  `CREATE TABLE IF NOT EXISTS reports (id TEXT PRIMARY KEY, device TEXT, name TEXT, ts INTEGER, title TEXT, type TEXT,
    subject TEXT, lang TEXT, words INTEGER, status TEXT, model TEXT, people TEXT, uni TEXT, text TEXT)`,
  'CREATE INDEX IF NOT EXISTS ev_dev ON events(device, kind, ts)',
  'CREATE INDEX IF NOT EXISTS rp_ts ON reports(ts)',
];

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'access-control-allow-headers': '*',
  'access-control-expose-headers': '*',
  'access-control-max-age': '86400',
};

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json; charset=utf-8' } });
/** خطأ بصيغة OpenRouter؛ «ASAS: » يجعل التطبيق يعرض الرسالة كما هي. */
const orErr = (status, msg) => json({ error: { code: status, message: `ASAS: ${msg}` } }, status);
const anErr = (status, type, msg) => json({ type: 'error', error: { type, message: `ASAS: ${msg}` } }, status);

const DAY = 86400000;
const now = () => Date.now();
const dayKey = (t = now()) => new Date(t).toISOString().slice(0, 10);
const dayStart = (t = now()) => Math.floor(t / DAY) * DAY;
const mask = (s) => (s ? `•••${String(s).slice(-4)}` : '');
const clip = (s, n) => String(s ?? '').slice(0, n);
const dec = (s) => { try { return decodeURIComponent(s || ''); } catch { return String(s || ''); } };

/* ── قاعدة البيانات ─────────────────────────────────── */

let ready = null;
function init(env) {
  if (!env.DB) throw new Error('NO_DB');
  ready ||= env.DB.batch(SCHEMA.map((s) => env.DB.prepare(s))).catch((e) => { ready = null; throw e; });
  return ready;
}
const q = (env, sql, ...args) => env.DB.prepare(sql).bind(...args);

async function getConfig(env) {
  const row = await q(env, 'SELECT v FROM settings WHERE k = ?', 'config').first();
  let saved = {};
  try { saved = row ? JSON.parse(row.v) : {}; } catch { saved = {}; }
  return { ...DEFAULT_CONFIG, ...saved, telegram: { ...DEFAULT_CONFIG.telegram, ...(saved.telegram || {}) }, notify: { ...DEFAULT_CONFIG.notify, ...(saved.notify || {}) } };
}
const saveConfig = (env, cfg) => q(env, 'INSERT INTO settings (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v', 'config', JSON.stringify(cfg)).run();

/* ── تيليغرام ─────────────────────────────────────── */

async function telegram(env, cfg, text, file = null) {
  const { token, chat } = cfg.telegram || {};
  if (!token || !chat) return { ok: false, error: 'لم يُضبط بوت تيليغرام' };
  const base = `${env.TELEGRAM_API || TG_BASE}/bot${token}`;
  try {
    let res;
    if (file) {
      const fd = new FormData();
      fd.append('chat_id', chat);
      fd.append('caption', clip(text, 1000));
      fd.append('document', new Blob([file.content], { type: 'text/markdown' }), file.name);
      res = await fetch(`${base}/sendDocument`, { method: 'POST', body: fd });
    } else {
      res = await fetch(`${base}/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: chat, text: clip(text, 4000), disable_web_page_preview: true }) });
    }
    const body = await res.json().catch(() => ({}));
    return body.ok ? { ok: true } : { ok: false, error: body.description || `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

/* ── المفاتيح ─────────────────────────────────────── */

const KEY_STATUS = { daily: 'انتهت حصته اليومية', minute: 'تجاوز حد الدقيقة', credits: 'رصيده انتهى', invalid: 'مرفوض (مفتاح خاطئ أو محذوف)' };

/** حكم استجابة فاشلة على المفتاح: هل نجرب المفتاح التالي؟ */
function verdictOf(provider, status, text) {
  const t = String(text || '');
  if (status === 401 || (status === 403 && provider === 'anthropic')) return 'invalid';
  if (status === 402) return 'credits';
  if (provider === 'anthropic') {
    if (status === 400 && /credit balance|billing/i.test(t)) return 'credits';
    if (status === 429) return 'minute';
    return null;
  }
  if (status === 429) {
    if (/per-day|per day|daily|free-models-per-day/i.test(t)) return 'daily';
    if (/free-models-per-min|per-minute|per minute/i.test(t)) return 'minute';
    return /upstream|provider|temporarily/i.test(t) ? null : 'minute';
  }
  return null;
}

function untilFor(verdict) {
  if (verdict === 'daily') return dayStart() + DAY + 60000; // بعد منتصف الليل (UTC) بدقيقة
  if (verdict === 'minute') return now() + 65000;
  if (verdict === 'credits') return now() + 2 * 3600000;
  return 9e15; // مرفوض: حتى يعيد المدير تفعيله
}

async function pickKey(env, provider, tried) {
  const { results } = await q(env, 'SELECT * FROM keys WHERE provider = ? AND enabled = 1 AND until <= ? ORDER BY id', provider, now()).all();
  return results.find((k) => !tried.has(k.id)) || null;
}

async function markKey(env, cfg, key, verdict, detail, ctx) {
  let note = String(detail || '');
  try { const e = JSON.parse(note); note = e.error?.message || e.message || note; } catch { /* نص */ }
  await q(env, 'UPDATE keys SET status = ?, until = ?, note = ? WHERE id = ?', verdict, untilFor(verdict), clip(note, 200), key.id).run();
  if (verdict !== 'minute' && cfg.notify.keys) {
    ctx.waitUntil(telegram(env, cfg, `⚠️ مفتاح «${key.label}» ${KEY_STATUS[verdict]}.\nصار الخادم يستعمل المفتاح التالي تلقائيًا.`));
  }
}

async function useKey(env, key) {
  const d = dayKey();
  await q(env, 'UPDATE keys SET uses = uses + 1, today = CASE WHEN day = ? THEN today + 1 ELSE 1 END, day = ?, last_used = ?, status = CASE WHEN status = \'minute\' THEN \'ok\' ELSE status END WHERE id = ?', d, d, now(), key.id).run();
}

/* ── الأجهزة ──────────────────────────────────────── */

function deviceOf(req) {
  const id = String(req.headers.get('x-asas-device') || '').trim();
  return {
    id: /^[\w-]{8,64}$/.test(id) ? id : '',
    name: clip(dec(req.headers.get('x-asas-name')).trim(), 60),
    platform: clip(req.headers.get('x-asas-platform') || '', 20),
  };
}

function metaOf(req) {
  const g = (k, n = 200) => clip(dec(req.headers.get(`x-asas-${k}`)), n);
  return { kind: g('kind', 20) || 'other', report: g('report', 64), title: g('title'), type: g('type', 30), subject: g('subject', 60) };
}

/** يسجّل الجهاز ويتحقق من الإيقاف والحدود. يعيد Response خطأ أو null. */
async function admit(env, cfg, ctx, dev, meta, fmt) {
  const fail = fmt === 'anthropic' ? (s, m) => anErr(s, s === 429 ? 'rate_limit_error' : 'permission_error', m) : orErr;
  if (!dev.id) return fail(400, 'التطبيق قديم أو معطوب: حدّثه من المدير.');
  const row = await q(env, 'SELECT blocked FROM devices WHERE id = ?', dev.id).first();
  if (!row && !cfg.open) return fail(403, 'مدير التطبيق أغلق التسجيل لأجهزة جديدة حاليًا.');
  if (row?.blocked) return fail(403, 'أوقف مدير التطبيق هذا الجهاز. تواصل معه.');
  const t = now();
  await q(env, `INSERT INTO devices (id, name, first_seen, last_seen, requests, platform) VALUES (?, ?, ?, ?, 1, ?)
    ON CONFLICT(id) DO UPDATE SET last_seen = excluded.last_seen, requests = requests + 1,
    name = CASE WHEN excluded.name <> '' THEN excluded.name ELSE name END`, dev.id, dev.name, t, t, dev.platform).run();
  if (!row && cfg.notify.users) ctx.waitUntil(telegram(env, cfg, `👤 مستخدم جديد: ${dev.name || 'بلا اسم'} (${dev.platform || 'جهاز'})`));
  // حماية من الإغراق: 40 طلبًا في الدقيقة للجهاز
  const burst = await q(env, 'SELECT COUNT(*) AS n FROM events WHERE device = ? AND ts > ?', dev.id, t - 60000).first();
  if (burst?.n >= 40) return fail(429, 'طلبات كثيرة جدًا خلال دقيقة، انتظر قليلًا.');
  if (meta.kind === 'report' && cfg.dailyLimit > 0) {
    const used = await q(env, 'SELECT COUNT(DISTINCT report) AS n FROM events WHERE device = ? AND kind = \'report\' AND ts >= ? AND report <> ?', dev.id, dayStart(t), meta.report).first();
    if (used?.n >= cfg.dailyLimit) return fail(429, `وصلت حدّك اليومي (${cfg.dailyLimit} تقارير). يتجدد غدًا، أو تواصل مع مدير التطبيق.`);
  }
  return null;
}

function logEvent(env, ctx, dev, meta, model, keyId, status, ms) {
  ctx.waitUntil(q(env, 'INSERT INTO events (ts, device, kind, report, title, model, key_id, status, ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    now(), dev.id, meta.kind, meta.report, meta.title, model, keyId, status, ms).run().catch(() => {}));
}

/* ── بديل OpenRouter ──────────────────────────────── */

function modelsList(cfg) {
  const all = [...cfg.textModels, ...(cfg.visionModel ? [{ ...cfg.visionModel, vision: true }] : [])];
  const seen = new Set();
  return {
    data: all.filter((m) => m?.id && !seen.has(m.id) && seen.add(m.id)).map((m) => ({
      id: m.id, name: m.name || m.id, context_length: m.ctx || 131072,
      architecture: { input_modalities: m.vision ? ['text', 'image'] : ['text'], output_modalities: ['text'] },
      pricing: { prompt: '0', completion: '0', request: '0' },
      top_provider: { context_length: m.ctx || 131072, max_completion_tokens: m.maxOut || null },
      supported_parameters: ['max_tokens', 'temperature', ...(m.json || m.structured ? ['response_format'] : []), ...(m.structured ? ['structured_outputs'] : [])],
    })),
  };
}

async function proxyOpenRouter(req, env, ctx, path) {
  const cfg = await getConfig(env);
  if (path === '/models') return json(modelsList(cfg));
  if (path === '/key') return json({ data: { label: 'خادم التطبيق', limit: null, usage: 0, is_free_tier: false } });
  if (path !== '/chat/completions' || req.method !== 'POST') return orErr(404, 'مسار غير مدعوم');
  if (cfg.provider !== 'openrouter') return orErr(409, 'غيّر مدير التطبيق طريقة الكتابة؛ أعد فتح التطبيق.');
  const dev = deviceOf(req);
  const meta = metaOf(req);
  const denied = await admit(env, cfg, ctx, dev, meta, 'openrouter');
  if (denied) return denied;

  let body;
  try { body = await req.json(); } catch { return orErr(400, 'طلب غير صالح'); }
  const vision = JSON.stringify(body.messages || []).includes('"image_url"');
  // النماذج يختارها المدير وحده
  const chain = vision
    ? [cfg.visionModel?.id, ...cfg.textModels.filter((m) => m.vision).map((m) => m.id)]
    : cfg.textModels.map((m) => m.id);
  const models = [...new Set([...chain.filter(Boolean), FREE_ROUTER])].slice(0, 3);
  body.models = models;
  body.model = models[0];
  body.max_tokens = Math.min(Number(body.max_tokens) || 4000, 16000);

  const base = env.OR_UPSTREAM || OR_BASE;
  const tried = new Set();
  for (;;) {
    const key = await pickKey(env, 'openrouter', tried);
    if (!key) {
      logEvent(env, ctx, dev, meta, models[0], null, 503, 0);
      if (cfg.notify.keys) ctx.waitUntil(telegram(env, cfg, '❌ كل مفاتيح OpenRouter انتهت حصتها أو تعطلت. أضف مفتاحًا جديدًا من لوحة المدير.'));
      return orErr(503, 'انتهت حصة خادم التطبيق مؤقتًا. أخبر مدير التطبيق أو حاول لاحقًا.');
    }
    tried.add(key.id);
    const t0 = now();
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key.secret}`, 'x-title': 'Asas Reports' },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      ctx.waitUntil(useKey(env, key));
      logEvent(env, ctx, dev, meta, models[0], key.id, res.status, now() - t0);
      const h = new Headers(CORS);
      h.set('content-type', res.headers.get('content-type') || 'application/json');
      return new Response(res.body, { status: res.status, headers: h });
    }
    const text = await res.text();
    const verdict = verdictOf('openrouter', res.status, text);
    if (verdict) { await markKey(env, cfg, key, verdict, text, ctx); continue; }
    logEvent(env, ctx, dev, meta, models[0], key.id, res.status, now() - t0);
    return new Response(text, { status: res.status, headers: { ...CORS, 'content-type': 'application/json' } });
  }
}

/* ── بديل Claude ──────────────────────────────────── */

async function proxyAnthropic(req, env, ctx) {
  const cfg = await getConfig(env);
  if (cfg.provider !== 'anthropic') return anErr(409, 'invalid_request_error', 'غيّر مدير التطبيق طريقة الكتابة؛ أعد فتح التطبيق.');
  const dev = deviceOf(req);
  const meta = metaOf(req);
  const denied = await admit(env, cfg, ctx, dev, meta, 'anthropic');
  if (denied) return denied;
  let body;
  try { body = await req.json(); } catch { return anErr(400, 'invalid_request_error', 'طلب غير صالح'); }
  body.model = CLAUDE_MODELS.includes(cfg.claudeModel) ? cfg.claudeModel : 'claude-sonnet-5-5';
  body.max_tokens = Math.min(Number(body.max_tokens) || 4000, 64000);
  const haiku = body.model === 'claude-haiku-5-5';
  if (haiku) delete body.fallbacks;
  const beta = String(req.headers.get('anthropic-beta') || '').split(',').map((s) => s.trim())
    .filter((b) => b && !(haiku && b.startsWith('server-side-fallback'))).join(',');

  const base = env.ANTHROPIC_UPSTREAM || AN_BASE;
  const tried = new Set();
  for (;;) {
    const key = await pickKey(env, 'anthropic', tried);
    if (!key) {
      logEvent(env, ctx, dev, meta, body.model, null, 503, 0);
      if (cfg.notify.keys) ctx.waitUntil(telegram(env, cfg, '❌ كل مفاتيح Claude انتهى رصيدها أو تعطلت. أضف مفتاحًا من لوحة المدير.'));
      return anErr(503, 'overloaded_error', 'انتهت حصة خادم التطبيق مؤقتًا. أخبر مدير التطبيق أو حاول لاحقًا.');
    }
    tried.add(key.id);
    const h = new Headers({ 'content-type': 'application/json', 'x-api-key': key.secret, 'anthropic-version': req.headers.get('anthropic-version') || '2023-06-01' });
    if (beta) h.set('anthropic-beta', beta);
    const t0 = now();
    const res = await fetch(`${base}/v1/messages`, { method: 'POST', headers: h, body: JSON.stringify(body) });
    if (res.ok) {
      ctx.waitUntil(useKey(env, key));
      logEvent(env, ctx, dev, meta, body.model, key.id, res.status, now() - t0);
      const out = new Headers(res.headers);
      Object.entries(CORS).forEach(([k, v]) => out.set(k, v));
      return new Response(res.body, { status: res.status, headers: out });
    }
    const text = await res.text();
    const verdict = verdictOf('anthropic', res.status, text);
    if (verdict) { await markKey(env, cfg, key, verdict, text, ctx); continue; }
    logEvent(env, ctx, dev, meta, body.model, key.id, res.status, now() - t0);
    return new Response(text, { status: res.status, headers: { ...CORS, 'content-type': 'application/json' } });
  }
}

/* ── المستخدمون: الإعدادات العامة وسجل التقارير ────────── */

async function publicConfig(req, env) {
  const cfg = await getConfig(env);
  const dev = deviceOf(req);
  const used = dev.id
    ? (await q(env, 'SELECT COUNT(DISTINCT report) AS n FROM events WHERE device = ? AND kind = \'report\' AND ts >= ?', dev.id, dayStart()).first())?.n || 0
    : 0;
  const keys = (await q(env, 'SELECT COUNT(*) AS n FROM keys WHERE provider = ? AND enabled = 1 AND until <= ?', cfg.provider === 'anthropic' ? 'anthropic' : 'openrouter', now()).first())?.n || 0;
  return json({
    ok: true,
    appName: cfg.appName,
    provider: cfg.provider,
    models: cfg.provider === 'anthropic' ? [{ id: cfg.claudeModel, name: cfg.claudeModel }] : cfg.textModels.map((m) => ({ id: m.id, name: m.name })),
    claudeModel: cfg.claudeModel,
    dailyLimit: cfg.dailyLimit,
    usedToday: used,
    lock: !!cfg.lock,
    notice: cfg.notice || '',
    ready: keys > 0,
  });
}

function reportFile(r) {
  const head = [`# ${r.title}`, '', `- الطالب: ${r.name || '—'}${r.people ? ` (${r.people})` : ''}`, `- النوع: ${r.type || '—'} — المادة: ${r.subject || '—'}`,
    `- الجامعة: ${r.uni || '—'}`, `- الكلمات: ${r.words || 0} — النموذج: ${r.model || '—'}`, `- التاريخ: ${new Date(r.ts).toISOString().replace('T', ' ').slice(0, 16)} UTC`, '', '---', ''];
  return head.join('\n') + (r.text || '');
}

async function logReport(req, env, ctx) {
  const cfg = await getConfig(env);
  const dev = deviceOf(req);
  if (!dev.id) return json({ ok: false }, 400);
  let b;
  try { b = await req.json(); } catch { return json({ ok: false }, 400); }
  const id = clip(b.id, 64);
  if (!id) return json({ ok: false }, 400);
  const prev = await q(env, 'SELECT status FROM reports WHERE id = ?', id).first();
  const r = {
    id, device: dev.id, name: clip(b.name || dev.name, 80), ts: now(), title: clip(b.title, 300), type: clip(b.type, 60), subject: clip(b.subject, 80),
    lang: clip(b.lang, 8), words: Number(b.words) || 0, status: clip(b.status, 20), model: clip(b.model, 100), people: clip(b.people, 400), uni: clip(b.uni, 200),
    text: clip(b.text, 300000),
  };
  await q(env, `INSERT INTO reports (id, device, name, ts, title, type, subject, lang, words, status, model, people, uni, text)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET ts = excluded.ts, title = excluded.title, words = excluded.words, status = excluded.status,
    model = excluded.model, people = excluded.people, text = excluded.text, name = excluded.name`,
  r.id, r.device, r.name, r.ts, r.title, r.type, r.subject, r.lang, r.words, r.status, r.model, r.people, r.uni, r.text).run();
  await q(env, `INSERT INTO devices (id, name, first_seen, last_seen, platform) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET last_seen = excluded.last_seen, name = CASE WHEN excluded.name <> '' THEN excluded.name ELSE name END`,
  dev.id, r.name, r.ts, r.ts, dev.platform).run();
  if (r.status === 'ready' && prev?.status !== 'ready') {
    await q(env, 'UPDATE devices SET reports = reports + 1 WHERE id = ?', dev.id).run();
    if (cfg.notify.reports) {
      const caption = `📄 تقرير جديد\n${r.title}\n👤 ${r.name || 'بلا اسم'}${r.people ? ` — ${r.people}` : ''}\n📚 ${[r.type, r.subject].filter(Boolean).join(' — ')}\n📝 ${r.words} كلمة — ${r.model || 'دون اتصال'}`;
      const safe = r.title.replace(/[\\/:*?"<>|\n]+/g, ' ').slice(0, 60) || 'report';
      ctx.waitUntil(telegram(env, cfg, caption, { name: `${safe}.md`, content: reportFile(r) }));
    }
  }
  return json({ ok: true });
}

/* ── لوحة المدير ──────────────────────────────────── */

function adminOk(req, env) {
  const pw = String(env.ADMIN_PASSWORD || '');
  const got = String(req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!pw || got.length !== pw.length) return false;
  let diff = 0;
  for (let i = 0; i < pw.length; i++) diff |= pw.charCodeAt(i) ^ got.charCodeAt(i);
  return diff === 0;
}

const keyView = (k) => {
  const t = now();
  const active = k.until > t;
  return {
    id: k.id, label: k.label, provider: k.provider, hint: mask(k.secret), enabled: !!k.enabled,
    status: !k.enabled ? 'off' : active ? k.status : 'ok', until: active ? k.until : 0, note: active ? k.note : '',
    uses: k.uses, today: k.day === dayKey() ? k.today : 0, lastUsed: k.last_used,
  };
};

const configView = (cfg) => ({ ...cfg, telegram: { chat: cfg.telegram.chat, token: mask(cfg.telegram.token), hasToken: !!cfg.telegram.token } });

async function admin(req, env, ctx, path) {
  if (!env.ADMIN_PASSWORD) return json({ error: 'لم تُضبط كلمة سر المدير ADMIN_PASSWORD على الخادم' }, 500);
  if (!adminOk(req, env)) return json({ error: 'كلمة سر المدير غير صحيحة' }, 401);
  const m = req.method;
  const body = m === 'GET' || m === 'DELETE' ? {} : await req.json().catch(() => ({}));
  const url = new URL(req.url);
  const seg = path.split('/').filter(Boolean); // ['admin', …]

  if (path === '/admin/state' && m === 'GET') {
    const cfg = await getConfig(env);
    const t0 = dayStart();
    const [keys, devices, today, total, reqs] = await Promise.all([
      q(env, 'SELECT * FROM keys ORDER BY id').all(),
      q(env, 'SELECT COUNT(*) AS n FROM devices').first(),
      q(env, 'SELECT COUNT(*) AS n FROM reports WHERE ts >= ? AND status = \'ready\'', t0).first(),
      q(env, 'SELECT COUNT(*) AS n FROM reports WHERE status = \'ready\'').first(),
      q(env, 'SELECT COUNT(*) AS n FROM events WHERE ts >= ?', t0).first(),
    ]);
    return json({ config: configView(cfg), keys: keys.results.map(keyView), stats: { devices: devices?.n || 0, reportsToday: today?.n || 0, reportsTotal: total?.n || 0, requestsToday: reqs?.n || 0 }, now: now() });
  }

  if (path === '/admin/config' && m === 'PUT') {
    const cfg = await getConfig(env);
    const next = { ...cfg };
    if (typeof body.appName === 'string') next.appName = clip(body.appName.trim(), 40) || 'أساس';
    if (['openrouter', 'anthropic'].includes(body.provider)) next.provider = body.provider;
    if (Array.isArray(body.textModels)) next.textModels = body.textModels.filter((x) => x?.id).slice(0, 3).map((x) => ({ id: clip(x.id, 120), name: clip(x.name || x.id, 80), vision: !!x.vision, structured: !!x.structured, json: !!x.json, ctx: Number(x.ctx) || 0, maxOut: Number(x.maxOut) || 0 }));
    if (body.visionModel === null || body.visionModel?.id) next.visionModel = body.visionModel ? { id: clip(body.visionModel.id, 120), name: clip(body.visionModel.name || body.visionModel.id, 80), structured: !!body.visionModel.structured, json: !!body.visionModel.json } : null;
    if (CLAUDE_MODELS.includes(body.claudeModel)) next.claudeModel = body.claudeModel;
    if (Number.isFinite(body.dailyLimit)) next.dailyLimit = Math.max(0, Math.min(1000, Math.round(body.dailyLimit)));
    ['open', 'lock'].forEach((k) => { if (typeof body[k] === 'boolean') next[k] = body[k]; });
    if (typeof body.notice === 'string') next.notice = clip(body.notice, 500);
    if (body.telegram) {
      next.telegram = { ...cfg.telegram };
      if (typeof body.telegram.chat === 'string') next.telegram.chat = clip(body.telegram.chat.trim(), 40);
      if (typeof body.telegram.token === 'string' && !body.telegram.token.includes('•')) next.telegram.token = clip(body.telegram.token.trim(), 100);
    }
    if (body.notify) next.notify = { ...cfg.notify, ...Object.fromEntries(Object.entries(body.notify).filter(([, v]) => typeof v === 'boolean')) };
    await saveConfig(env, next);
    return json({ ok: true, config: configView(next) });
  }

  if (path === '/admin/telegram/test' && m === 'POST') {
    const r = await telegram(env, await getConfig(env), '✅ تم ربط تيليغرام بخادم «أساس». ستصلك هنا التقارير الجديدة وتنبيهات المفاتيح.');
    return json(r, r.ok ? 200 : 400);
  }

  if (seg[1] === 'keys') {
    if (seg.length === 2 && m === 'POST') {
      const provider = body.provider === 'anthropic' ? 'anthropic' : 'openrouter';
      const secret = String(body.secret || '').replace(/[\s​-‏‪-‮⁠-⁩﻿]/g, '');
      if (secret.length < 20) return json({ error: 'المفتاح قصير أو غير صحيح' }, 400);
      const label = clip(String(body.label || '').trim(), 40) || `مفتاح ${mask(secret)}`;
      await q(env, 'INSERT INTO keys (label, provider, secret, created) VALUES (?, ?, ?, ?)', label, provider, secret, now()).run();
      return json({ ok: true });
    }
    const id = Number(seg[2]);
    const key = await q(env, 'SELECT * FROM keys WHERE id = ?', id).first();
    if (!key) return json({ error: 'المفتاح غير موجود' }, 404);
    if (seg[3] === 'test' && m === 'POST') {
      const r = key.provider === 'anthropic'
        ? await fetch(`${env.ANTHROPIC_UPSTREAM || AN_BASE}/v1/models`, { headers: { 'x-api-key': key.secret, 'anthropic-version': '2023-06-01' } })
        : await fetch(`${env.OR_UPSTREAM || OR_BASE}/key`, { headers: { authorization: `Bearer ${key.secret}` } });
      const info = await r.json().catch(() => ({}));
      if (r.ok) await q(env, 'UPDATE keys SET status = \'ok\', until = 0, note = \'\' WHERE id = ?', id).run();
      else if (r.status === 401) await q(env, 'UPDATE keys SET status = \'invalid\', until = ?, note = ? WHERE id = ?', 9e15, 'مرفوض في الاختبار', id).run();
      const d = info.data || {};
      return json({ ok: r.ok, status: r.status, info: r.ok ? (key.provider === 'anthropic' ? 'المفتاح يعمل' : `يعمل${d.is_free_tier ? ' — حساب مجاني (50 طلبًا يوميًا للنماذج المجانية)' : ''}${d.limit_remaining != null ? ` — المتبقي ${d.limit_remaining}` : ''}`) : (info.error?.message || `HTTP ${r.status}`) });
    }
    if (m === 'PATCH') {
      if (typeof body.enabled === 'boolean') await q(env, 'UPDATE keys SET enabled = ? WHERE id = ?', body.enabled ? 1 : 0, id).run();
      if (typeof body.label === 'string' && body.label.trim()) await q(env, 'UPDATE keys SET label = ? WHERE id = ?', clip(body.label.trim(), 40), id).run();
      if (body.reset) await q(env, 'UPDATE keys SET status = \'ok\', until = 0, note = \'\' WHERE id = ?', id).run();
      return json({ ok: true });
    }
    if (m === 'DELETE') { await q(env, 'DELETE FROM keys WHERE id = ?', id).run(); return json({ ok: true }); }
  }

  if (seg[1] === 'reports') {
    if (seg.length === 2 && m === 'GET') {
      const before = Number(url.searchParams.get('before')) || 9e15;
      const limit = Math.min(100, Number(url.searchParams.get('limit')) || 30);
      const device = url.searchParams.get('device');
      const { results } = device
        ? await q(env, 'SELECT id, device, name, ts, title, type, subject, lang, words, status, model, people, uni FROM reports WHERE ts < ? AND device = ? ORDER BY ts DESC LIMIT ?', before, device, limit).all()
        : await q(env, 'SELECT id, device, name, ts, title, type, subject, lang, words, status, model, people, uni FROM reports WHERE ts < ? ORDER BY ts DESC LIMIT ?', before, limit).all();
      return json({ reports: results });
    }
    const id = decodeURIComponent(seg[2] || '');
    if (m === 'GET') { const r = await q(env, 'SELECT * FROM reports WHERE id = ?', id).first(); return r ? json({ report: r }) : json({ error: 'غير موجود' }, 404); }
    if (m === 'DELETE') { await q(env, 'DELETE FROM reports WHERE id = ?', id).run(); return json({ ok: true }); }
  }

  if (seg[1] === 'devices') {
    if (seg.length === 2 && m === 'GET') {
      const { results } = await q(env, 'SELECT * FROM devices ORDER BY last_seen DESC LIMIT 300').all();
      const t0 = dayStart();
      const { results: counts } = await q(env, 'SELECT device, COUNT(DISTINCT report) AS n FROM events WHERE kind = \'report\' AND ts >= ? GROUP BY device', t0).all();
      const today = Object.fromEntries(counts.map((c) => [c.device, c.n]));
      return json({ devices: results.map((d) => ({ ...d, blocked: !!d.blocked, today: today[d.id] || 0 })) });
    }
    if (m === 'PATCH') {
      const id = decodeURIComponent(seg[2] || '');
      if (typeof body.blocked === 'boolean') await q(env, 'UPDATE devices SET blocked = ? WHERE id = ?', body.blocked ? 1 : 0, id).run();
      return json({ ok: true });
    }
  }

  return json({ error: 'مسار غير موجود' }, 404);
}

/* ── التوجيه ──────────────────────────────────────── */

export default {
  async fetch(req, env, ctx) {
    // «*» لا يشمل رأس Authorization في المتصفحات، فنعيد الرؤوس المطلوبة نفسها
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...CORS, 'access-control-allow-headers': req.headers.get('access-control-request-headers') || '*' } });
    const path = new URL(req.url).pathname.replace(/\/+$/, '') || '/';
    if (path === '/') return json({ ok: true, name: 'asas-server', hint: 'خادم تطبيق «أساس». الإدارة من التطبيق: الإعدادات ← لوحة مدير التطبيق.' });
    try {
      await init(env);
    } catch (e) {
      return json({ error: e.message === 'NO_DB' ? 'لم تُربط قاعدة D1 باسم DB بهذا الـ Worker (Bindings ← D1 ← DB).' : `تعذّر تجهيز قاعدة البيانات: ${e.message}` }, 500);
    }
    try {
      if (path.startsWith('/admin/')) return await admin(req, env, ctx, path);
      if (env.APP_TOKEN && req.headers.get('x-app-token') !== env.APP_TOKEN) return orErr(403, 'رمز التطبيق غير صحيح.');
      if (path === '/api/config') return await publicConfig(req, env);
      if (path === '/api/log' && req.method === 'POST') return await logReport(req, env, ctx);
      if (path.startsWith('/or/api/v1/')) return await proxyOpenRouter(req, env, ctx, path.slice('/or/api/v1'.length));
      if ((path === '/anthropic/v1/messages' || path === '/v1/messages') && req.method === 'POST') return await proxyAnthropic(req, env, ctx);
      return json({ error: 'المسار غير مدعوم' }, 404);
    } catch (e) {
      return json({ error: { code: 500, message: `ASAS: خطأ في خادم التطبيق: ${String(e?.message || e).slice(0, 200)}` } }, 500);
    }
  },
};
