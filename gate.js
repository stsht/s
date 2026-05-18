/* StarShots shared gate intro
 *
 * One tiny controller for the access-card intro used by /inv, /l,
 * /admin, /db, and /g/<slug>. It deliberately owns only transform,
 * opacity, focus timing, logo bounce delegation, button sheen, and
 * the short water-splash accent at the logo boom moment.
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
    style.textContent = '\
.ss-gate-card .ss-gate-brand::before,.ss-gate-card .ss-gate-brand::after,.ss-gate-card .gate-brand::before,.ss-gate-card .gate-brand::after,.ss-gate-card .brand::before,.ss-gate-card .brand::after{content:none!important;display:none!important;border:0!important;opacity:0!important;-webkit-animation:none!important;animation:none!important}\
.ss-gate-card .ss-gate-brand,.ss-gate-card .gate-brand,.ss-gate-card .brand{overflow:visible!important}\
.ss-water-splash{position:absolute;left:var(--ss-splash-left);top:var(--ss-splash-top);width:var(--ss-splash-w);height:var(--ss-splash-h);pointer-events:none;z-index:2;opacity:0;color:var(--ss-splash-color,var(--ss-gate-gold,#d0bb99));transform-origin:50% 86%;transform:translate3d(-50%,-50%,0) rotate(var(--ss-splash-rot)) scale(.44,.36);animation:ssWaterSplash 760ms cubic-bezier(.22,1,.36,1) forwards}\
.ss-water-splash svg{display:block;width:100%;height:100%;overflow:visible}\
.ss-water-splash path{fill:none;stroke:currentColor;stroke-width:14;stroke-linecap:round;stroke-linejoin:round;opacity:.72;vector-effect:non-scaling-stroke}\
.ss-water-splash.is-mini path{stroke-width:12;opacity:.54}\
@keyframes ssWaterSplash{0%{opacity:0;transform:translate3d(-50%,-50%,0) rotate(var(--ss-splash-rot)) scale(.44,.36)}16%{opacity:.78}55%{opacity:.42;transform:translate3d(calc(-50% + var(--ss-splash-dx) * .46),calc(-50% + var(--ss-splash-dy) * .46),0) rotate(calc(var(--ss-splash-rot) + var(--ss-splash-spin) * .46)) scale(.94,.78)}100%{opacity:0;transform:translate3d(calc(-50% + var(--ss-splash-dx)),calc(-50% + var(--ss-splash-dy)),0) rotate(calc(var(--ss-splash-rot) + var(--ss-splash-spin))) scale(1.12,.9)}}\
@media(prefers-reduced-motion:reduce){html:not(.ss-force-motion) .ss-water-splash{display:none!important}}';
    document.head.appendChild(style);
  }

  function brandFor(card) {
    return scopedFind(card, '.ss-gate-brand,.gate-brand,.brand') || card;
  }

  function logoFor(brand) {
    return scopedFind(brand, '.ss-logo-hero,.ss-gate-logo,.gate-logo,img') || brand;
  }

  function splashMarkup() {
    return '<svg viewBox="0 0 260 170" aria-hidden="true" focusable="false">' +
      '<path d="M127 151 C112 112 91 79 62 69 C35 60 15 80 15 104 C15 129 35 140 62 133 C91 126 111 133 127 151"/>' +
      '<path d="M130 151 C123 116 100 83 85 49 C73 22 89 7 112 19 C145 36 153 82 132 132"/>' +
      '<path d="M147 151 C159 116 183 87 214 76 C241 67 257 88 252 113 C245 141 219 144 194 136 C172 129 156 136 147 151"/>' +
      '</svg>';
  }

  function clearSplashes(card) {
    if (!card || !card.querySelectorAll) return;
    var splashes = card.querySelectorAll('.ss-water-splash');
    for (var i = 0; i < splashes.length; i++) splashes[i].remove();
  }

  function splashOnce(card) {
    if (!card || reduceMotion() || hasHiddenAncestor(card)) return;
    ensureSplashStyles();
    var brand = brandFor(card);
    var logo = logoFor(brand);
    if (!brand || !logo || !brand.getBoundingClientRect || !logo.getBoundingClientRect) return;

    var brandRect = brand.getBoundingClientRect();
    var logoRect = logo.getBoundingClientRect();
    var baseLeft = logoRect.left - brandRect.left + (logoRect.width / 2);
    var baseTop = logoRect.top - brandRect.top + (logoRect.height * random(.16, .26));
    var pieces = [
      { w: random(94, 124), h: random(60, 78), x: 0, y: random(-13, -7), mini: false },
      { w: random(52, 70), h: random(34, 46), x: random(-42, -24), y: random(-6, 4), mini: true },
      { w: random(52, 70), h: random(34, 46), x: random(24, 42), y: random(-6, 4), mini: true }
    ];

    for (var i = 0; i < pieces.length; i++) {
      var p = pieces[i];
      var el = document.createElement('span');
      el.className = 'ss-water-splash' + (p.mini ? ' is-mini' : '');
      el.setAttribute('aria-hidden', 'true');
      el.innerHTML = splashMarkup();
      el.style.setProperty('--ss-splash-left', (baseLeft + p.x + random(-5, 5)).toFixed(1) + 'px');
      el.style.setProperty('--ss-splash-top', (baseTop + p.y + random(-3, 3)).toFixed(1) + 'px');
      el.style.setProperty('--ss-splash-w', p.w.toFixed(1) + 'px');
      el.style.setProperty('--ss-splash-h', p.h.toFixed(1) + 'px');
      el.style.setProperty('--ss-splash-dx', random(-8, 8).toFixed(1) + 'px');
      el.style.setProperty('--ss-splash-dy', random(-16, -5).toFixed(1) + 'px');
      el.style.setProperty('--ss-splash-rot', random(-7, 7).toFixed(1) + 'deg');
      el.style.setProperty('--ss-splash-spin', random(-9, 9).toFixed(1) + 'deg');
      el.style.setProperty('--ss-splash-color', i === 0 ? 'var(--ss-gate-gold,#d0bb99)' : 'var(--ss-gate-gold-2,#a79074)');
      el.style.animationDelay = random(0, 54).toFixed(0) + 'ms';
      brand.appendChild(el);
      el.addEventListener('animationend', function (event) {
        if (event && event.target) event.target.remove();
      }, { once: true });
      setTimeout((function (node) {
        return function () { if (node && node.parentNode) node.remove(); };
      }(el)), 980);
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
