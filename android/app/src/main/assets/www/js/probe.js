/* يُحقن في أول سطر من كل لعبة: يلتقط الأخطاء، يقيس حلقة اللعب، يوفر localStorage للعبة المعزولة،
   ويحاكي لمسات وأزرارًا أثناء الاختبار التلقائي. يُضغط إلى سطر واحد عند الحقن حتى لا تتغير أرقام أسطر اللعبة،
   لذلك: بلا تعليقات سطرية وكل جملة تنتهي بفاصلة منقوطة. */
(function () {
  var CFG = window.__GS_CFG__ || {};
  var errors = [];
  var frames = 0, lastT = -1;
  function send(m) { m.__gs = 1; try { parent.postMessage(m, '*'); } catch (e) {} }
  function str(a) {
    if (a && a.stack) return String(a.stack);
    if (typeof a === 'object') { try { return JSON.stringify(a).slice(0, 300); } catch (e) { return String(a); } }
    return String(a);
  }
  var lost = false;
  function addErr(kind, msg, line, col, stack) {
    if (lost) return;
    msg = String(msg || '').slice(0, 500);
    var key = kind + '|' + msg + '|' + (line || 0);
    for (var i = 0; i < errors.length; i++) { if (errors[i].key === key) { errors[i].count++; return; } }
    if (errors.length >= 25) return;
    var e = { key: key, kind: kind, msg: msg, line: line || 0, col: col || 0, stack: String(stack || '').slice(0, 900), count: 1, t: Math.round(performance.now()) };
    errors.push(e);
    send({ type: 'error', error: e });
  }
  window.addEventListener('error', function (ev) {
    var t = ev.target;
    if (t && t !== window && (t.src || t.href)) { addErr('resource', 'Failed to load ' + (t.src || t.href)); return; }
    addErr('error', ev.message, ev.lineno, ev.colno, ev.error && ev.error.stack);
  }, true);
  window.addEventListener('unhandledrejection', function (ev) {
    var r = ev.reason;
    addErr('promise', (r && r.message) || r, 0, 0, r && r.stack);
  });
  var origError = console.error;
  console.error = function () {
    try { addErr('console', Array.prototype.map.call(arguments, str).join(' ')); } catch (e) {}
    return origError.apply(console, arguments);
  };

  function makeStore(data, persist) {
    var timer = null;
    function sync() { if (!persist || timer) return; timer = setTimeout(function () { timer = null; send({ type: 'storage', data: data }); }, 300); }
    var s = {
      getItem: function (k) { k = String(k); return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
      setItem: function (k, v) { data[String(k)] = String(v); sync(); },
      removeItem: function (k) { delete data[String(k)]; sync(); },
      clear: function () { for (var k in data) { delete data[k]; } sync(); },
      key: function (i) { return Object.keys(data)[i] || null; }
    };
    Object.defineProperty(s, 'length', { get: function () { return Object.keys(data).length; } });
    return s;
  }
  try { Object.defineProperty(window, 'localStorage', { value: makeStore(CFG.storage || {}, !CFG.test), configurable: true }); } catch (e) {}
  try { Object.defineProperty(window, 'sessionStorage', { value: makeStore({}, false), configurable: true }); } catch (e) {}

  window.alert = function (m) { console.log('[alert] ' + m); };
  window.confirm = function () { return true; };
  window.prompt = function () { return null; };

  var raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = function (cb) {
    return raf(function (t) { if (t !== lastT) { lastT = t; frames++; } cb(t); });
  };

  var ctxType = new WeakMap();
  var glContexts = [];
  var getCtx = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type) {
    var c = getCtx.apply(this, arguments);
    var t = String(type);
    var gl = t.indexOf('webgl') === 0 || t === 'experimental-webgl';
    if (c && !ctxType.has(this)) {
      ctxType.set(this, t);
      if (gl) {
        glContexts.push(c);
        this.addEventListener('webglcontextlost', function () { addErr('webgl', 'WebGL context lost (the GPU context was taken away; the game must handle webglcontextlost/restored)'); }, false);
      }
    }
    if (!c && gl) addErr('webgl', 'WebGL context could not be created (getContext("' + t + '") returned null)');
    return c;
  };
  var audios = [];
  ['AudioContext', 'webkitAudioContext'].forEach(function (name) {
    var A = window[name];
    if (!A) return;
    var W = function () { var a = new (Function.prototype.bind.apply(A, [null].concat(Array.prototype.slice.call(arguments))))(); audios.push(a); return a; };
    W.prototype = A.prototype;
    try { window[name] = W; } catch (e) {}
  });
  function release() {
    glContexts.forEach(function (c) { try { var x = c.getExtension('WEBGL_lose_context'); if (x) x.loseContext(); } catch (e) {} });
    audios.forEach(function (a) { try { a.close(); } catch (e) {} });
    glContexts = [];
    audios = [];
  }
  function blank(c) {
    if (ctxType.get(c) !== '2d' || !c.width || !c.height) return null;
    try {
      var x = c.getContext('2d'), first = null, same = true;
      for (var i = 1; i < 5 && same; i++) {
        for (var j = 1; j < 5; j++) {
          var p = x.getImageData(Math.floor(c.width * i / 5), Math.floor(c.height * j / 5), 1, 1).data;
          var v = p[0] + ',' + p[1] + ',' + p[2] + ',' + p[3];
          if (first === null) first = v; else if (v !== first) { same = false; break; }
        }
      }
      return same;
    } catch (e) { return null; }
  }
  function report() {
    var cs = Array.prototype.slice.call(document.querySelectorAll('canvas')).map(function (c) {
      var r = c.getBoundingClientRect();
      return { w: c.width, h: c.height, cw: Math.round(r.width), ch: Math.round(r.height), type: ctxType.get(c) || '', blank: blank(c) };
    });
    var b = document.body;
    return {
      errors: errors.map(function (e) { return { kind: e.kind, msg: e.msg, line: e.line, col: e.col, stack: e.stack, count: e.count, t: e.t }; }),
      frames: frames,
      uptime: Math.round(performance.now()),
      canvases: cs,
      text: ((b && b.innerText) || '').replace(/\s+/g, ' ').trim().slice(0, 300),
      buttons: document.querySelectorAll('button,[onclick],[role=button]').length,
      vw: innerWidth, vh: innerHeight,
      scrollW: document.documentElement.scrollWidth, scrollH: document.documentElement.scrollHeight
    };
  }

  function fire(el, type, x, y, Ctor, extra) {
    try {
      var o = { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, pointerType: 'touch', isPrimary: true, button: 0, buttons: type.indexOf('down') >= 0 || type.indexOf('start') >= 0 ? 1 : 0 };
      for (var k in extra) { o[k] = extra[k]; }
      el.dispatchEvent(new Ctor(type, o));
    } catch (e) {}
  }
  function tap(x, y) {
    var el = document.elementFromPoint(x, y) || document.body;
    fire(el, 'pointerdown', x, y, window.PointerEvent || MouseEvent, {});
    fire(el, 'mousedown', x, y, MouseEvent, {});
    try {
      var t = new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
      fire(el, 'touchstart', x, y, TouchEvent, { touches: [t], targetTouches: [t], changedTouches: [t] });
      setTimeout(function () { fire(el, 'touchend', x, y, TouchEvent, { touches: [], targetTouches: [], changedTouches: [t] }); }, 60);
    } catch (e) {}
    setTimeout(function () {
      fire(el, 'pointerup', x, y, window.PointerEvent || MouseEvent, {});
      fire(el, 'mouseup', x, y, MouseEvent, {});
      fire(el, 'click', x, y, MouseEvent, {});
    }, 80);
  }
  function key(code, k) {
    var o = { key: k, code: code, bubbles: true, cancelable: true };
    try { window.dispatchEvent(new KeyboardEvent('keydown', o)); document.dispatchEvent(new KeyboardEvent('keydown', o)); } catch (e) {}
    setTimeout(function () { try { window.dispatchEvent(new KeyboardEvent('keyup', o)); document.dispatchEvent(new KeyboardEvent('keyup', o)); } catch (e) {} }, 120);
  }
  function poke() {
    var w = innerWidth, h = innerHeight, steps = [];
    var btn = document.querySelector('button:not([disabled]),[role=button]');
    if (btn) steps.push(function () { try { btn.click(); } catch (e) {} });
    steps.push(function () { tap(w / 2, h / 2); });
    steps.push(function () { key('Enter', 'Enter'); });
    steps.push(function () { key('Space', ' '); });
    steps.push(function () { tap(w * 0.25, h * 0.8); });
    steps.push(function () { key('ArrowRight', 'ArrowRight'); });
    steps.push(function () { tap(w * 0.75, h * 0.8); });
    steps.push(function () { key('ArrowUp', 'ArrowUp'); });
    steps.push(function () { tap(w / 2, h * 0.3); });
    steps.forEach(function (f, i) { setTimeout(f, i * 160); });
  }

  window.addEventListener('message', function (ev) {
    var d = ev.data || {};
    if (d.__gsCmd === 'report') send({ type: 'report', id: d.id, report: report() });
    if (d.__gsCmd === 'poke') poke();
    if (d.__gsCmd === 'release') { lost = true; release(); }
  });
  document.addEventListener('DOMContentLoaded', function () { send({ type: 'ready' }); });
})();
