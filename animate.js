/* StarShots animate.js
 *
 * Single-engine intro / reveal helper for /, /admin, /db, /g/<slug>,
 * /<short>, /l, /inv.
 *
 * Design:
 *   - One source of truth. Pages keep their own bespoke timing
 *     cascades (kept for visual identity); this file ONLY:
 *       1. Drives the hero-logo bounce via Web Animations API. WAAPI
 *          is reliable on iOS Safari 13.1+ and does not need the
 *          force-reflow dance that CSS keyframe replay needs.
 *       2. Adds a `ss-js` class to <html> so the static CSS can opt
 *          into JS-only initial states without a flash-of-unstyled
 *          content when JS is unavailable.
 *       3. Provides a tiny `window.StarShotsReveal` shim so legacy
 *          inline scripts (the per-page intros in /l, /inv, /admin,
 *          /db, and the worker-rendered pages) keep working without
 *          fighting our timeline. Calls into the shim are no-ops or
 *          single forward-step actions; we never rewrite
 *          transitionDelay mid-flight any more.
 *       4. Re-runs the bounce + a safety reveal pass on bfcache
 *          restore (Safari Back/Forward cache).
 *       5. Has a hard 2200ms safety net: if a card the page declared
 *          as needing animation has not become visible, force it.
 *
 * iOS Safari quirks specifically handled here:
 *   - `offsetParent` is null for any element inside a position:fixed
 *     ancestor on iOS. The previous version of bounceLogos used
 *     `if (!logo.offsetParent && getComputedStyle(...) === 'none')`
 *     which silently skipped the bounce on the gate card on iPhone.
 *     We now use a getBoundingClientRect()-based visibility check.
 *   - `pageshow` with event.persisted === true means the page was
 *     restored from bfcache. The DOM is intact but no scripts
 *     re-ran, so we re-trigger the bounce and reveal pass.
 *   - We avoid Element.animate() if it is not present (very old
 *     iOS) and fall back to a CSS class replay.
 *   - We never mutate style.transitionDelay; that was the old
 *     mid-flight cancellation bug.
 */
(function () {
  'use strict';

  var HERO_LOGO_SELECTOR = '.ss-logo-hero';
  var REVEAL_SELECTOR = '[data-reveal],.reveal';
  var CARD_SELECTOR = '.access-card,.delivery-card,.gate-card';
  var INTRO_SELECTOR = '[data-ss-intro]';
  var SAFETY_TIMEOUT_MS = 2200;

  var docEl = document.documentElement;
  var forceMotion = docEl.classList.contains('ss-force-motion');
  var prefersReduced = false;
  try {
    prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches && !forceMotion;
  } catch (e) { /* very old browser */ }

  /* ----------------------------------------------------------------
   * Tiny utilities
   * ---------------------------------------------------------------- */
  function scopeFor(root) {
    return root && root.querySelectorAll ? root : document;
  }

  function isLayoutVisible(el) {
    if (!el) return false;
    // iOS-safe visibility test: offsetParent is null for descendants
    // of position:fixed, so we check the rect instead.
    var rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    var style = getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  function isNearViewport(el) {
    var rect = el.getBoundingClientRect();
    return rect.top < window.innerHeight * 1.15 && rect.bottom > -80;
  }

  /* ----------------------------------------------------------------
   * Hero logo bounce
   *
   * Choreography (per play, with small per-play randomness so it
   * never feels mechanical):
   *
   *   1. Fade in at near-final size (no flash of tiny logo).
   *   2. SQUEEZE 1 — "mencekung": non-uniform scale + skewY along a
   *      randomly-signed near-diagonal so one side dips and the
   *      other lifts. Reads as a cupped/3D press.
   *   3. BOOOM: scale punches past 1 (≈1.18), skew snaps back the
   *      other way for a counter-kick.
   *   4. Jiggle: two small rotation flicks in opposite directions.
   *   5. SQUEEZE 2 — softer mencekung with the opposite tilt.
   *   6. Tiny overshoot, micro dip, rest at scale(1).
   *
   * The squeeze axis sign and the magnitudes of rotation, skew, and
   * boom scale are jittered per play so a bfcache restore (or a
   * page revisit) doesn't replay the exact same motion.
   *
   * Primary path: Web Animations API. We cancel any in-flight
   * animation before re-playing so bfcache restores stay clean.
   * Fallback: CSS class replay with a forced reflow (uses the
   * static `ssBounceIn` keyframes in animate.css).
   * ---------------------------------------------------------------- */

  function _ssRand(min, max) { return min + Math.random() * (max - min); }
  function _ssSign() { return Math.random() < 0.5 ? -1 : 1; }

  function _ssTransform(parts) {
    // Always emit the same transform-list shape so WAAPI can
    // interpolate every keyframe pair without falling back to
    // matrix decomposition.
    var rot = parts.rot || 0;
    var skX = parts.skX || 0;
    var skY = parts.skY || 0;
    var sX  = parts.sX != null ? parts.sX : 1;
    var sY  = parts.sY != null ? parts.sY : 1;
    return 'translateZ(0) rotate(' + rot.toFixed(3) + 'deg)' +
           ' skewX(' + skX.toFixed(3) + 'deg)' +
           ' skewY(' + skY.toFixed(3) + 'deg)' +
           ' scale(' + sX.toFixed(4) + ',' + sY.toFixed(4) + ')';
  }

  function buildBounceKeyframes() {
    // axis: which way the first squeeze tilts. The boom + second
    // squeeze counter-tilt the opposite direction.
    var axis = _ssSign();
    var skewMag    = _ssRand(5.2, 7.8);   // deg, primary squeeze tilt
    var rotMag     = _ssRand(1.6, 2.8);   // deg, base rotation magnitude
    var boom       = _ssRand(1.15, 1.21); // peak scale on the BOOM
    var jiggleA    = _ssRand(2.6, 3.8);   // deg, first jiggle flick
    var jiggleB    = _ssRand(1.8, 2.8);   // deg, opposite jiggle
    var sq2YDip    = _ssRand(0.90, 0.94); // scaleY of the soft second squeeze

    // Tiny extra wobble in the squeeze so the two halves don't read
    // as a perfect diagonal (the user asked for "random, not exact
    // diagonal").
    var skXJitter = _ssRand(-1.6, 1.6);
    var skXJitter2 = _ssRand(-1.2, 1.2);

    return [
      // Pre-roll: invisible, slightly compressed, tiny pre-tilt.
      { transform: _ssTransform({ sX: .88, sY: .88, rot: -rotMag * 0.35 * axis }),
        opacity: 0, offset: 0 },

      // Fade in fast so the logo is already visible when the
      // squeeze starts.
      { transform: _ssTransform({ sX: .94, sY: .90, rot: -rotMag * 0.55 * axis,
                                  skX: skXJitter * 0.4, skY: skewMag * 0.55 * axis }),
        opacity: 1, offset: 0.10 },

      // SQUEEZE 1 / mencekung peak. scaleY is the deepest dip;
      // skewY tilts the diagonal; small skewX jitter so it isn't
      // a perfect 45deg line.
      { transform: _ssTransform({ sX: 1.00, sY: 0.72,
                                  rot: -rotMag * 1.10 * axis,
                                  skX: skXJitter,
                                  skY: skewMag * axis }),
        offset: 0.24 },

      // Mid-release: starting to expand, skew unwinding.
      { transform: _ssTransform({ sX: 1.05, sY: 0.92,
                                  rot: -rotMag * 0.50 * axis,
                                  skY: skewMag * 0.45 * axis }),
        offset: 0.36 },

      // BOOOOM: punch past 1, slight counter-skew, slight
      // counter-rotation so the boom "kicks" the other way.
      { transform: _ssTransform({ sX: boom * 1.02, sY: boom * 0.97,
                                  rot: rotMag * 0.70 * -axis,
                                  skY: skewMag * 0.20 * -axis }),
        offset: 0.46 },

      // Jiggle A: rotate flick one way.
      { transform: _ssTransform({ sX: boom * 0.97, sY: boom * 0.99,
                                  rot: jiggleA * -axis }),
        offset: 0.56 },

      // Jiggle B: rotate flick the other way, slightly smaller.
      { transform: _ssTransform({ sX: boom * 0.94, sY: boom * 0.96,
                                  rot: jiggleB * axis }),
        offset: 0.66 },

      // SQUEEZE 2 — soft mencekung in the opposite tilt.
      { transform: _ssTransform({ sX: 1.04, sY: sq2YDip,
                                  rot: rotMag * 0.55 * -axis,
                                  skX: skXJitter2,
                                  skY: skewMag * 0.45 * -axis }),
        offset: 0.78 },

      // Small overshoot up.
      { transform: _ssTransform({ sX: 1.025, sY: 1.015,
                                  rot: rotMag * 0.20 * axis }),
        offset: 0.88 },

      // Micro dip.
      { transform: _ssTransform({ sX: 0.996, sY: 0.996 }),
        offset: 0.95 },

      // Rest.
      { transform: _ssTransform({ sX: 1, sY: 1 }),
        opacity: 1, offset: 1 }
    ];
  }

  var BOUNCE_TIMING = {
    duration: 1780,
    easing: 'cubic-bezier(.22,1,.36,1)',
    fill: 'both'
  };

  function bounceOne(logo) {
    if (!logo || !isLayoutVisible(logo)) return;

    if (prefersReduced) {
      logo.style.opacity = '1';
      logo.style.transform = 'none';
      return;
    }

    // Cancel any prior bounce so a bfcache restore replays cleanly.
    if (logo.__ssBounceAnim && typeof logo.__ssBounceAnim.cancel === 'function') {
      try { logo.__ssBounceAnim.cancel(); } catch (e) { /* noop */ }
      logo.__ssBounceAnim = null;
    }

    if (typeof logo.animate === 'function') {
      try {
        logo.__ssBounceAnim = logo.animate(buildBounceKeyframes(), BOUNCE_TIMING);
        logo.__ssBounceAnim.onfinish = function () {
          logo.style.opacity = '1';
          logo.style.transform = 'translateZ(0) scale(1)';
        };
        return;
      } catch (e) {
        // Fall through to CSS path.
      }
    }

    // CSS keyframe fallback (iOS < 13.1 etc).
    logo.classList.remove('ss-bounce-in');
    // Force reflow so the animation can be re-triggered.
    void logo.offsetWidth;
    logo.classList.add('ss-bounce-in');
  }

  function bounceLogos(root) {
    var scope = scopeFor(root);
    var allowGateLogo = !!(root && root.nodeType === 1 && root.matches && root.matches('.ss-gate-card'));
    var logos = scope.querySelectorAll(HERO_LOGO_SELECTOR);
    for (var i = 0; i < logos.length; i++) {
      if (!allowGateLogo && logos[i].closest && logos[i].closest('.ss-gate-card')) continue;
      bounceOne(logos[i]);
    }
  }

  /* ----------------------------------------------------------------
   * Reveal helpers
   *
   * These exist purely as a compatibility shim for legacy pages
   * (/l, /inv, /admin, /db) that call window.StarShotsReveal.
   * They are intentionally simple: no transitionDelay rewrites, no
   * IntersectionObserver, no double-rAF chains. Pages that need a
   * staggered intro own that staging themselves.
   *
   * `start(root)`  → reveal everything in `root` that is in or near
   *                   the viewport. Already-visible elements are not
   *                   re-revealed. No timing tweaks; the page's own
   *                   CSS transition does the work.
   * `reset(root)`  → strip the .is-visible class so the next start()
   *                   replays without touching inline timing styles.
   * `show(el)`     → reveal a single element.
   * `mount(card)`  → add `.is-mounted` on the next animation frame.
   *                   Safe to call repeatedly.
   * `bounceLogos(root)` → re-trigger the hero logo bounce.
   * ---------------------------------------------------------------- */
  function collectReveals(root) {
    var scope = scopeFor(root);
    var els = [];
    if (scope.matches && scope.matches(REVEAL_SELECTOR)) els.push(scope);
    var found = scope.querySelectorAll(REVEAL_SELECTOR);
    for (var i = 0; i < found.length; i++) els.push(found[i]);
    return els;
  }

  function show(el) {
    if (el) el.classList.add('is-visible');
  }

  function startReveal(root) {
    var els = collectReveals(root);
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      // Only reveal items that are in or near the viewport.
      // Off-screen items get revealed by their page's own staging,
      // or by us on scroll via IntersectionObserver below.
      if (isNearViewport(el)) show(el);
    }

    // Anything still hidden gets watched by an observer. We do NOT
    // mutate transitionDelay — the page already chose those values.
    var hidden = [];
    for (var j = 0; j < els.length; j++) {
      if (!els[j].classList.contains('is-visible')) hidden.push(els[j]);
    }
    if (!hidden.length) return;
    if (typeof IntersectionObserver !== 'function') {
      // Old browser: just reveal everything after a beat.
      setTimeout(function () { hidden.forEach(show); }, 80);
      return;
    }
    try {
      var observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting || entry.intersectionRatio > 0) {
            show(entry.target);
            observer.unobserve(entry.target);
          }
        });
      }, { root: null, rootMargin: '0px 0px -8% 0px', threshold: 0.01 });
      hidden.forEach(function (el) { observer.observe(el); });
    } catch (e) {
      hidden.forEach(show);
    }
  }

  function resetReveal(root) {
    var els = collectReveals(root);
    for (var i = 0; i < els.length; i++) {
      els[i].classList.remove('is-visible');
    }
  }

  function start(root) {
    // One rAF lets the browser commit the current frame before we
    // toggle classes, which is what makes the transition actually
    // animate from the initial state on iOS WebKit.
    requestAnimationFrame(function () { startReveal(root || document); });
  }

  function mount(card) {
    if (!card || card.classList.contains('is-mounted')) return;
    if (typeof requestAnimationFrame !== 'function') {
      card.classList.add('is-mounted');
      return;
    }
    requestAnimationFrame(function () {
      // Read offsetWidth to force iOS to commit the pre-mount
      // state before we add the mounted class.
      void card.offsetWidth;
      requestAnimationFrame(function () {
        card.classList.add('is-mounted');
      });
    });
  }

  /* ----------------------------------------------------------------
   * data-ss-intro: declarative intro for new code
   *
   * Add `data-ss-intro` and optionally `data-ss-delay="120"` to
   * any element. We promote them in document order with a small
   * stagger if no explicit delay is set. This is the path forward;
   * legacy pages keep using their own staging.
   * ---------------------------------------------------------------- */
  function runDeclarativeIntro(root) {
    var els = scopeFor(root).querySelectorAll(INTRO_SELECTOR);
    if (!els.length) return;
    if (prefersReduced) {
      for (var i = 0; i < els.length; i++) els[i].classList.add('is-in');
      return;
    }
    requestAnimationFrame(function () {
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        var explicit = el.getAttribute('data-ss-delay');
        var delay = explicit !== null ? Number(explicit) || 0 : Math.min(i * 90, 540);
        (function (target, ms) {
          setTimeout(function () { target.classList.add('is-in'); }, ms);
        }(el, delay));
      }
    });
  }

  /* ----------------------------------------------------------------
   * Safety net
   * ---------------------------------------------------------------- */
  function forceMountIfStuck() {
    var forced = false;
    var cards = document.querySelectorAll(CARD_SELECTOR);
    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      if (!isLayoutVisible(card)) continue;
      if (card.classList.contains('is-mounted') || card.classList.contains('is-visible')) continue;
      // Force the card visible, but use a class so it can be undone.
      card.classList.add('is-mounted', 'is-visible');
      forced = true;
    }
    // Make sure all top-level reveals are shown too.
    var hidden = document.querySelectorAll(REVEAL_SELECTOR);
    for (var j = 0; j < hidden.length; j++) {
      if (hidden[j].classList.contains('is-visible')) continue;
      if (!isLayoutVisible(hidden[j]) || !isNearViewport(hidden[j])) continue;
      show(hidden[j]);
      forced = true;
    }
    // And the bounce, but only if the safety net actually had to step in.
    if (forced) bounceLogos(document);
  }

  /* ----------------------------------------------------------------
   * Public API
   * ---------------------------------------------------------------- */
  window.StarShotsReveal = {
    start: start,
    reset: resetReveal,
    show: show,
    mount: mount,
    bounceLogos: bounceLogos,
    intro: runDeclarativeIntro
  };

  /* ----------------------------------------------------------------
   * Bootstrap
   * ---------------------------------------------------------------- */
  // Tag <html> so the static CSS can opt into JS-only initial states.
  docEl.classList.add('ss-js');

  function bootstrap() {
    bounceLogos(document);
    runDeclarativeIntro(document);
    setTimeout(forceMountIfStuck, SAFETY_TIMEOUT_MS);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
  } else {
    bootstrap();
  }

  // Safari bfcache restore: replay the bounce + reveal pass.
  // We only act when event.persisted is true; otherwise the page just
  // loaded normally and bootstrap() already ran.
  window.addEventListener('pageshow', function (event) {
    if (!event.persisted) return;
    bounceLogos(document);
    runDeclarativeIntro(document);
  });
})();
