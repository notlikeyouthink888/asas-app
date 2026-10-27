// محرك الاستوديو: التعليمات، قراءة ردود النموذج، تطبيق التعديلات على كود اللعبة،
// الاختبار التلقائي، ومراحل العمل الثلاث: صنع لعبة من وصف، تعديل بطلب، وتطوير تلقائي على جولات.

import { complete, StopError } from './llm.js';
import { addVersion, projects } from './store.js';

/* ── التعليمات ──────────────────────────────────────────── */

const LIBS = `Allowed libraries (bundled in the app, work offline) - use exactly these tags, nothing else external:
- <script src="lib/phaser.min.js"></script>  Phaser 3.90 (global \`Phaser\`) for 2D games with scenes, arcade/matter physics, tweens, particles.
- <script src="lib/three.min.js"></script>  three.js r159 (global \`THREE\`, classic script, NOT an ES module) for 3D games.
For simple games prefer plain Canvas 2D with no library.`;

export const SYSTEM = `You are a senior HTML5 game developer and game designer. You build complete, polished, fun mobile games
that run inside an Android WebView, fully offline. The game owner describes what they want (usually in Arabic, often Iraqi dialect);
you design it and write all the code yourself.

TECHNICAL RULES
- The game is ONE self-contained HTML file: inline <style> and <script>. No ES module imports, no fetch/XHR, no external URLs,
  no external images, fonts or audio files.
- ${LIBS}
- Draw all art procedurally (canvas shapes, gradients, generated textures, particle effects; emoji are fine) and make all sound
  effects and music with the Web Audio API (create/resume the AudioContext on the first user gesture).
- Mobile first: fill the whole viewport (100vw x 100vh), handle resize and orientation change, cap devicePixelRatio at 2,
  set touch-action:none and prevent scrolling, zooming and text selection. Provide on-screen touch controls (pointer events,
  multitouch, big targets >= 48px, placed for thumbs) and also support the keyboard.
- Required UX: a title/start screen, a clear goal, a HUD (score, lives/health, level), a pause button, win/game-over screens with
  restart, and rising difficulty or several levels. Save best score and progress with localStorage (it works here).
- Never use alert(), confirm() or prompt(). Don't open windows or navigate.
- Game loop with requestAnimationFrame and delta time; pool objects when there are many; keep 55-60 fps on mid-range phones.
- Text shown to the player uses the owner's language. For Arabic use dir="rtl" on HTML text; canvas fillText renders Arabic correctly.
- Write clean, organised code ('use strict', named functions/classes, constants at the top). Keep it under ~2500 lines.
- Runtime errors, frame rate and a screenshot of each version are reported back to you automatically, so fix what they reveal.

RESPONSE FORMAT (no markdown code fences anywhere):
<summary>1-2 short sentences for the owner, in their language, saying what you did.</summary>
<roadmap>Only when the roadmap changed: the FULL updated roadmap as a markdown checklist ("- [x] done", "- [ ] todo").</roadmap>
Then EITHER the complete file:
<file>
<!DOCTYPE html>
...
</file>
OR one or more targeted edits to the current file:
<edit>
<<<<<<< SEARCH
exact lines copied from the current file (enough context to be unique)
=======
the new lines
>>>>>>> REPLACE
</edit>
Use edits for focused changes and <file> for new games or large rewrites. SEARCH text must match the current file exactly,
character for character, and appear only once.`;

const PLAN_TASK = (desc, o) => `Design a mobile game from the owner's description.

Owner's description:
"""
${desc}
"""
Preferences: dimension=${o.dim || 'auto'}, orientation=${o.orientation || 'portrait'}, visual style=${o.style || 'auto'},
player-facing language=${o.lang || 'same as the description'}.

Reply in the owner's language with exactly:
<name>short catchy game title</name>
<design>
A compact game design document in markdown: concept and goal, core loop, controls (touch and keyboard), player, enemies/obstacles,
levels and progression, scoring, visual style and palette, sounds/music, screens (title, HUD, pause, win, game over).
Choose the best tech: Canvas 2D, Phaser, or three.js, and say which.
</design>
<roadmap>
8 to 14 checklist items "- [ ] ...", ordered from the core playable loop to polish and extra content.
</roadmap>`;

const BUILD_TASK = `Build version 1 of this game now as a complete <file>. Implement the first roadmap items (the core loop and
everything needed for a fun, complete, polished first playable: start screen, controls, HUD, win/lose, sounds) and mark them
[x] in an updated <roadmap>.`;

const AUTO_TASK = (round, total, focus, history) => `AUTO-DEVELOPMENT round ${round} of ${total}. You are improving this game on your own.
${focus ? `The owner asked to focus on: ${focus}\n` : ''}${history ? `Previous rounds:\n${history}\n` : ''}
Steps:
1. If the test report shows errors, a stopped game loop, a blank screen or broken layout, fix that first.
2. Then implement the next 1-3 most valuable unchecked roadmap items (or, when the roadmap is done, the best new improvement
   for the focus areas: add it to the roadmap first). Make each change complete and polished, not a stub.
3. Keep everything that already works working. Prefer targeted edits.
Return <summary>, the updated <roadmap>, and your edits or the full file.`;

const FIX_TASK = `The version you just produced fails its automatic test (report below). Fix the cause of every error so the game
starts and runs. Change only what is needed. Return <summary> and edits (or the full file).`;

/* ── قراءة الرد وتطبيق التعديلات ────────────────────────── */

function tag(text, name) {
  const m = text.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[1].trim() : null;
}

function unfence(s) {
  return s.replace(/^\s*```[a-z]*\s*\n/i, '').replace(/\n\s*```\s*$/i, '');
}

export function parseReply(text) {
  const out = { summary: tag(text, 'summary'), roadmap: tag(text, 'roadmap'), name: tag(text, 'name'), design: tag(text, 'design'), file: null, edits: [], truncated: false };
  const f = text.match(/<file>\s*([\s\S]*?)\s*<\/file>/i);
  if (f) out.file = unfence(f[1]).trim();
  else if (/<file>/i.test(text)) out.truncated = true;
  const re = /<{5,9} ?SEARCH[^\n]*\n([\s\S]*?)\n?={5,9}[^\n]*\n([\s\S]*?)\n?>{5,9} ?REPLACE/g;
  let m;
  while ((m = re.exec(text))) out.edits.push({ search: m[1], replace: m[2] });
  // نموذج نسي الوسوم وكتب الملف مباشرة
  if (!out.file && !out.edits.length && !out.truncated) {
    const start = text.search(/<!DOCTYPE html|<html[\s>]/i);
    const end = text.lastIndexOf('</html>');
    if (start >= 0 && end > start) out.file = text.slice(start, end + 7);
  }
  return out;
}

function applyOne(code, search, replace) {
  if (!search.trim()) return null;
  const i = code.indexOf(search);
  if (i >= 0) return code.indexOf(search, i + 1) < 0 ? code.slice(0, i) + replace + code.slice(i + search.length) : null;
  // مطابقة سطرية تتجاهل المسافات في أطراف الأسطر (النماذج تخطئ أحيانًا في الإزاحة)
  const lines = code.split('\n');
  const trimmed = lines.map((l) => l.trim());
  const s = search.split('\n').map((l) => l.trim());
  while (s.length && !s[0]) s.shift();
  while (s.length && !s[s.length - 1]) s.pop();
  if (!s.length) return null;
  let at = -1, count = 0;
  for (let a = 0; a + s.length <= trimmed.length; a++) {
    let ok = true;
    for (let b = 0; b < s.length; b++) if (trimmed[a + b] !== s[b]) { ok = false; break; }
    if (ok) { if (at < 0) at = a; count++; }
  }
  if (count !== 1) return null;
  return [...lines.slice(0, at), replace, ...lines.slice(at + s.length)].join('\n');
}

export function applyEdits(code, edits) {
  let out = code;
  const failed = [];
  for (const e of edits) {
    const r = applyOne(out, e.search, e.replace);
    if (r == null) failed.push(e); else out = r;
  }
  return { code: out, failed };
}

export function looksLikeGame(code) {
  return typeof code === 'string' && code.length > 300 && /<script|<canvas/i.test(code);
}

/* ── تشغيل اللعبة داخل iframe ───────────────────────────── */

let probeSrc = '';
export async function loadProbe() {
  if (probeSrc) return;
  const raw = await (await fetch('js/probe.js')).text();
  // سطر واحد حتى تبقى أرقام أسطر أخطاء اللعبة مطابقة لكودها
  probeSrc = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s*\n\s*/g, ' ');
}

const BASE = new URL('./', location.href).href;
const CDN = {
  'lib/phaser.min.js': 'https://cdn.jsdelivr.net/npm/phaser@3.90.0/dist/phaser.min.js',
  'lib/three.min.js': 'https://cdn.jsdelivr.net/npm/three@0.159.0/build/three.min.js',
};

/** اللعبة كما تعمل داخل التطبيق: مع المكتبات المحلية والمِجس. */
export function buildDoc(code, cfg = {}) {
  const inject = `<base href="${BASE}"><script>window.__GS_CFG__=${JSON.stringify(cfg).replace(/</g, '\\u003c')};${probeSrc}</script>`;
  // دالة بدل نص الاستبدال: بيانات الحفظ قد تحتوي $& أو $' فتفسد اللعبة
  const head = code.match(/<head[^>]*>/i);
  if (head) return code.replace(head[0], () => head[0] + inject);
  const html = code.match(/<html[^>]*>/i);
  if (html) return code.replace(html[0], () => html[0] + '<head>' + inject + '</head>');
  return inject + code;
}

/** نسخة مستقلة للمشاركة: تعمل بأي متصفح (المكتبات من الإنترنت). */
export function exportDoc(code) {
  let out = code;
  for (const [local, cdn] of Object.entries(CDN)) out = out.split(`src="${local}"`).join(`src="${cdn}"`);
  return out;
}

/** يحول تقرير الاختبار إلى نص يفهمه النموذج، مع مقطع الكود حول كل خطأ. */
export function describeReport(r, code) {
  if (!r) return 'No test report available.';
  const lines = code.split('\n');
  const out = [];
  if (r.timeout) out.push('- The page did not respond to the test probe (it may be frozen in an infinite loop).');
  out.push(`- Runtime errors: ${r.errors.length}`);
  r.errors.slice(0, 8).forEach((e, i) => {
    out.push(`  ${i + 1}. [${e.kind}] ${e.msg}${e.line ? ` (line ${e.line}:${e.col})` : ''}${e.count > 1 ? ` x${e.count}` : ''} at ${e.t}ms`);
    if (e.line && lines[e.line - 1] !== undefined) {
      for (let n = Math.max(1, e.line - 2); n <= Math.min(lines.length, e.line + 2); n++) {
        out.push(`     ${n === e.line ? '>' : ' '}${n}| ${lines[n - 1].slice(0, 160)}`);
      }
    } else if (e.stack) out.push('     ' + e.stack.split('\n').slice(0, 3).join(' | '));
  });
  const secs = (r.uptime || 1) / 1000;
  const fps = r.frames / secs;
  out.push(r.frames > 0
    ? `- requestAnimationFrame loop: running, about ${Math.round(fps)} fps over ${secs.toFixed(1)}s`
    : '- requestAnimationFrame loop: NO frames (if the game uses rAF, its loop never started or stopped)');
  if (r.canvases?.length) {
    out.push('- Canvases: ' + r.canvases.map((c) => `${c.type || '?'} ${c.w}x${c.h} shown ${c.cw}x${c.ch}${c.blank ? ' (BLANK, single color)' : ''}`).join('; '));
  } else out.push('- No <canvas> on the page.');
  out.push(`- Viewport ${r.vw}x${r.vh}, page scroll size ${r.scrollW}x${r.scrollH}${r.scrollH > r.vh + 4 || r.scrollW > r.vw + 4 ? ' (OVERFLOWS the screen)' : ''}`);
  out.push(`- Buttons: ${r.buttons}. Visible text: "${r.text || ''}"`);
  out.push(`- Simulated input during the test: taps at center and bottom corners, Enter, Space, arrows.`);
  out.push(`- Screenshot: ${r.shot ? 'attached (taken after the simulated input)' : 'not available'}`);
  return out.join('\n');
}

export function isBroken(r) {
  if (!r) return false;
  return r.timeout || r.errors.some((e) => e.kind !== 'console' && e.kind !== 'resource') || r.errors.length >= 3;
}

/* ── مراحل العمل ────────────────────────────────────────── */

/**
 * ctx: { model, runner, effort, budget, signal, ui }
 * ui: { phase(text), text(delta), thinking(delta), spent(total), log(text) }
 * runner: { test(code, {capture}) → report }
 */
async function call(ctx, project, parts, label) {
  if (ctx.signal?.aborted) throw new StopError();
  if (ctx.budget && ctx.spent >= ctx.budget) throw Object.assign(new Error(`وصلت حد الصرف لهذه العملية (${ctx.budget}$).`), { budget: true });
  ctx.ui.phase?.(label);
  const r = await complete({
    model: ctx.model, system: SYSTEM, parts, effort: ctx.effort, signal: ctx.signal,
    onText: ctx.ui.text, onThinking: ctx.ui.thinking,
  });
  ctx.spent = (ctx.spent || 0) + r.cost;
  project.spent = (project.spent || 0) + r.cost;
  project.tokens = (project.tokens || 0) + r.usage.input + r.usage.output + r.usage.cacheRead + r.usage.cacheWrite;
  ctx.ui.spent?.(ctx.spent, project.spent);
  return r;
}

function context(project, code) {
  return `GAME DESIGN:\n${project.design || '(none yet - infer it from the code)'}\n\nROADMAP:\n${project.roadmap || '(none yet)'}\n\n`
    + `CURRENT FILE (${code.split('\n').length} lines):\n<current_file>\n${code}\n</current_file>`;
}

/** يطلب تغييرًا ويطبقه، مع إعادة محاولة واحدة إن لم تنطبق بعض التعديلات. */
async function change(ctx, project, code, task, { report, shot, label }) {
  const parts = [{ text: context(project, code), cache: true }];
  if (shot && ctx.model.vision) parts.push({ image: shot });
  parts.push({ text: (report ? `TEST REPORT OF THE CURRENT FILE:\n${report}\n\n` : '') + 'TASK:\n' + task });
  let r = await call(ctx, project, parts, label);
  let p = parseReply(r.text);
  let next = code;
  if (p.file) next = p.file;
  else if (p.edits.length) {
    const a = applyEdits(code, p.edits);
    next = a.code;
    if (a.failed.length) {
      const failedText = a.failed.map((e) => '<<<<<<< SEARCH\n' + e.search.slice(0, 1200) + '\n=======').join('\n\n');
      const retry = [{ text: context(project, next), cache: true }, {
        text: `TASK:\n${task}\n\nYou already sent edits; the ones below did NOT apply because their SEARCH text was not found exactly once in `
          + `the current file (the other edits were applied and are in the file above). Re-send only these changes with SEARCH text `
          + `copied exactly from the current file, or send the complete <file>.\n\n${failedText}`,
      }];
      r = await call(ctx, project, retry, 'إعادة محاولة تطبيق التعديلات');
      const p2 = parseReply(r.text);
      if (p2.file) next = p2.file;
      else {
        const b = applyEdits(next, p2.edits);
        if (b.failed.length) throw new Error('تعذر تطبيق تعديلات النموذج على الكود. جرّب مرة ثانية أو اختر نموذجًا أقوى.');
        next = b.code;
      }
      p = { ...p, summary: p2.summary || p.summary, roadmap: p2.roadmap || p.roadmap };
    }
  } else if (p.truncated || r.stop === 'max_tokens') {
    throw new Error('رد النموذج انقطع قبل أن يكتمل الكود. جرّب طلبًا أصغر أو نموذجًا بحد إخراج أكبر.');
  } else {
    throw new Error('النموذج لم يرجع كودًا. ' + (p.summary || r.text.slice(0, 200)));
  }
  if (!looksLikeGame(next)) throw new Error('الكود الناتج لا يبدو لعبة صالحة.');
  return { code: next, summary: p.summary, roadmap: p.roadmap };
}

/** يختبر الكود، ويصلحه حتى maxFixes مرات إن ظهرت أخطاء. */
async function testAndFix(ctx, project, code, { maxFixes = 2, capture = false } = {}) {
  ctx.ui.phase?.('اختبار اللعبة…');
  let report = await ctx.runner.test(code, { capture });
  let fixes = 0;
  while (isBroken(report) && fixes < maxFixes) {
    fixes++;
    ctx.ui.log?.(`🔧 ظهرت ${report.errors.length} أخطاء، إصلاح ${fixes}/${maxFixes}`);
    const r = await change(ctx, project, code, FIX_TASK, { report: describeReport(report, code), shot: report.shot, label: `إصلاح الأخطاء (${fixes})` });
    code = r.code;
    if (r.roadmap) project.roadmap = r.roadmap;
    ctx.ui.phase?.('اختبار بعد الإصلاح…');
    report = await ctx.runner.test(code, { capture });
  }
  return { code, report, fixes };
}

/** 1) صنع لعبة من وصف: خطة ← بناء ← اختبار وإصلاح. */
export async function createGame(ctx, project) {
  const plan = await call(ctx, project, [{ text: PLAN_TASK(project.description, project.options || {}) }], 'تصميم اللعبة وكتابة الخطة…');
  const p = parseReply(plan.text);
  project.name = p.name || project.name;
  project.design = p.design || plan.text.slice(0, 4000);
  project.roadmap = p.roadmap || '';
  await projects.put(project);
  ctx.ui.version?.(project);
  ctx.ui.log?.('📝 الخطة جاهزة: ' + project.name);

  const built = await call(ctx, project, [{ text: `GAME DESIGN:\n${project.design}\n\nROADMAP:\n${project.roadmap}\n\nTASK:\n${BUILD_TASK}` }], 'كتابة كود اللعبة…');
  const b = parseReply(built.text);
  if (!b.file) {
    throw new Error(b.truncated || built.stop === 'max_tokens' ? 'رد النموذج انقطع قبل اكتمال اللعبة. جرّب نموذجًا آخر.' : 'النموذج لم يكتب ملف اللعبة.');
  }
  if (b.roadmap) project.roadmap = b.roadmap;
  const t = await testAndFix(ctx, project, b.file, { capture: true });
  addVersion(project, t.code, b.summary || 'الإصدار الأول', ctx.spent);
  project.lastReport = slim(t.report);
  project.status = 'ready';
  await projects.put(project);
  return t;
}

/** 2) تعديل بطلب من صاحب اللعبة. */
export async function improveGame(ctx, project, request) {
  const before = await ctx.runner.test(project.code, { capture: true });
  const r = await change(ctx, project, project.code, `The owner asks: """${request}"""\nImplement it fully and keep everything else working.`, {
    report: describeReport(before, project.code), shot: before.shot, label: 'تنفيذ طلبك…',
  });
  if (r.roadmap) project.roadmap = r.roadmap;
  const t = await testAndFix(ctx, project, r.code);
  if (isBroken(t.report) && !isBroken(before)) {
    throw new Error('التعديل كسر اللعبة ولم ينجح إصلاحه، فبقيت النسخة السابقة كما هي. جرّب صياغة أخرى.');
  }
  addVersion(project, t.code, r.summary || request.slice(0, 80), ctx.spent);
  project.lastReport = slim(t.report);
  await projects.put(project);
  return { ...t, summary: r.summary };
}

/** 3) التطوير التلقائي: جولات متتالية، كل جولة تختبر وتطور وتحفظ إصدارًا (أو تتراجع إن انكسرت اللعبة). */
export async function autoDevelop(ctx, project, { rounds, focus }) {
  const history = [];
  for (let i = 1; i <= rounds; i++) {
    if (ctx.signal?.aborted) break;
    ctx.ui.round?.(i, rounds);
    const before = await ctx.runner.test(project.code, { capture: true });
    let r;
    try {
      r = await change(ctx, project, project.code, AUTO_TASK(i, rounds, focus, history.slice(-6).join('\n')), {
        report: describeReport(before, project.code), shot: before.shot, label: `الجولة ${i}/${rounds}: تطوير…`,
      });
    } catch (e) {
      if (e.stop || e.budget) throw e;
      ctx.ui.log?.(`⚠️ الجولة ${i}: ${e.message}`);
      history.push(`- round ${i}: failed (${e.message})`);
      continue;
    }
    const t = await testAndFix(ctx, project, r.code);
    if (isBroken(t.report) && !isBroken(before)) {
      ctx.ui.log?.(`↩️ الجولة ${i}: التغيير كسر اللعبة، تراجعت عنه.`);
      history.push(`- round ${i}: attempted "${r.summary || ''}" but it broke the game and was reverted; try a different approach`);
      continue;
    }
    if (r.roadmap) project.roadmap = r.roadmap;
    const n = addVersion(project, t.code, `🤖 ${r.summary || 'تطوير تلقائي'}`, ctx.spent);
    project.lastReport = slim(t.report);
    await projects.put(project);
    history.push(`- round ${i}: ${r.summary || 'improved the game'}`);
    ctx.ui.log?.(`✅ الجولة ${i} ← الإصدار ${n}: ${r.summary || ''}`);
    ctx.ui.version?.(project);
  }
}

function slim(r) {
  if (!r) return null;
  const { shot, ...rest } = r;
  return rest;
}
