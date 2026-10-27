// الاتصال بالنماذج: Claude مباشرة عبر Anthropic SDK (بمفتاح كلود)، أو أي نموذج عبر OpenRouter.
// كلاهما بالبث (streaming) حتى يظهر التقدم ولا تنقطع الطلبات الطويلة.

import { keys } from './store.js';
import { costOf } from './models.js';

export class StopError extends Error {
  constructor() { super('أُوقفت العملية'); this.stop = true; }
}

/** خطأ مؤقت (انقطاع نت، خادم مشغول): يُعاد الطلب تلقائيًا بدل إفشال العملية. */
function temporary(message) {
  return Object.assign(new Error(message), { retryable: true });
}

function pause(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new StopError());
    const t = setTimeout(done, ms);
    function done() { signal?.removeEventListener('abort', stop); resolve(); }
    function stop() { clearTimeout(t); reject(new StopError()); }
    signal?.addEventListener('abort', stop, { once: true });
  });
}

/** ينتظر رجوع الإنترنت (حتى 30 دقيقة). */
function online(signal) {
  if (navigator.onLine) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const t = setTimeout(done, 30 * 60e3);
    function done() { clearTimeout(t); removeEventListener('online', done); signal?.removeEventListener('abort', stop); resolve(); }
    function stop() { clearTimeout(t); removeEventListener('online', done); reject(new StopError()); }
    addEventListener('online', done);
    signal?.addEventListener('abort', stop, { once: true });
  });
}

const ATTEMPTS = 6;

/**
 * parts: [{ text, cache? } | { image: base64Jpeg }]
 * يرجع { text, usage: {input, output, cacheRead, cacheWrite}, cost, stop, model }
 * إن انقطع الاتصال أو انشغل الخادم ينتظر ويعيد المحاولة حتى 6 مرات (onRetry يُبلغ الواجهة).
 */
export async function complete(opts) {
  for (let attempt = 1; ; attempt++) {
    try {
      return opts.model.provider === 'anthropic' ? await claude(opts) : await openRouter(opts);
    } catch (e) {
      if (e.stop || !e.retryable) throw e;
      if (attempt >= ATTEMPTS) throw Object.assign(new Error('تعذر الاتصال بعد عدة محاولات: ' + e.message), { network: true });
      opts.onRetry?.(attempt, ATTEMPTS - 1, e.message);
      await online(opts.signal);
      await pause(Math.min(30000, 2500 * 2 ** (attempt - 1)) * (e.slow ? 4 : 1), opts.signal);
    }
  }
}

/* ── Claude (Anthropic SDK) ─────────────────────────────── */

let client, clientKey;
function anthropic() {
  const key = keys.anthropic;
  if (!key) throw new Error('أضف مفتاح كلود من الإعدادات.');
  if (!client || clientKey !== key) {
    // المفتاح للمستخدم نفسه ومحفوظ على جهازه فقط، لذلك الاتصال المباشر من التطبيق مقبول هنا
    client = new window.Anthropic({ apiKey: key, dangerouslyAllowBrowser: true, maxRetries: 2 });
    clientKey = key;
  }
  return client;
}

function claudeError(e, signal) {
  const A = window.Anthropic;
  if (signal?.aborted || e instanceof A.APIUserAbortError) return new StopError();
  if (e instanceof A.AuthenticationError) return new Error('مفتاح كلود غير صحيح (401). راجعه بالإعدادات.');
  if (e instanceof A.PermissionDeniedError) return new Error('المفتاح لا يملك صلاحية هذا النموذج (403).');
  if (e instanceof A.NotFoundError) return new Error('النموذج غير موجود لهذا المفتاح (404). اختر نموذجًا آخر.');
  if (e instanceof A.RateLimitError) return Object.assign(temporary('تجاوزت حد الطلبات مؤقتًا (429)'), { slow: true });
  if (e instanceof A.BadRequestError) {
    const msg = e.error?.error?.message || e.message;
    if (/credit balance/i.test(msg)) return new Error('رصيد حساب Anthropic لا يكفي. اشحنه من console.anthropic.com.');
    return new Error('طلب مرفوض (400): ' + msg);
  }
  if (e instanceof A.InternalServerError) return temporary('خوادم Anthropic مشغولة');
  if (e instanceof A.APIConnectionError) return temporary('انقطع الاتصال');
  // خطأ داخل البث بلا رمز حالة (مثل overloaded_error) مؤقت أيضًا
  if (e instanceof A.APIError) return e.status ? new Error(`خطأ ${e.status}: ${e.message}`) : temporary(e.message);
  // انقطاع الشبكة أثناء قراءة البث يظهر كـ TypeError
  if (e instanceof TypeError) return temporary('انقطع الاتصال أثناء الاستلام');
  return e;
}

async function claude({ model, system, parts, maxTokens, effort, signal, onText, onThinking }) {
  const content = parts.map((p) => p.image
    ? { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: p.image } }
    : { type: 'text', text: p.text, ...(p.cache ? { cache_control: { type: 'ephemeral' } } : {}) });
  const params = {
    model: model.id,
    max_tokens: maxTokens || 64000,
    // التعليمات ثابتة فتُحفظ مؤقتًا ويقل سعرها في كل طلب بعد الأول
    system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content }],
    thinking: { type: 'adaptive', display: 'summarized' },
    output_config: { effort: effort || 'high' },
  };
  // إن رفض النموذج الطلب، يعيده الخادم تلقائيًا على النموذج البديل الذي توصي به Anthropic
  if (model.id !== 'claude-haiku-5-5') {
    params.betas = ['server-side-fallback-2026-07-01'];
    params.fallbacks = 'default';
  }

  let msg;
  try {
    const stream = anthropic().beta.messages.stream(params, { signal });
    stream.on('text', (t) => onText?.(t));
    stream.on('thinking', (t) => onThinking?.(t));
    msg = await stream.finalMessage();
  } catch (e) {
    throw claudeError(e, signal);
  }
  if (msg.stop_reason === 'refusal') {
    throw new Error('النموذج رفض هذا الطلب' + (msg.stop_details?.explanation ? ': ' + msg.stop_details.explanation : '.') + ' غيّر الوصف وجرّب مرة ثانية.');
  }
  const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  const usage = {
    input: msg.usage.input_tokens || 0,
    output: msg.usage.output_tokens || 0,
    cacheRead: msg.usage.cache_read_input_tokens || 0,
    cacheWrite: msg.usage.cache_creation_input_tokens || 0,
  };
  return { text, usage, cost: costOf(model, usage), stop: msg.stop_reason, model: msg.model || model.id };
}

/** يتحقق من مفتاح كلود ويرجع النماذج المتاحة له. */
export async function claudeModels() {
  const ids = [];
  try {
    for await (const m of anthropic().models.list()) ids.push(m.id);
  } catch (e) {
    throw claudeError(e);
  }
  return ids;
}

/* ── OpenRouter ─────────────────────────────────────────── */

const OR = 'https://openrouter.ai/api/v1';

function orHeaders() {
  const key = keys.openrouter;
  if (!key) throw new Error('أضف مفتاح OpenRouter من الإعدادات.');
  return {
    Authorization: 'Bearer ' + key,
    'Content-Type': 'application/json',
    'HTTP-Referer': 'https://github.com/notlikeyouthink888/asas-app',
    'X-Title': 'Game Studio',
  };
}

async function orError(res) {
  let msg = '';
  try { msg = (await res.json()).error?.message || ''; } catch { /* نص غير JSON */ }
  switch (res.status) {
    case 401: return new Error('مفتاح OpenRouter غير صحيح (401).');
    case 402: return new Error('رصيد محفظة OpenRouter لا يكفي (402). اشحنها أو اختر نموذجًا أرخص.');
    case 429: return Object.assign(temporary('طلبات كثيرة (429)'), { slow: true });
    case 408: case 500: case 502: case 503: case 504: return temporary(`خادم OpenRouter مشغول (${res.status}) ${msg}`);
    default: return new Error(`خطأ OpenRouter ${res.status}: ${msg}`);
  }
}

async function openRouter({ model, system, parts, maxTokens, signal, onText, onThinking }) {
  const content = parts
    .filter((p) => !p.image || model.vision)
    .map((p) => p.image
      ? { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + p.image } }
      : { type: 'text', text: p.text });
  const body = {
    model: model.id,
    messages: [{ role: 'system', content: system }, { role: 'user', content }],
    stream: true,
    // حد الإخراج المعروف للنموذج، وإن جُهل فـ 32 ألفًا (بعض المزودين يرفضون الأكبر)
    max_tokens: Math.min(maxTokens || 64000, model.maxOut || 32000),
    usage: { include: true },
  };
  // بديل تلقائي إن تعطل النموذج المختار
  if (model.id !== 'openrouter/auto') body.models = [model.id, 'openrouter/auto'];

  let res;
  try {
    res = await fetch(OR + '/chat/completions', { method: 'POST', headers: orHeaders(), body: JSON.stringify(body), signal });
  } catch (e) {
    if (signal?.aborted || e.name === 'AbortError') throw new StopError();
    throw temporary('تعذر الاتصال بالإنترنت');
  }
  if (!res.ok) throw await orError(res);

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', text = '', usage = null, finish = null, served = model.id;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') continue;
        let j;
        try { j = JSON.parse(data); } catch { continue; }
        // خطأ من المزود أثناء البث (غالبًا مؤقت): يُعاد الطلب
        if (j.error) throw temporary('OpenRouter: ' + (j.error.message || 'خطأ أثناء البث'));
        if (j.model) served = j.model;
        const ch = j.choices?.[0];
        const d = ch?.delta;
        if (d?.content) { text += d.content; onText?.(d.content); }
        if (d?.reasoning) onThinking?.(d.reasoning);
        if (ch?.finish_reason) finish = ch.finish_reason;
        if (j.usage) usage = j.usage;
      }
    }
  } catch (e) {
    if (signal?.aborted || e.name === 'AbortError') throw new StopError();
    if (e.retryable) throw e;
    throw temporary('انقطع الاتصال أثناء الاستلام');
  }
  const u = { input: usage?.prompt_tokens || 0, output: usage?.completion_tokens || 0, cacheRead: 0, cacheWrite: 0 };
  const cost = typeof usage?.cost === 'number' ? usage.cost : costOf(model, u);
  return { text, usage: u, cost, stop: finish === 'length' ? 'max_tokens' : finish, model: served };
}

/** رصيد محفظة OpenRouter بالدولار (أو null إن تعذر). */
export async function openRouterBalance() {
  const res = await fetch(OR + '/credits', { headers: orHeaders() });
  if (res.ok) {
    const d = (await res.json()).data;
    if (d && typeof d.total_credits === 'number') return d.total_credits - (d.total_usage || 0);
  }
  const k = await fetch(OR + '/key', { headers: orHeaders() });
  if (!k.ok) throw await orError(k);
  const d = (await k.json()).data || {};
  return typeof d.limit_remaining === 'number' ? d.limit_remaining : null;
}
