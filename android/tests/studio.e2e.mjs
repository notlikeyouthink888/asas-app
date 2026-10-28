// اختبار شامل لواجهة الاستوديو في Chromium مع ردود وهمية من Claude وOpenRouter (بلا مفاتيح حقيقية وبلا صرف).
// التشغيل: node android/tests/studio.e2e.mjs   (يحتاج playwright)
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const here = dirname(fileURLToPath(import.meta.url));
const WWW = join(here, '../app/src/main/assets/www');
const OUT = process.env.SHOTS || join(here, 'shots');
await mkdir(OUT, { recursive: true });

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.md': 'text/plain', '.txt': 'text/plain' };
const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const body = await readFile(join(WWW, path === '/' ? 'index.html' : path));
    res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}/`;

/* ── ردود وهمية ── */

const GAME_V1 = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>T</title>
<style>html,body{margin:0;height:100%;background:#123}canvas{display:block}</style>
<script src="lib/phaser.min.js"></script></head><body><canvas id="c"></canvas><script>
'use strict';
if (typeof Phaser === 'undefined') throw new Error('phaser missing');
const c = document.getElementById('c'), x = c.getContext('2d');
function resize() { c.width = innerWidth; c.height = innerHeight; }
resize(); addEventListener('resize', resize);
let t = 0, best = +localStorage.getItem('best') || 0;
function loop() {
  t++;
  x.fillStyle = '#234'; x.fillRect(0, 0, c.width, c.height);
  x.fillStyle = '#fc3'; x.beginPath(); x.arc(c.width / 2 + Math.sin(t / 20) * 80, c.height / 2, 30, 0, 7); x.fill();
  updateEnemies();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
</script></body></html>`;

const calls = [];
const count = {};
const bump = (k) => (count[k] = (count[k] || 0) + 1);
let failBuildOnce = true;   // أول طلب بناء يفشل برفض نهائي (400) لاختبار «أكمل من حيث توقف»
let dropFirstPlan = true;   // أول طلب خطة ينقطع اتصاله لاختبار إعادة المحاولة التلقائية

// لعبة تعمل لكن ترمي خطأ أثناء اللعب بعد نصف ثانية (لاختبار الإصلاح التلقائي أثناء اللعب)
const GAME_LATE_BUG = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><canvas id="c"></canvas><script>
/* BOSSGAME */
const c = document.getElementById('c'), x = c.getContext('2d');
c.width = innerWidth; c.height = innerHeight;
let t = 0;
function loop() {
  t++;
x.fillStyle = '#063';
  x.fillRect(0, 0, c.width, c.height); if (t > 30) spawnBoss(); requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
</script></body></html>`;

// نفس نمط خطأك: كائن يُستخدم قبل إنشائه (مثل renderer.domElement) فتتوقف اللعبة فورًا
const GAME_INIT_BUG = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><script>
/* DEEPBUG */
let game;
function buildHud() { document.body.appendChild(game.canvas); }
function init() { buildHud(); game = { canvas: document.createElement('canvas') }; requestAnimationFrame(loop); }
function loop() { game.canvas.getContext('2d').clearRect(0, 0, 10, 10); requestAnimationFrame(loop); }
init();
</script></body></html>`;
const GAME_INIT_FIXED = GAME_INIT_BUG.replace('function init() { buildHud(); game = { canvas: document.createElement(\'canvas\') };',
  'function init() { game = { canvas: document.createElement(\'canvas\') }; buildHud();');

function claudeReply(body) {
  const user = JSON.stringify(body.messages);
  if (user.includes('DEEPBUG')) {
    if (user.includes('did NOT make the automatic test pass')) { bump('deep'); return `<summary>رتبت التهيئة: اللعبة تنصنع قبل الواجهة.</summary><file>\n${GAME_INIT_FIXED}\n</file>`; }
    // إصلاح «سطحي» ينطبق لكنه لا يحل المشكلة، فيضطر التطبيق للتصعيد بمراجعة كاملة
    bump('weakfix');
    return `<summary>محاولة سطحية.</summary><edit>\n<<<<<<< SEARCH\n/* DEEPBUG */\n=======\n/* DEEPBUG */ /* tried */\n>>>>>>> REPLACE\n</edit>`;
  }
  if (user.includes('BOSSGAME') && user.includes('The owner asks')) {
    return `<summary>غيرت اللون.</summary><edit>\n<<<<<<< SEARCH\nx.fillStyle = '#063';\n=======\nx.fillStyle = '#036';\n>>>>>>> REPLACE\n</edit>`;
  }
  if (user.includes('WAS CUT OFF')) {
    bump('continue');
    // التكملة تبدأ بتكرار بسيط لآخر سطر (يجب أن يُحذف التكرار عند الوصل)
    return GAME_V1.slice(GAME_V1.indexOf('let t = 0') - 20) + '\n</file>';
  }
  if (user.includes('appeared while the owner was playing')) {
    bump('playfix');
    return `<summary>عرّفت الزعيم.</summary><edit>\n<<<<<<< SEARCH\nlet t = 0;\n=======\nlet t = 0; function spawnBoss() {}\n>>>>>>> REPLACE\n</edit>`;
  }
  if (user.includes('fails its automatic test')) {
    const n = bump('fix');
    // أول محاولة إصلاح ترجع تعديلًا لا ينطبق (ولا ينطبق بإعادة المحاولة): يجب ألا يضيع البناء
    if (n <= 2) return `<summary>محاولة.</summary><edit>\n<<<<<<< SEARCH\nthis line does not exist\n=======\nnope\n>>>>>>> REPLACE\n</edit>`;
    return `<summary>صلحت دالة الأعداء.</summary><edit>\n<<<<<<< SEARCH\n  updateEnemies();\n=======\n  /* enemies later */\n>>>>>>> REPLACE\n</edit>`;
  }
  if (user.includes('did NOT apply')) {
    return `<summary>أضفت النقاط.</summary><edit>\n<<<<<<< SEARCH\nlet t = 0, best = +localStorage.getItem('best') || 0;\n=======\nlet t = 0, best = +localStorage.getItem('best') || 0; /* score */\n>>>>>>> REPLACE\n</edit>`;
  }
  if (user.includes('The owner asks')) {
    // الأول بمسافات خاطئة عمدًا (المطابقة المرنة تنجح)، والثاني غير موجود (يُطلب تصحيحه مرة ثانية)
    return `<summary>أضفت النقاط.</summary><edit>\n<<<<<<< SEARCH\n      t++;\n=======\n  t++; localStorage.setItem('best', String(Math.max(best, t)));\n>>>>>>> REPLACE\n</edit><edit>\n<<<<<<< SEARCH\nlet t = 1;\n=======\nlet t = 0;\n>>>>>>> REPLACE\n</edit>`;
  }
  if (user.includes('Build version 1')) {
    bump('build');
    // رد طويل انقطع عند حد الإخراج: نصف الملف فقط، والباقي يأتي بطلب «تكملة»
    const cut = GAME_V1.indexOf('let t = 0');
    return { text: `<summary>بنيت الإصدار الأول.</summary><roadmap>- [x] حلقة اللعب\n- [ ] أعداء\n- [ ] نقاط</roadmap><file>\n${GAME_V1.slice(0, cut + 5)}`, stop: 'max_tokens' };
  }
  if (user.includes('Design a mobile game')) {
    bump('plan');
    return `<name>نجمة الفضاء</name><design>## الفكرة\nكرة ذهبية تتحرك.\n- اللعب باللمس</design><roadmap>- [ ] حلقة اللعب\n- [ ] أعداء\n- [ ] نقاط</roadmap>`;
  }
  return '<summary>لا شيء</summary>';
}

function sse(events) {
  return events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
}

function claudeStream(reply) {
  const text = typeof reply === 'string' ? reply : reply.text;
  const stop = typeof reply === 'string' ? 'end_turn' : reply.stop;
  const chunks = text.match(/[\s\S]{1,80}/g) || [''];
  return sse([
    { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null,
      usage: { input_tokens: 1200, output_tokens: 1, cache_read_input_tokens: 800, cache_creation_input_tokens: 400 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'أفكر بتصميم ممتع…' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
    ...chunks.map((c) => ({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: c } })),
    { type: 'content_block_stop', index: 1 },
    { type: 'message_delta', delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 3000 } },
    { type: 'message_stop' },
  ]);
}

const OR_MODELS = { data: [
  { id: 'anthropic/claude-opus-4.8', name: 'Anthropic: Claude Opus 4.8', created: Date.now() / 1000 - 86400 * 30, context_length: 1000000,
    pricing: { prompt: '0.000005', completion: '0.000025' }, architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] } },
  { id: 'anthropic/claude-opus-4.1', name: 'Anthropic: Claude Opus 4.1', created: Date.now() / 1000 - 86400 * 400, context_length: 200000,
    pricing: { prompt: '0.000015', completion: '0.000075' }, architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] } },
  { id: 'qwen/qwen3-coder-plus', name: 'Qwen: Qwen3 Coder Plus', created: Date.now() / 1000 - 86400 * 60, context_length: 262144,
    pricing: { prompt: '0.000001', completion: '0.000005' }, architecture: { input_modalities: ['text'], output_modalities: ['text'] } },
  { id: 'deepseek/deepseek-v3.2', name: 'DeepSeek: V3.2', created: Date.now() / 1000 - 86400 * 20, context_length: 163840,
    pricing: { prompt: '0.00000027', completion: '0.0000011' }, architecture: { input_modalities: ['text'], output_modalities: ['text'] } },
  { id: 'google/gemini-3-pro-image', name: 'image model', created: Date.now() / 1000, context_length: 1000000,
    pricing: { prompt: '0.000002', completion: '0.00001' }, architecture: { input_modalities: ['text'], output_modalities: ['image', 'text'] } },
  { id: 'some/tiny-model', name: 'tiny', created: Date.now() / 1000, context_length: 8000, pricing: { prompt: '0', completion: '0' }, architecture: {} },
  // نماذج مجانية: اثنان من عائلات قوية، واحد عادي، وواحد سياقه قصير وواحد للصور (يُستبعدان)
  { id: 'qwen/qwen3-coder:free', name: 'Qwen: Qwen3 Coder (free)', created: Date.now() / 1000 - 86400 * 90, context_length: 262144,
    pricing: { prompt: '0', completion: '0' }, architecture: { input_modalities: ['text'], output_modalities: ['text'] } },
  { id: 'deepseek/deepseek-chat-v3.1:free', name: 'DeepSeek: DeepSeek V3.1 (free)', created: Date.now() / 1000 - 86400 * 60, context_length: 163840,
    pricing: { prompt: '0', completion: '0' }, architecture: { input_modalities: ['text'], output_modalities: ['text'] } },
  { id: 'meta-llama/llama-3.3-70b-instruct:free', name: 'Meta: Llama 3.3 70B Instruct (free)', created: Date.now() / 1000 - 86400 * 300, context_length: 131072,
    pricing: { prompt: '0', completion: '0' }, architecture: { input_modalities: ['text'], output_modalities: ['text'] } },
  { id: 'tiny/free-small:free', name: 'Tiny free', created: Date.now() / 1000, context_length: 4096,
    pricing: { prompt: '0', completion: '0' }, architecture: { input_modalities: ['text'], output_modalities: ['text'] } },
  { id: 'google/gemini-2.5-flash-image:free', name: 'image free', created: Date.now() / 1000, context_length: 32768,
    pricing: { prompt: '0', completion: '0' }, architecture: { input_modalities: ['text'], output_modalities: ['image', 'text'] } },
] };

// لعبة لاختبار سلسلة المجانية
const GAME_FREE = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><canvas id="c"></canvas><script>
/* FREEGAME */
const c = document.getElementById('c'), x = c.getContext('2d'); c.width = 300; c.height = 300;
function loop() {
x.fillStyle = '#505';
  x.fillRect(0, 0, 300, 300); requestAnimationFrame(loop);
}
loop();
</script></body></html>`;
let freeMode = 'ok';
function freeReply(route, body) {
  bump('free:' + body.model);
  if (freeMode === 'daily') {
    return route.fulfill({ status: 429, json: { error: { code: 429, message: 'Rate limit exceeded: free-models-per-day. Add 10 credits to unlock 1000 free model requests per day' } } });
  }
  if (body.model === 'qwen/qwen3-coder:free') {
    return route.fulfill({ status: 429, json: { error: { code: 429, message: 'Provider returned error', metadata: { raw: 'qwen/qwen3-coder:free is temporarily rate-limited upstream' } } } });
  }
  const user = JSON.stringify(body.messages);
  const [from, to] = user.includes("x.fillStyle = '#505';") ? ['#505', '#055'] : ['#055', '#550'];
  const text = `<summary>عدلت اللون بـ ${body.model}.</summary><edit>\n<<<<<<< SEARCH\nx.fillStyle = '${from}';\n=======\nx.fillStyle = '${to}';\n>>>>>>> REPLACE\n</edit>`;
  return route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: orStream(text) });
}

function orStream(text) {
  const chunks = text.match(/[\s\S]{1,60}/g);
  const lines = chunks.map((c) => `data: ${JSON.stringify({ model: 'qwen/qwen3-coder-plus', choices: [{ delta: { content: c } }] })}\n\n`);
  lines.unshift(': OPENROUTER PROCESSING\n\n');
  lines.push(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 5000, completion_tokens: 400, cost: 0.0123 } })}\n\n`, 'data: [DONE]\n\n');
  return lines.join('');
}

/* ── التشغيل ── */

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 412, height: 860 }, deviceScaleFactor: 2 });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));

await page.route('https://api.anthropic.com/**', async (route) => {
  const req = route.request();
  if (req.method() === 'GET') return route.fulfill({ json: { data: [{ id: 'claude-opus-5-5' }, { id: 'claude-sonnet-5-5' }], has_more: false, first_id: 'a', last_id: 'b' } });
  const body = req.postDataJSON();
  calls.push({ provider: 'anthropic', headers: req.headers(), body });
  const user = JSON.stringify(body.messages);
  if (dropFirstPlan && user.includes('Design a mobile game')) { dropFirstPlan = false; return route.abort('internetdisconnected'); }
  if (failBuildOnce && user.includes('Build version 1') && !user.includes('WAS CUT OFF')) {
    failBuildOnce = false;
    return route.fulfill({ status: 400, json: { type: 'error', error: { type: 'invalid_request_error', message: 'mock: prompt rejected once' } } });
  }
  await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: claudeStream(claudeReply(body)) });
});
await page.route('https://openrouter.ai/**', async (route) => {
  const url = route.request().url();
  if (url.endsWith('/models')) return route.fulfill({ json: OR_MODELS });
  if (url.endsWith('/credits')) return route.fulfill({ json: { data: { total_credits: 10, total_usage: 2.5 } } });
  const body = route.request().postDataJSON();
  calls.push({ provider: 'openrouter', body });
  if (JSON.stringify(body.messages).includes('FREEGAME')) return freeReply(route, body);
  const text = `<summary>غيرت اللون (جولة تلقائية).</summary><roadmap>- [x] حلقة اللعب\n- [x] أعداء\n- [ ] نقاط</roadmap><edit>\n<<<<<<< SEARCH\n  x.fillStyle = '#234'; x.fillRect(0, 0, c.width, c.height);\n=======\n  x.fillStyle = '#315'; x.fillRect(0, 0, c.width, c.height);\n>>>>>>> REPLACE\n</edit>`;
  await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: orStream(text) });
});

const readProject = () => page.evaluate(async () => {
  const db = await new Promise((r) => { const q = indexedDB.open('gamestudio'); q.onsuccess = () => r(q.result); });
  return new Promise((r) => { const q = db.transaction('projects').objectStore('projects').getAll(); q.onsuccess = () => r(q.result[0]); });
});
const check = (cond, msg) => { if (!cond) { console.error('❌ ' + msg); failures++; } else console.log('✅ ' + msg); };
let failures = 0;

await page.goto(base + 'index.html');
await page.waitForSelector('#new');
await page.screenshot({ path: join(OUT, '1-home.png') });

// الإعدادات: المفتاحان
await page.click('#set');
await page.fill('#kan', 'sk-ant-test-key');
await page.click('[data-save="kan"]');
await page.fill('#kor', 'sk-or-test-key');
await page.click('[data-save="kor"]');
await page.click('[data-test="kor"]');
await page.waitForFunction(() => document.querySelector('#kor-st').textContent.includes('$'));
check((await page.textContent('#kor-st')).includes('$7.50'), 'رصيد OpenRouter يظهر ($7.50)');
await page.click('[data-test="kan"]');
await page.waitForFunction(() => document.querySelector('#kan-st').textContent.includes('✅'));
await page.click('#refresh');
await page.waitForFunction(() => document.querySelector('#refst').textContent.includes('✅'));
const ranked = await page.evaluate(() => JSON.parse(localStorage.getItem('gs.models.openrouter')).list.map((m) => `${m.id}:${m.tier}`));
check(ranked.length === 3 && ranked[0].startsWith('anthropic/claude-opus-4.8') && !ranked.some((r) => r.includes('4.1') || r.includes('image') || r.includes('tiny')),
  'فرز OpenRouter: أحدث Opus أولًا، واستبعاد القديم والصور والسياق القصير → ' + ranked.join(', '));
await page.screenshot({ path: join(OUT, '2-settings.png'), fullPage: true });

// اختيار نموذج OpenRouter للتطوير التلقائي
await page.click('#pa');
await page.waitForSelector('.sheet .opt');
await page.screenshot({ path: join(OUT, '3-models.png') });
await page.click('.sheet .opt[data-id="qwen/qwen3-coder-plus"]');

// تعليمات إضافية للنموذج (البرومبت اختياري وقابل للتعديل)
await page.click('[data-seg="pmode"] [data-v="extra"]');
await page.fill('#pextra', 'EXTRA-RULE-123: كل النصوص بالعراقي');
await page.screenshot({ path: join(OUT, '2b-prompt.png'), fullPage: true });

// لعبة جديدة بلا وصف («فاجئني»)
await page.click('#back');
await page.click('#new');
check((await page.textContent('#make')).includes('فاجئني'), 'زر «فاجئني» يظهر حين يكون الوصف فارغًا');
await page.click('[data-seg="orientation"] [data-v="landscape"]');
await page.click('[data-seg="dim"] [data-v="3D"]');
await page.screenshot({ path: join(OUT, '4-new.png'), fullPage: true });
await page.click('#make');
await page.waitForSelector('#busy:not([hidden])');
// أول خطة ينقطع اتصالها ثم تُعاد تلقائيًا؛ أول بناء يُرفض فيتوقف مع حفظ الخطة
await page.waitForFunction(() => document.querySelector('#rebuild'), null, { timeout: 60000 });
check(count.plan === 1 && calls.filter((c) => JSON.stringify(c.body.messages).includes('Design a mobile game')).length === 2,
  'انقطاع الاتصال: طلب الخطة أُعيد تلقائيًا ونجح');
const cardText = await page.textContent('.card.warn');
check(cardText.includes('✅ الخطة') && cardText.includes('⬜ الكود'), 'بعد الفشل: الخطة محفوظة والبطاقة تعرض «أكمل من حيث توقف»');
await page.screenshot({ path: join(OUT, '5-resume.png') });
await page.click('#rebuild');
await page.waitForSelector('#busy:not([hidden])');
await page.waitForTimeout(800);
await page.screenshot({ path: join(OUT, '5b-building.png') });
await page.waitForFunction(() => document.querySelector('#busy')?.hidden && document.querySelector('#chat')?.textContent.includes('جرّبها'), null, { timeout: 120000 });
await page.screenshot({ path: join(OUT, '6-built.png') });
check(count.plan === 1, '«أكمل» لم يعد كتابة الخطة (كمل من البناء)');
check(count.continue === 1, 'الرد الطويل المقطوع اكتمل بطلب «تكملة» بدل البدء من جديد');

let state = await readProject();
check(state.name === 'نجمة الفضاء', 'اسم اللعبة من الخطة');
check(state.versions.length === 1 && !state.code.includes('updateEnemies();') && state.code.includes('enemies later'),
  'محاولة إصلاح فاشلة لم تضيّع البناء: المحاولة التالية صلحت الخطأ وانحفظ الإصدار الأول');
check(state.code.split('let t = 0').length === 2 && state.code.includes('requestAnimationFrame(loop);') && !state.draft,
  'وصل التكملة بدون تكرار والملف كامل');
check(!state.description && state.chat[0].text.includes('فاجئني'), 'اللعبة انصنعت بدون وصف');
check(state.roadmap.includes('- [x] حلقة اللعب'), 'الخطة محدثة');
check(state.spent > 0, 'حساب التكلفة: ' + state.spent.toFixed(4));

const first = calls.find((c) => c.provider === 'anthropic');
check(first.headers['x-api-key'] === 'sk-ant-test-key', 'مفتاح كلود يُرسل');
check(first.headers['anthropic-dangerous-direct-browser-access'] === 'true', 'رأس الاتصال من التطبيق');
check((first.headers['anthropic-beta'] || '').includes('server-side-fallback-2026-07-01') && first.body.fallbacks === 'default', 'البديل التلقائي عند الرفض');
const buildCall = calls.find((c) => JSON.stringify(c.body.messages).includes('Build version 1'));
check(first.body.model === 'claude-opus-5-5' && first.body.thinking?.type === 'adaptive' && first.body.output_config?.effort === 'medium'
  && buildCall.body.output_config?.effort === 'high', 'Opus 5.5 + تفكير تكيفي: الخطة بعمق متوسط (أسرع) والبناء بعمق عالي');
check(first.body.system[0].cache_control?.type === 'ephemeral', 'التعليمات محفوظة مؤقتًا (caching)');
const sys = first.body.system[0].text;
check(sys.includes('EXTRA-RULE-123') && sys.includes('RESPONSE FORMAT') && sys.includes("THE OWNER'S PHONE") && sys.includes('WebGL'),
  'البرومبت: الجاهز + إضافاتك + صيغة الرد + مواصفات الهاتف');
check(JSON.stringify(first.body.messages).includes('left the description empty') && JSON.stringify(first.body.messages).includes('dimension=3D'),
  'بلا وصف: النموذج يخترع لعبة حسب الاختيارات (3D)');
const fixCall = calls.find((c) => JSON.stringify(c.body.messages).includes('fails its automatic test'));
const fixText = JSON.stringify(fixCall.body.messages);
check(fixText.includes('updateEnemies is not defined') && fixText.includes('updateEnemies();'), 'تقرير الخطأ مع مقطع الكود يصل للنموذج');

// المعاينة تعمل بلا أخطاء
await page.click('#run');
await page.waitForTimeout(1500);
check(await page.isHidden('#errs'), 'اللعبة تعمل بلا أخطاء بعد الإصلاح');

// طلب تعديل (مع مطابقة مرنة للمسافات)
await page.fill('#req', 'ضيف نقاط');
await page.click('#send');
await page.waitForSelector('#busy:not([hidden])');
await page.waitForFunction(() => document.querySelector('#busy')?.hidden && document.querySelector('#chat')?.textContent.includes('أضفت النقاط'), null, { timeout: 60000 });
state = await readProject();
check(state.versions.length === 2 && state.code.includes("localStorage.setItem('best'") && state.code.includes('/* score */'),
  'طلب التعديل طُبق كإصدار 2 (مطابقة مرنة + إعادة محاولة للتعديل الفاشل)');

// التطوير التلقائي بجولتين عبر OpenRouter
await page.$eval('#rounds', (el) => { el.value = '2'; el.dispatchEvent(new Event('input')); });
await page.click('#auto');
await page.waitForSelector('#busy:not([hidden])');
await page.waitForTimeout(1200);
await page.screenshot({ path: join(OUT, '7-auto.png') });
await page.waitForFunction(() => document.querySelector('#busy')?.hidden && document.querySelector('#chat')?.textContent.includes('خلص التطوير'), null, { timeout: 90000 });
// اللعبة تُحمَّل (Phaser بطيء في Chromium بلا GPU) ثم تحفظ أفضل نتيجة؛ ننتظر وصولها لقاعدة التطبيق
for (let i = 0; i < 40; i++) {
  state = await readProject();
  if (state.storage?.best) break;
  await page.waitForTimeout(500);
}
const orCalls = calls.filter((c) => c.provider === 'openrouter');
check(orCalls.length >= 2 && orCalls[0].body.models?.includes('openrouter/auto') && orCalls[0].body.stream, 'التطوير التلقائي يستخدم OpenRouter بالبث مع بديل تلقائي');
check(state.code.includes("'#315'") && state.versions.length >= 3, 'جولة التطوير التلقائي حفظت إصدارًا جديدًا');
check(state.storage && state.storage.best, 'حفظ اللعبة (localStorage) يصل للتطبيق: best=' + state.storage?.best);

// خطأ يظهر أثناء اللعب ← إصلاح تلقائي
await page.click('#back');
await page.waitForSelector('#imp', { state: 'attached' });
await page.setInputFiles('#imp', { name: 'boss.html', mimeType: 'text/html', buffer: Buffer.from(GAME_LATE_BUG) });
await page.waitForFunction(() => document.querySelector('#chat')?.textContent.includes('أصلحه تلقائيًا'), null, { timeout: 30000 });
await page.waitForFunction(() => document.querySelector('#busy')?.hidden && document.querySelector('#chat')?.textContent.includes('عرّفت الزعيم'), null, { timeout: 60000 });
const fixed = (await page.evaluate(async () => {
  const db = await new Promise((r) => { const q = indexedDB.open('gamestudio'); q.onsuccess = () => r(q.result); });
  return new Promise((r) => { const q = db.transaction('projects').objectStore('projects').getAll(); q.onsuccess = () => r(q.result); });
})).find((p) => p.name === 'boss');
check(count.playfix === 1 && fixed.versions.length === 2 && fixed.code.includes('function spawnBoss') && fixed.versions[1].note.startsWith('🔧'),
  'خطأ ظهر أثناء اللعب انصلح تلقائيًا وانحفظ كإصدار جديد');
await page.waitForTimeout(2500);
check(await page.isHidden('#errs'), 'بعد الإصلاح التلقائي اللعبة تعمل بلا أخطاء');
check(count.playfix === 1, 'الإصلاح التلقائي ما يتكرر بحلقة');

// إصدار انحفظ والتطبيق بالخلفية ← تحقق تلقائي أول ما ترجع
await page.evaluate(() => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => !!window.__hid });
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (window.__hid ? 'hidden' : 'visible') });
  window.__hid = true; document.dispatchEvent(new Event('visibilitychange'));
});
await page.fill('#req', 'غيّر اللون');
await page.click('#send');
await page.waitForFunction(() => document.querySelector('#busy')?.hidden && document.querySelector('#chat')?.textContent.includes('غيرت اللون'), null, { timeout: 60000 });
await page.evaluate(() => { window.__hid = false; document.dispatchEvent(new Event('visibilitychange')); });
await page.waitForFunction(() => document.querySelector('#chat')?.textContent.includes('تحققت منها وهي تشتغل'), null, { timeout: 60000 });
check(true, 'تعديل انحفظ والتطبيق بالخلفية ← انفحص تلقائيًا وهو ظاهر لما رجعت');

// نفس خطأك: كائن يُستخدم قبل إنشائه. الإصلاحات الصغيرة تفشل ← مراجعة كاملة تحل المشكلة
await page.click('#back');
await page.setInputFiles('#imp', { name: 'initbug.html', mimeType: 'text/html', buffer: Buffer.from(GAME_INIT_BUG) });
await page.waitForFunction(() => document.querySelector('#chat')?.textContent.includes('أصلحه تلقائيًا'), null, { timeout: 30000 });
await page.waitForFunction(() => document.querySelector('#busy')?.hidden && document.querySelector('#chat')?.textContent.includes('رتبت التهيئة'), null, { timeout: 90000 });
const deepState = (await page.evaluate(async () => {
  const db = await new Promise((r) => { const q = indexedDB.open('gamestudio'); q.onsuccess = () => r(q.result); });
  return new Promise((r) => { const q = db.transaction('projects').objectStore('projects').getAll(); q.onsuccess = () => r(q.result); });
})).find((p) => p.name === 'initbug');
check(count.weakfix === 2 && count.deep === 1 && deepState.code.includes("game = { canvas: document.createElement('canvas') }; buildHud();"),
  'إصلاحان سطحيان فشلا ← المراجعة الكاملة صلحت ترتيب التهيئة');
const deepCall = calls.find((c) => JSON.stringify(c.body.messages).includes('did NOT make the automatic test pass'));
const deepText = JSON.stringify(deepCall.body.messages);
check(deepText.includes('WebGL inside the game frame') && deepText.includes('used before it was created') && deepText.includes('call stack'),
  'تقرير الخطأ فيه: هل WebGL يعمل، تلميح «استُخدم قبل إنشائه»، ومسار الاستدعاء');
await page.waitForTimeout(2500);
check(await page.isHidden('#errs'), 'اللعبة بعد المراجعة الكاملة تعمل بلا أخطاء');

// ── النماذج المجانية: الأسماء، التبديل التلقائي، الحد اليومي، الترتيب ──
await page.click('#back');
await page.click('#set');
await page.click('#refresh');
await page.waitForFunction(() => document.querySelector('#refst').textContent.includes('✅'));
await page.click('#freeUse');
await page.waitForSelector('#freeList');
await page.click('#freeList');
await page.waitForSelector('.sheet [data-id]');
const freeNames = await page.$$eval('.sheet [data-id]', (rows) => rows.map((r) => r.dataset.id));
check(freeNames.join(',') === 'qwen/qwen3-coder:free,deepseek/deepseek-chat-v3.1:free,meta-llama/llama-3.3-70b-instruct:free',
  'قائمة المجانية: الأسماء مرتبة بالأقوى بالبرمجة، واستبعاد السياق القصير ونماذج الصور → ' + freeNames.join(', '));
await page.screenshot({ path: join(OUT, '11-free.png') });
await page.click('.sheet [data-close]');
await page.click('#back');
await page.setInputFiles('#imp', { name: 'freegame.html', mimeType: 'text/html', buffer: Buffer.from(GAME_FREE) });
await page.waitForSelector('#req');
check((await page.textContent('#tab')).includes('النماذج المجانية'), 'شاشة اللعبة تعرض أن الطلبات بالنماذج المجانية');
await page.fill('#req', 'غيّر اللون');
await page.click('#send');
await page.waitForFunction(() => document.querySelector('#busy')?.hidden && document.querySelector('#chat')?.textContent.includes('عدلت اللون'), null, { timeout: 60000 });
let chatText = await page.textContent('#chat');
check(count['free:qwen/qwen3-coder:free'] === 1 && count['free:deepseek/deepseek-chat-v3.1:free'] === 1 && chatText.includes('حولت على DeepSeek V3.1'),
  'نموذج مجاني مشغول (429) ← تحول تلقائيًا للتالي ونجح، والمحادثة تبين الأسماء');
const freeCalls = calls.filter((c) => c.provider === 'openrouter' && String(c.body.model).endsWith(':free'));
check(freeCalls.length >= 2 && freeCalls.every((c) => !c.body.models), 'المجاني لا يتحول أبدًا لنموذج مدفوع (لا openrouter/auto)');

freeMode = 'daily';
const before = { ...count };
await page.fill('#req', 'غيّر اللون مرة ثانية');
await page.click('#send');
await page.waitForFunction(() => document.querySelector('#busy')?.hidden && document.querySelector('#chat')?.textContent.includes('خلصت طلباتك المجانية لليوم'), null, { timeout: 60000 });
const tried = Object.keys(count).filter((k) => k.startsWith('free:') && count[k] !== before[k]);
check(tried.length === 1 && !tried[0].includes('llama'), 'الحد اليومي للحساب: وقف وشرح السبب بدل ما يلف على كل النماذج بلا فايدة');

// ترتيبك: Llama أول، وتعطيل Qwen
freeMode = 'ok';
await page.click('#back');
await page.click('#set');
await page.click('#freeList');
await page.waitForSelector('.sheet [data-id]');
await page.click('#fReset');
await page.click('.sheet [data-id="meta-llama/llama-3.3-70b-instruct:free"] [data-up]');
await page.click('.sheet [data-id="meta-llama/llama-3.3-70b-instruct:free"] [data-up]');
await page.click('.sheet [data-id="qwen/qwen3-coder:free"] [data-on]');
const order = await page.$$eval('.sheet [data-id]', (rows) => rows.map((r) => r.dataset.id + (r.querySelector('[data-on]').checked ? '' : '(off)')));
check(order[0].startsWith('meta-llama') && order.some((o) => o === 'qwen/qwen3-coder:free(off)'), 'تبديل الترتيب والتعطيل يدويًا → ' + order.join(', '));
await page.click('.sheet [data-close]');
await page.click('#back');
await page.click('.game:has-text("freegame")');
await page.waitForSelector('#req');
const llamaBefore = count['free:meta-llama/llama-3.3-70b-instruct:free'] || 0, qwenBefore = count['free:qwen/qwen3-coder:free'];
await page.fill('#req', 'غيّر اللون مرة ثالثة');
await page.click('#send');
await page.waitForFunction(() => document.querySelector('#busy')?.hidden && document.querySelector('#chat')?.textContent.includes('meta-llama'), null, { timeout: 60000 });
check(count['free:meta-llama/llama-3.3-70b-instruct:free'] === llamaBefore + 1 && count['free:qwen/qwen3-coder:free'] === qwenBefore,
  'الطلب راح لأول نموذج بترتيبك (Llama)، والمعطّل (Qwen) ما انطلب');
await page.click('#back');
await page.click('#set');
await page.click('#pb');
await page.click('.sheet .opt[data-id="claude-opus-5-5"]');
await page.click('#pa');
await page.click('.sheet .opt[data-id="qwen/qwen3-coder-plus"]');
await page.click('#back');
await page.click('.game:has-text("نجمة الفضاء")');
await page.waitForSelector('#game');

// الخطة والإصدارات
await page.click('[data-tab="plan"]');
await page.screenshot({ path: join(OUT, '8-plan.png'), fullPage: true });
await page.click('[data-tab="versions"]');
await page.screenshot({ path: join(OUT, '9-versions.png'), fullPage: true });
await page.click('#fs');
await page.waitForTimeout(500);
await page.screenshot({ path: join(OUT, '10-play.png') });

// خطأ updateEnemies مقصود في الإصدار الأول الوهمي (من داخل اللعبة لا الواجهة)
const pageErrors = logs.filter((l) => l.startsWith('[pageerror]') && !/updateEnemies|spawnBoss|reading 'canvas'/.test(l));
check(!pageErrors.length, 'لا أخطاء في واجهة التطبيق' + (pageErrors.length ? ': ' + pageErrors.join(' | ') : ''));
if (failures) console.log(logs.slice(-30).join('\n'));
await browser.close();
server.close();
console.log(failures ? `\n${failures} فشل` : '\nكل الفحوص نجحت');
process.exit(failures ? 1 : 0);
