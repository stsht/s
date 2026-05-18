/* StarShots shared gate intro
 *
 * One tiny controller for the access-card intro used by /inv, /l,
 * /admin, /db, and /g/<slug>. It deliberately owns only transform,
 * opacity, focus timing, logo bounce delegation, button sheen, and
 * the droplet splash burst that fires at the logo BOOM moment.
 */
(function () {
  'use strict';

  var GATE_SELECTOR = '[data-ss-gate-card],.ss-gate-card';
  var REVEAL_SELECTOR = '[data-ss-gate-reveal],[data-reveal],.reveal';
  var BUTTON_SELECTOR = '[data-ss-gate-button],.ss-gate-button,#adminOpen,#loginBtn,#unlockBtn,.primary,.btn.primary';
  var INPUT_SELECTOR = '[data-ss-gate-input],input[type="password"]';
  var SPLASH_STYLE_ID = 'ss-water-splash-style';
  // Continuous-emit cadence. The previous build fired a burst of
  // 1 or 3 droplets at the BOOM moment of every bounce loop, which
  // looked like one frame of activity per ~3 s of stillness — and
  // the burst itself shared the GPU paint budget with the bounce,
  // so both effects dropped to ~1 fps. The new build emits a single
  // droplet every SPLASH_EMIT_AVG_MS ± SPLASH_EMIT_JITTER_MS and
  // scrolls the whole stream off the top of the logo, so the rhythm
  // is "always something in flight" instead of "burst then idle".
  var SPLASH_EMIT_AVG_MS = 230;
  var SPLASH_EMIT_JITTER_MS = 110;
  // After this many simultaneous droplets we skip a frame's emit so
  // a backgrounded tab waking up doesn't dump 200 droplets at once.
  var SPLASH_MAX_CONCURRENT = 12;
  // First droplet kicks in this long after .is-idle lands so the
  // logo's first bounce reads cleanly before the rain starts.
  var SPLASH_LEAD_IN_MS = 800;

  function asElement(value) {
    if (!value) return null;
    if (value.nodeType === 1) return value;
    if (typeof value === 'string') return document.querySelector(value);
    return null;
  }

  function isTouchViewport() {
    try {
      return window.matchMedia('(max-width: 640px), (pointer: coarse)').matches;
    } catch (e) {
      return false;
    }
  }

  function reduceMotion() {
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches &&
        !document.documentElement.classList.contains('ss-force-motion');
    } catch (e) {
      return false;
    }
  }

  function scopedFind(root, selector) {
    if (!root) return null;
    if (root.matches && root.matches(selector)) return root;
    return root.querySelector ? root.querySelector(selector) : null;
  }

  function collectReveals(root) {
    if (!root || !root.querySelectorAll) return [];
    var out = [];
    if (root.matches && root.matches(REVEAL_SELECTOR)) out.push(root);
    var found = root.querySelectorAll(REVEAL_SELECTOR);
    for (var i = 0; i < found.length; i++) out.push(found[i]);
    return out.filter(function (el, index) {
      return out.indexOf(el) === index && !el.closest('[data-ss-gate-ignore]');
    });
  }

  function focusSoon(input, options) {
    options = options || {};
    if (!input) return;
    if (!options.allowTouch && isTouchViewport()) return;
    var delay = options.delay == null ? 80 : Number(options.delay) || 0;
    setTimeout(function () {
      try { input.focus({ preventScroll: true }); } catch (e) { try { input.focus(); } catch (ignore) {} }
    }, delay);
  }

  function revealIn(el, delay) {
    if (!el) return;
    setTimeout(function () { el.classList.add('is-visible'); }, delay);
  }

  function random(min, max) {
    return min + Math.random() * (max - min);
  }

  function ensureSplashStyles() {
    if (document.getElementById(SPLASH_STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = SPLASH_STYLE_ID;
    // GPU-cheap droplet style block.
    //
    //   The previous build painted box-shadow + color-mix() per frame
    //   and used calc(... / var()) inside keyframes, which forced a
    //   full style recalc + repaint every animation tick. Result:
    //   the droplet rendered at ~1 fps and starved the bounce
    //   keyframe of paint budget so the logo dropped to ~24 fps.
    //
    //   Now: transform + opacity ONLY. No shadow, no color-mix, no
    //   calc-divides in keyframes. The starting scale is computed
    //   in JS (--ss-splash-start-scale) so the keyframe just reads
    //   a numeric variable. Each droplet element gets its own
    //   composited GPU layer (will-change:transform,opacity), so
    //   ten droplets in flight cost ~one extra layer composite per
    //   frame instead of ten repaints.
    //
    //   The brand wrapper still needs position:relative + visible
    //   overflow so droplets anchor to the logo and aren't clipped.
    style.textContent = '\
.ss-gate-card .ss-gate-brand::before,.ss-gate-card .ss-gate-brand::after,.ss-gate-card .gate-brand::before,.ss-gate-card .gate-brand::after,.ss-gate-card .brand::before,.ss-gate-card .brand::after{content:none!important;display:none!important;border:0!important;opacity:0!important;-webkit-animation:none!important;animation:none!important}\
.ss-gate-card .ss-gate-brand,.ss-gate-card .gate-brand,.ss-gate-card .brand{position:relative!important;overflow:visible!important}\
.ss-water-splash{position:absolute;left:var(--ss-splash-left);top:var(--ss-splash-top);width:var(--ss-splash-w);height:var(--ss-splash-h);margin:calc(var(--ss-splash-h) / -2) 0 0 calc(var(--ss-splash-w) / -2);pointer-events:none;z-index:3;opacity:0;border-radius:50%;background:var(--ss-splash-color,#d0bb99);will-change:transform,opacity;-webkit-transform-origin:50% 50%;transform-origin:50% 50%;-webkit-transform:translate3d(0,0,0) scale(var(--ss-splash-start-scale,.04));transform:translate3d(0,0,0) scale(var(--ss-splash-start-scale,.04));-webkit-animation:ssWaterDroplet var(--ss-splash-duration,1600ms) cubic-bezier(.22,.61,.36,1) forwards;animation:ssWaterDroplet var(--ss-splash-duration,1600ms) cubic-bezier(.22,.61,.36,1) forwards}\
@-webkit-keyframes ssWaterDroplet{\
0%{opacity:0;-webkit-transform:translate3d(0,0,0) scale(var(--ss-splash-start-scale,.04))}\
12%{opacity:.92}\
55%{opacity:.78;-webkit-transform:translate3d(calc(var(--ss-splash-dx) * .55),calc(var(--ss-splash-dy) * .55),0) scale(1)}\
85%{opacity:.34;-webkit-transform:translate3d(calc(var(--ss-splash-dx) * .94),calc(var(--ss-splash-dy) * .94),0) scale(.62)}\
100%{opacity:0;-webkit-transform:translate3d(var(--ss-splash-dx),var(--ss-splash-dy),0) scale(.18)}\
}\
@keyframes ssWaterDroplet{\
0%{opacity:0;transform:translate3d(0,0,0) scale(var(--ss-splash-start-scale,.04))}\
12%{opacity:.92}\
55%{opacity:.78;transform:translate3d(calc(var(--ss-splash-dx) * .55),calc(var(--ss-splash-dy) * .55),0) scale(1)}\
85%{opacity:.34;transform:translate3d(calc(var(--ss-splash-dx) * .94),calc(var(--ss-splash-dy) * .94),0) scale(.62)}\
100%{opacity:0;transform:translate3d(var(--ss-splash-dx),var(--ss-splash-dy),0) scale(.18)}\
}\
@media(prefers-reduced-motion:reduce){html:not(.ss-force-motion) .ss-water-splash{display:none!important}}';
    document.head.appendChild(style);
  }

  function brandFor(card) {
    return scopedFind(card, '.ss-gate-brand,.gate-brand,.brand') || card;
  }

  function logoFor(brand) {
    return scopedFind(brand, '.ss-logo-hero,.ss-gate-logo,.gate-logo,img') || brand;
  }

  function clearSplashes(card) {
    if (!card || !card.querySelectorAll) return;
    var splashes = card.querySelectorAll('.ss-water-splash');
    for (var i = 0; i < splashes.length; i++) splashes[i].remove();
  }

  /*
   * Spawn ONE droplet at a random spot inside the logo.
   *
   * The continuous emitter (startSplashLoop below) calls this every
   * ~230 ms ± 110 ms, so over a single bounce period (4.2 s) we get
   * ~15-20 droplets in flight at any time and the stream looks like
   * rain rather than a burst.
   *
   * Droplet choreography:
   *   - Born as a tiny pixel at the spawn point (start scale is
   *     computed so a 10 px droplet reads as ~1 px on frame 0;
   *     this is what gives the "growing out of the logo" feel).
   *   - Animation duration: 1400-2200 ms. Slow on purpose so each
   *     frame moves a small delta — the engine doesn't have to
   *     paint a long stroke per frame.
   *   - Travel vector: upward hemisphere ~70 % of the time so the
   *     stream reads as a splash, not as drips. Sideways droplets
   *     get a small extra lift so they still arc up.
   *   - First droplet of the stream (and ~30 % of the rest) biases
   *     to the upper-left of the logo — the user's requested
   *     fallback when the random spot doesn't read clearly.
   */
  function splashOnce(card) {
    if (!card || reduceMotion() || hasHiddenAncestor(card)) return;
    ensureSplashStyles();
    var brand = brandFor(card);
    var logo = logoFor(brand);
    if (!brand || !logo || !brand.getBoundingClientRect || !logo.getBoundingClientRect) return;

    // Concurrent droplet cap. If we're already at the cap, skip this
    // tick. The next emitter call will try again. This prevents a
    // backgrounded tab from waking up and dumping a queue.
    if (brand.querySelectorAll('.ss-water-splash').length >= SPLASH_MAX_CONCURRENT) return;

    var brandRect = brand.getBoundingClientRect();
    var logoRect = logo.getBoundingClientRect();
    if (!logoRect.width || !logoRect.height) return;

    var logoCenterX = logoRect.left - brandRect.left + logoRect.width / 2;
    var logoCenterY = logoRect.top - brandRect.top + logoRect.height / 2;
    var halfW = logoRect.width / 2;
    var halfH = logoRect.height / 2;

    // Spawn point. ~30 % of droplets bias to upper-left (the user's
    // requested fallback), the rest sample the whole logo.
    var spawnFx, spawnFy;
    if (Math.random() < 0.30) {
      spawnFx = random(-0.85, -0.10);
      spawnFy = random(-0.80, -0.05);
    } else {
      spawnFx = random(-0.85, 0.85);
      spawnFy = random(-0.85, 0.85);
    }
    var spawnX = logoCenterX + spawnFx * halfW;
    var spawnY = logoCenterY + spawnFy * halfH;

    // Travel vector. Upward hemisphere most of the time so the
    // stream reads as a splash, not as drips.
    var upwardBias = Math.random() < 0.72;
    var angle = upwardBias
      ? random(-Math.PI * 0.92, -Math.PI * 0.08)
      : (Math.random() < 0.5 ? random(-Math.PI * 0.08, Math.PI * 0.18)
                             : random(Math.PI * 0.82, Math.PI * 1.08));
    var distance = random(44, 88);
    var dx = Math.cos(angle) * distance;
    var dy = Math.sin(angle) * distance - random(3, 12);

    // Droplet size. Slight variance so the stream doesn't look like
    // identical clones.
    var dw = random(7, 12);
    var dh = random(9, 14);

    // Pre-compute the starting scale in JS so the keyframe doesn't
    // have to do a calc(... / px) divide per frame. Target a ~1 px
    // visual at frame 0 regardless of the droplet's full size.
    var startScale = (2 / Math.max(dw, dh)).toFixed(4);

    // Per-droplet duration: 1400-2200 ms. The slowest droplets are
    // the most upward — they have the longest arc. Snappier on
    // sideways droplets so the stream stays varied.
    var dur = Math.round(upwardBias ? random(1600, 2200) : random(1400, 1850));

    var el = document.createElement('span');
    el.className = 'ss-water-splash';
    el.setAttribute('aria-hidden', 'true');
    var s = el.style;
    s.setProperty('--ss-splash-left', spawnX.toFixed(1) + 'px');
    s.setProperty('--ss-splash-top', spawnY.toFixed(1) + 'px');
    s.setProperty('--ss-splash-w', dw.toFixed(1) + 'px');
    s.setProperty('--ss-splash-h', dh.toFixed(1) + 'px');
    s.setProperty('--ss-splash-dx', dx.toFixed(1) + 'px');
    s.setProperty('--ss-splash-dy', dy.toFixed(1) + 'px');
    s.setProperty('--ss-splash-start-scale', startScale);
    s.setProperty('--ss-splash-duration', dur + 'ms');
    // Plain rgba — no color-mix, no box-shadow. Two color choices
    // alternate so the stream has warm/cool variation.
    s.setProperty('--ss-splash-color', Math.random() < 0.55 ? '#d0bb99' : '#a79074');
    brand.appendChild(el);
    el.addEventListener('animationend', function () {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, { once: true });
    // Hard cleanup if animationend never fires (backgrounded tab).
    setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, dur + 250);
  }

  function stopSplashLoop(card) {
    if (!card) return;
    if (card.__ssSplashTimeout) clearTimeout(card.__ssSplashTimeout);
    card.__ssSplashTimeout = null;
    card.__ssSplashRunning = false;
    clearSplashes(card);
  }

  /*
   * Continuous droplet emitter.
   *
   * Schedules one splashOnce(card) call every SPLASH_EMIT_AVG_MS
   * ± SPLASH_EMIT_JITTER_MS using setTimeout (NOT setInterval — a
   * jittered timer is what makes the stream feel like rain instead
   * of a metronome). The function self-reschedules until
   * stopSplashLoop runs.
   *
   * Why setTimeout over rAF: the emit cadence is ~5 Hz; a 60 Hz rAF
   * loop just to sleep 11 frames between spawns would waste budget.
   * The droplet's own animation runs entirely on the compositor
   * (transform + opacity), so the emitter only needs to fire often
   * enough to keep new droplets entering the scene.
   */
  function startSplashLoop(card) {
    if (!card || reduceMotion()) return;
    stopSplashLoop(card);
    card.__ssSplashRunning = true;

    function tick() {
      if (!card.__ssSplashRunning) return;
      // Don't emit while the tab is hidden — wakes up to a flood
      // otherwise. The next visibilitychange handler restarts us.
      if (document.visibilityState === 'visible' && !hasHiddenAncestor(card)) {
        splashOnce(card);
      }
      var nextDelay = SPLASH_EMIT_AVG_MS + (Math.random() * 2 - 1) * SPLASH_EMIT_JITTER_MS;
      card.__ssSplashTimeout = setTimeout(tick, Math.max(80, nextDelay));
    }

    // Lead-in so the first bounce reads cleanly before the rain.
    card.__ssSplashTimeout = setTimeout(tick, SPLASH_LEAD_IN_MS);
  }

  function sheen(button, duration) {
    if (!button) return;
    duration = duration == null ? 0 : duration;
    button.classList.remove('is-sheen');
    void button.offsetWidth;
    button.classList.add('is-sheen');
    if (duration > 0) setTimeout(function () { button.classList.remove('is-sheen'); }, duration);
  }

  function bounce(root, opts) {
    if (window.StarShotsReveal && typeof window.StarShotsReveal.bounceLogos === 'function') {
      window.StarShotsReveal.bounceLogos(root || document, opts);
    }
  }

  function hasHiddenAncestor(el) {
    while (el && el.nodeType === 1 && el !== document.documentElement) {
      if (el.hidden || el.classList.contains('hidden')) return true;
      try {
        var style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return true;
      } catch (e) {}
      el = el.parentElement;
    }
    return false;
  }

  function markMounted(card) {
    card.classList.add('is-mounted', 'is-visible');
  }

  function stopIdle(card) {
    if (!card) return;
    card.classList.remove('is-idle');
    stopSplashLoop(card);
    var buttons = card.querySelectorAll ? card.querySelectorAll(BUTTON_SELECTOR) : [];
    for (var i = 0; i < buttons.length; i++) buttons[i].classList.remove('is-sheen');
  }

  function startIdle(card, settings) {
    if (!card || reduceMotion()) return;
    settings = settings || resolveOptions(card);
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(function () {
        bounce(card, { restart: true });
        card.classList.add('is-idle');
        startSplashLoop(card);
        if (settings.button) sheen(settings.button);
      });
    } else {
      bounce(card, { restart: true });
      card.classList.add('is-idle');
      startSplashLoop(card);
      if (settings.button) sheen(settings.button);
    }
  }

  function markUnmounted(card) {
    stopIdle(card);
    card.classList.remove('is-mounted', 'is-visible', 'is-leaving', 'is-settled');
  }

  function resolveOptions(card, options) {
    options = options || {};
    var root = asElement(options.root) || card;
    return {
      root: root,
      reveals: options.reveals ? Array.prototype.slice.call(options.reveals) : collectReveals(root),
      input: asElement(options.input) || scopedFind(card, INPUT_SELECTOR) || scopedFind(root, INPUT_SELECTOR),
      button: asElement(options.button) || scopedFind(card, BUTTON_SELECTOR) || scopedFind(root, BUTTON_SELECTOR),
      focus: options.focus !== false,
      allowTouchFocus: !!options.allowTouchFocus,
      sheen: options.sheen !== false,
      replay: !!options.replay,
      startAt: options.startAt,
      stagger: options.stagger,
      settleDelay: options.settleDelay == null ? 520 : Number(options.settleDelay) || 0
    };
  }

  function intro(cardOrSelector, options) {
    var card = asElement(cardOrSelector);
    if (!card) return false;

    var settings = resolveOptions(card, options);
    if (!settings.replay && (card.dataset.ssGateIntro === 'running' || card.classList.contains('is-mounted') || card.classList.contains('is-visible'))) {
      return false;
    }

    card.dataset.ssGateIntro = 'running';
    card.dataset.introState = 'running';
    markUnmounted(card);
    settings.reveals.forEach(function (el) { el.classList.remove('is-visible'); });

    if (reduceMotion()) {
      markMounted(card);
      settings.reveals.forEach(function (el) { el.classList.add('is-visible'); });
      card.dataset.ssGateIntro = 'done';
      card.dataset.introState = 'done';
      if (settings.focus) focusSoon(settings.input, { allowTouch: settings.allowTouchFocus });
      return true;
    }

    var isMobile = isTouchViewport();
    var stagger = settings.stagger == null ? (isMobile ? 75 : 90) : Number(settings.stagger) || 0;
    var startAt = settings.startAt == null ? (isMobile ? 180 : 300) : Number(settings.startAt) || 0;

    requestAnimationFrame(function () {
      void card.offsetWidth;
      requestAnimationFrame(function () {
        markMounted(card);

        settings.reveals.forEach(function (el, index) {
          revealIn(el, startAt + index * stagger);
        });

        var revealDuration = isMobile ? 560 : 820;
        var doneAt = startAt + Math.max(settings.reveals.length - 1, 0) * stagger + revealDuration + 160;
        setTimeout(function () {
          card.dataset.ssGateIntro = 'done';
          card.dataset.introState = 'done';
          if (settings.sheen) startIdle(card, settings);
        }, doneAt);

        if (settings.focus) {
          setTimeout(function () {
            focusSoon(settings.input, { allowTouch: settings.allowTouchFocus });
          }, isMobile ? 900 : 720);
        }

        setTimeout(function () {
          card.classList.add('is-settled');
        }, doneAt + settings.settleDelay);
      });
    });

    return true;
  }

  function show(cardOrSelector, options) {
    var card = asElement(cardOrSelector);
    if (!card) return false;
    var settings = resolveOptions(card, options);
    markMounted(card);
    settings.reveals.forEach(function (el) { el.classList.add('is-visible'); });
    card.dataset.ssGateIntro = 'done';
    card.dataset.introState = 'done';
    startIdle(card, settings);
    return true;
  }

  function reset(cardOrSelector, options) {
    var card = asElement(cardOrSelector);
    if (!card) return false;
    var settings = resolveOptions(card, options);
    markUnmounted(card);
    settings.reveals.forEach(function (el) { el.classList.remove('is-visible'); });
    card.dataset.ssGateIntro = '';
    card.dataset.introState = '';
    return true;
  }

  function find(root) {
    root = root && root.querySelectorAll ? root : document;
    return Array.prototype.slice.call(root.querySelectorAll(GATE_SELECTOR));
  }

  window.StarShotsGate = {
    bounce: bounce,
    find: find,
    focusSoon: focusSoon,
    intro: intro,
    reset: reset,
    sheen: sheen,
    splashOnce: splashOnce,
    startIdle: startIdle,
    stopIdle: stopIdle,
    show: show
  };

  ensureSplashStyles();

  window.addEventListener('pageshow', function (event) {
    if (!event.persisted) return;
    find(document).forEach(function (card) {
      if (hasHiddenAncestor(card)) return;
      if (card.classList.contains('is-mounted') || card.classList.contains('is-visible')) {
        startIdle(card);
      } else {
        show(card, { root: card });
      }
    });
  });
})();
