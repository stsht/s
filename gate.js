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
  var SPLASH_LOOP_MS = 2800;
  var SPLASH_BOOM_DELAY_MS = 1360;

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
    // Why this style block exists, in plain English:
    //
    //   The brand wrapper used to render two animated rings via CSS
    //   ::before/::after pseudos. Those rings have been removed
    //   from gate.css, so this block:
    //     1. NEUTRALIZES any leftover ::before/::after styles from
    //        page-level CSS overrides on /inv and /l (defensive —
    //        those pages were never sources of rings, but they
    //        do declare their own .gate-brand rules).
    //     2. Forces .ss-gate-brand to position:relative + visible
    //        overflow so the absolutely-positioned droplet spans
    //        anchor to the logo and aren't clipped by the brand
    //        box.
    //     3. Defines .ss-water-splash — a single droplet element.
    //
    //   Droplet design:
    //     - Starts as a 2px × 2px gold pill INSIDE the logo, fully
    //       transparent.
    //     - Fades in to peak opacity ~14 % in.
    //     - At ~50 % it has grown to its full size (--ss-splash-w x
    //       --ss-splash-h) and travelled half-way along its random
    //       outward vector (--ss-splash-dx / --ss-splash-dy).
    //     - At 100 % it has reached the end of its travel, has
    //       shrunk back to a tail and faded out — like a real
    //       water droplet trailing into mist.
    //     - z-index: 3 — IN FRONT of the logo (the logo itself
    //       sits at z-index 1 inside the brand box because of the
    //       intro reveal stacking), per the user's request.
    //     - border-radius: 50% so the droplet reads as a soft pill
    //       at every scale, with a slight vertical squash from the
    //       differing width/height.
    //     - background tint comes from --ss-splash-color (gold or
    //       gold-2) so we can stagger warm/cool droplets within
    //       the same burst.
    //     - A subtle 1px highlight on the inner top-left edge sells
    //       the "wet" look without needing real shaders.
    style.textContent = '\
.ss-gate-card .ss-gate-brand::before,.ss-gate-card .ss-gate-brand::after,.ss-gate-card .gate-brand::before,.ss-gate-card .gate-brand::after,.ss-gate-card .brand::before,.ss-gate-card .brand::after{content:none!important;display:none!important;border:0!important;opacity:0!important;-webkit-animation:none!important;animation:none!important}\
.ss-gate-card .ss-gate-brand,.ss-gate-card .gate-brand,.ss-gate-card .brand{position:relative!important;overflow:visible!important}\
.ss-water-splash{position:absolute;left:var(--ss-splash-left);top:var(--ss-splash-top);width:var(--ss-splash-w);height:var(--ss-splash-h);margin:calc(var(--ss-splash-h) / -2) 0 0 calc(var(--ss-splash-w) / -2);pointer-events:none;z-index:3;opacity:0;border-radius:50%;background:var(--ss-splash-color,var(--ss-gate-gold,#d0bb99));box-shadow:inset 1px 1px 0 rgba(255,255,255,.45),0 0 6px color-mix(in srgb,var(--ss-splash-color,var(--ss-gate-gold,#d0bb99)) 30%,transparent);transform-origin:50% 50%;transform:translate3d(0,0,0) scale(calc(2 / var(--ss-splash-w-num,80)),calc(2 / var(--ss-splash-h-num,80)));animation:ssWaterDroplet var(--ss-splash-duration,820ms) cubic-bezier(.22,1,.36,1) forwards}\
@keyframes ssWaterDroplet{\
0%{opacity:0;transform:translate3d(0,0,0) scale(calc(2 / var(--ss-splash-w-num,80)),calc(2 / var(--ss-splash-h-num,80)))}\
14%{opacity:.95}\
50%{opacity:.78;transform:translate3d(calc(var(--ss-splash-dx) * .55),calc(var(--ss-splash-dy) * .55),0) scale(1,1) rotate(var(--ss-splash-rot,0deg))}\
80%{opacity:.42;transform:translate3d(calc(var(--ss-splash-dx) * .92),calc(var(--ss-splash-dy) * .92),0) scale(.78,.66) rotate(calc(var(--ss-splash-rot,0deg) * 1.3))}\
100%{opacity:0;transform:translate3d(var(--ss-splash-dx),var(--ss-splash-dy),0) scale(.18,.14) rotate(calc(var(--ss-splash-rot,0deg) * 1.5))}\
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
   * Spawn a single burst of water droplets at the logo's BOOM moment.
   *
   * Choreography per droplet:
   *   - Start as a 2 × 2 px gold pill at a random spawn point INSIDE
   *     the logo bounds. The CSS keyframe scales the pill from
   *     (2 / w, 2 / h) to (1, 1) by 50 %, so the droplet visually
   *     "grows out" of a single pixel as it leaves the logo.
   *   - Travel along a random outward vector with a strong upward
   *     bias. The vector is sampled in the upper hemisphere
   *     (-Math.PI .. 0) about 70 % of the time so droplets mostly
   *     fly UP and OUT, like a real splash. The remaining 30 % fan
   *     to the sides — never straight down (that would read as
   *     drips, which is the wrong feeling for a "boom").
   *   - The user asked for a top-left fallback, so when the spawn
   *     biases to non-random it picks a point in the upper-left
   *     quadrant of the logo and a vector that points further
   *     up-and-left. We use random spawn most of the time; the
   *     top-left bias is the fallback for the FIRST droplet of
   *     each burst so the splash always has a clear reading even
   *     when the random angles cluster.
   *   - At the tail end the droplet shrinks to ~14 % of its peak
   *     size and fades to 0, so it dissolves into a tiny pixel
   *     (the same way it started) — a clean trail rather than a
   *     popped bubble.
   *
   * Count per burst: 1 or 3, chosen at random. Three droplets reads
   * as a real splash; a lone droplet reads as a single drop ricochet
   * — both feel deliberate, neither feels mechanical.
   */
  function splashOnce(card) {
    if (!card || reduceMotion() || hasHiddenAncestor(card)) return;
    ensureSplashStyles();
    var brand = brandFor(card);
    var logo = logoFor(brand);
    if (!brand || !logo || !brand.getBoundingClientRect || !logo.getBoundingClientRect) return;

    var brandRect = brand.getBoundingClientRect();
    var logoRect = logo.getBoundingClientRect();
    if (!logoRect.width || !logoRect.height) return;

    // Logo center expressed in brand-local coordinates. Every droplet
    // spawn point is computed relative to this point so the burst
    // tracks the logo even on responsive resizes between loops.
    var logoCenterX = logoRect.left - brandRect.left + logoRect.width / 2;
    var logoCenterY = logoRect.top - brandRect.top + logoRect.height / 2;
    var halfW = logoRect.width / 2;
    var halfH = logoRect.height / 2;

    // 1 or 3, never 2 — per the user's spec.
    var count = Math.random() < 0.5 ? 1 : 3;

    for (var i = 0; i < count; i++) {
      // Spawn point selection.
      //   - First droplet of each burst: 65 % of the time we drop it
      //     in the upper-left of the logo (the user's requested
      //     fallback); otherwise we sample the whole logo.
      //   - Subsequent droplets: always random across the full logo
      //     so a 3-droplet burst doesn't bunch in one corner.
      var spawnFx, spawnFy;
      if (i === 0 && Math.random() < 0.65) {
        spawnFx = random(-0.85, -0.15); // left half
        spawnFy = random(-0.80, -0.10); // upper half
      } else {
        spawnFx = random(-0.85, 0.85);
        spawnFy = random(-0.85, 0.85);
      }
      var spawnX = logoCenterX + spawnFx * halfW;
      var spawnY = logoCenterY + spawnFy * halfH;

      // Travel vector. Bias upward (negative Y) ~70 % of the time so
      // the burst reads as a splash, not a drip. The other 30 % fan
      // out sideways.
      var upwardBias = Math.random() < 0.70;
      var angle = upwardBias
        ? random(-Math.PI * 0.92, -Math.PI * 0.08)   // upper hemisphere
        : (Math.random() < 0.5 ? random(-Math.PI * 0.08, Math.PI * 0.18)
                               : random(Math.PI * 0.82, Math.PI * 1.08));
      var distance = random(36, 72);
      var dx = Math.cos(angle) * distance;
      // Add a small extra lift so even sideways droplets arc up a bit.
      var dy = Math.sin(angle) * distance - random(2, 10);

      // Droplet size. Slight variance so the three-burst doesn't
      // look like clones. Width is biased a touch larger than height
      // so the droplet reads as a vertical pill — the canonical
      // water-droplet shape.
      var dw = random(7, 12);
      var dh = random(9, 14);

      var el = document.createElement('span');
      el.className = 'ss-water-splash';
      el.setAttribute('aria-hidden', 'true');
      el.style.setProperty('--ss-splash-left', spawnX.toFixed(1) + 'px');
      el.style.setProperty('--ss-splash-top', spawnY.toFixed(1) + 'px');
      el.style.setProperty('--ss-splash-w', dw.toFixed(1) + 'px');
      el.style.setProperty('--ss-splash-h', dh.toFixed(1) + 'px');
      // The keyframe needs the pixel dimensions as raw numbers so it
      // can compute "scale = 2px / size" without a calc(... / px) —
      // calc() can't divide by a length, only by a unitless number.
      el.style.setProperty('--ss-splash-w-num', dw.toFixed(2));
      el.style.setProperty('--ss-splash-h-num', dh.toFixed(2));
      el.style.setProperty('--ss-splash-dx', dx.toFixed(1) + 'px');
      el.style.setProperty('--ss-splash-dy', dy.toFixed(1) + 'px');
      // Tiny rotation so the pill tumbles slightly mid-flight; reads
      // as wind/tumble rather than a perfectly rigid translation.
      el.style.setProperty('--ss-splash-rot', random(-22, 22).toFixed(1) + 'deg');
      // Per-droplet duration: shorter ones feel snappier on the
      // small droplets, the larger one lingers a touch.
      var dur = Math.round(random(700, 920));
      el.style.setProperty('--ss-splash-duration', dur + 'ms');
      // Warm/cool alternation gives the burst depth without needing
      // a real lighting model. First droplet always uses the primary
      // gold so the eye locks onto it.
      el.style.setProperty('--ss-splash-color', i === 0
        ? 'var(--ss-gate-gold,#d0bb99)'
        : (Math.random() < 0.5 ? 'var(--ss-gate-gold-2,#a79074)'
                               : 'var(--ss-gate-gold,#d0bb99)'));
      // Stagger droplets within the same burst by a few ms so they
      // don't all leave the logo at the exact same frame.
      el.style.animationDelay = random(0, 60).toFixed(0) + 'ms';
      brand.appendChild(el);
      el.addEventListener('animationend', function (event) {
        if (event && event.target) event.target.remove();
      }, { once: true });
      // Hard cleanup in case animationend never fires (engine quirk
      // when the tab is backgrounded mid-animation).
      setTimeout((function (node) {
        return function () { if (node && node.parentNode) node.remove(); };
      }(el)), dur + 220);
    }
  }

  function stopSplashLoop(card) {
    if (!card) return;
    if (card.__ssSplashTimeout) clearTimeout(card.__ssSplashTimeout);
    if (card.__ssSplashInterval) clearInterval(card.__ssSplashInterval);
    card.__ssSplashTimeout = null;
    card.__ssSplashInterval = null;
    clearSplashes(card);
  }

  function startSplashLoop(card) {
    if (!card || reduceMotion()) return;
    stopSplashLoop(card);
    card.__ssSplashTimeout = setTimeout(function () {
      splashOnce(card);
      card.__ssSplashInterval = setInterval(function () { splashOnce(card); }, SPLASH_LOOP_MS);
    }, SPLASH_BOOM_DELAY_MS);
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
