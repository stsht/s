/* StarShots shared gate intro
 *
 * One tiny controller for the access-card intro used by /inv, /l,
 * /admin, /db, and /g/<slug>. It deliberately owns only transform,
 * opacity, focus timing, logo bounce delegation, and button sheen.
 */
(function () {
  'use strict';

  var GATE_SELECTOR = '[data-ss-gate-card],.ss-gate-card';
  var REVEAL_SELECTOR = '[data-ss-gate-reveal],[data-reveal],.reveal';
  var BUTTON_SELECTOR = '[data-ss-gate-button],.ss-gate-button,#adminOpen,#loginBtn,#unlockBtn,.primary,.btn.primary';
  var INPUT_SELECTOR = '[data-ss-gate-input],input[type="password"]';

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

  function sheen(button, duration) {
    if (!button) return;
    duration = duration == null ? 0 : duration;
    button.classList.remove('is-sheen');
    void button.offsetWidth;
    button.classList.add('is-sheen');
    if (duration > 0) setTimeout(function () { button.classList.remove('is-sheen'); }, duration);
  }

  function bounce(root) {
    if (window.StarShotsReveal && typeof window.StarShotsReveal.bounceLogos === 'function') {
      window.StarShotsReveal.bounceLogos(root || document);
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
    var buttons = card.querySelectorAll ? card.querySelectorAll(BUTTON_SELECTOR) : [];
    for (var i = 0; i < buttons.length; i++) buttons[i].classList.remove('is-sheen');
  }

  function startIdle(card, settings) {
    if (!card || reduceMotion()) return;
    settings = settings || resolveOptions(card);
    card.classList.add('is-idle');
    if (settings.button) sheen(settings.button);
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
    startIdle: startIdle,
    stopIdle: stopIdle,
    show: show
  };

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
