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

  // Firefox detection.
  // Why a JS-applied class instead of an `@-moz-document url-prefix()` CSS
  // hack: stable Firefox restricted that at-rule to UA / browser-internal
  // stylesheets in the 2019 cycle (Firefox bug 1035091), so it no longer
  // matches in author CSS. Sniffing `InstallTrigger` (Firefox-only API)
  // and tagging <html class="ss-firefox"> gives the same scoping with
  // none of the cross-engine surprises, and lets every stylesheet on the
  // site reuse it without its own detection.
  var isFirefox = false;
  try {
    isFirefox = typeof window.InstallTrigger !== 'undefined' ||
                /\bFirefox\//.test(navigator.userAgent || '');
  } catch (e) { /* noop */ }
  if (isFirefox) docEl.classList.add('ss-firefox');

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
    // matrix decomposition. translateY comes first so the vertical
    // travel arc is independent of the squeeze/rotate/skew stack.
    var tY = parts.tY || 0;
    var rot = parts.rot || 0;
    var skX = parts.skX || 0;
    var skY = parts.skY || 0;
    var sX  = parts.sX != null ? parts.sX : 1;
    var sY  = parts.sY != null ? parts.sY : 1;
    return 'translateY(' + tY.toFixed(2) + 'px) translateZ(0)' +
           ' rotate(' + rot.toFixed(3) + 'deg)' +
           ' skewX(' + skX.toFixed(3) + 'deg)' +
           ' skewY(' + skY.toFixed(3) + 'deg)' +
           ' scale(' + sX.toFixed(4) + ',' + sY.toFixed(4) + ')';
  }

  // Loop period = active choreography + rest tail, all baked into a
  // single keyframe set so WAAPI can drive it with iterations: Infinity.
  // The previous version stacked a fresh logo.animate() call every
  // iteration via setTimeout. Each finished animation kept its end
  // pose alive (fill: 'both'), so after a minute the compositor was
  // juggling ~24 zombie animations on the same transform — at which
  // point Safari and Firefox both throttled paint to ~1 fps. Putting
  // the gap inside the keyframes means exactly one Animation object
  // ever exists per logo, and the browser does the looping natively.
  //
  // Period = 4200 ms. Matches --ss-gate-idle-duration in gate.css and
  // the .is-sheen one-shot in worker shellStyles, so the button sheen
  // and the logo windup line up on every loop edge.
  //
  // The choreography occupies the first ~78 % of the loop so the
  // boom is "early enough" the sheen catches its peak. The tail
  // (~22 %) holds at scale 1 so the loop reads as a deliberate pulse
  // and not a perpetual wobble.
  //
  // Y axis stays at 0 throughout. Earlier builds had the logo travel
  // up from below on every iteration, which read as the logo
  // "sinking and rising" rather than the intended draw-back-and-pop
  // arrow motion.
  // Slowed from 2200/600 to 3300/900 (50 % longer period). Same
  // shape, more time per phase, so each frame moves a smaller
  // delta and the engine can hit the full refresh rate even when
  // the droplet emitter is also running.
  var BOUNCE_ACTIVE_MS = 3300;
  var BOUNCE_GAP_MS = 900;
  var BOUNCE_PERIOD_MS = BOUNCE_ACTIVE_MS + BOUNCE_GAP_MS; // 4200
  // Where the active choreography ends inside the loop. The keyframes
  // below place every choreographic phase between offset 0 and this
  // value; from BOUNCE_ACTIVE_END to 1 the logo is held at scale(1).
  var BOUNCE_ACTIVE_END = BOUNCE_ACTIVE_MS / BOUNCE_PERIOD_MS;

  function buildBounceKeyframes() {
    // axis: which way the first squeeze tilts. The boom + second
    // squeeze counter-tilt the opposite direction.
    var axis = _ssSign();
    var skewMag    = _ssRand(5.2, 7.8);   // deg, primary squeeze tilt
    var rotMag     = _ssRand(1.6, 2.8);   // deg, base rotation magnitude
    var boom       = _ssRand(1.16, 1.22); // peak scale on the BOOM
    var jiggleA    = _ssRand(2.6, 3.8);   // deg, first jiggle flick
    var jiggleB    = _ssRand(1.8, 2.8);   // deg, opposite jiggle
    var sq2YDip    = _ssRand(0.90, 0.94); // scaleY of the soft second squeeze

    // Tiny extra wobble in the squeeze so the two halves don't read
    // as a perfect diagonal — the user asked for "random, not exact
    // diagonal".
    var skXJitter  = _ssRand(-1.6, 1.6);
    var skXJitter2 = _ssRand(-1.2, 1.2);

    // Compress the "active" offsets into [0, BOUNCE_ACTIVE_END]; the
    // remainder of the loop is a rest hold so the next iteration
    // feels like a real pause rather than a perpetual pulse.
    function at(active) { return active * BOUNCE_ACTIVE_END; }

    return [
      // Loop edge. Logo at rest. We start AND end here so the loop
      // wraps cleanly and the sheen, which also starts at this
      // moment, is in lockstep.
      { transform: _ssTransform({ tY: 0, sX: 1, sY: 1 }),
        offset: 0 },

      // Slow draw-back — like pulling a bow string. Vertical squash
      // grows gradually; the user explicitly asked for this windup
      // to feel deliberate.
      { transform: _ssTransform({ tY: 0, sX: 1.02, sY: 0.92,
                                  rot: -rotMag * 0.40 * axis,
                                  skX: skXJitter * 0.4,
                                  skY: skewMag * 0.45 * axis }),
        offset: at(0.18) },

      // Deeper draw-back, approaching peak windup.
      { transform: _ssTransform({ tY: 0, sX: 1.04, sY: 0.82,
                                  rot: -rotMag * 0.80 * axis,
                                  skX: skXJitter * 0.7,
                                  skY: skewMag * 0.78 * axis }),
        offset: at(0.32) },

      // SQUEEZE 1 / mencekung peak — peak windup, "arrow drawn".
      // Held briefly so the boom hits with maximum contrast.
      { transform: _ssTransform({ tY: 0, sX: 1.05, sY: 0.70,
                                  rot: -rotMag * 1.10 * axis,
                                  skX: skXJitter,
                                  skY: skewMag * axis }),
        offset: at(0.46) },

      // Mid-release — the snap is starting.
      { transform: _ssTransform({ tY: 0, sX: 1.06, sY: 0.92,
                                  rot: -rotMag * 0.40 * axis,
                                  skY: skewMag * 0.40 * axis }),
        offset: at(0.56) },

      // BOOOOM — peak scale punch. Y stays at 0 (no upward travel);
      // the perceived "lift" comes from the overshoot scale alone.
      { transform: _ssTransform({ tY: 0, sX: boom * 1.02, sY: boom * 0.98,
                                  rot: rotMag * 0.70 * -axis,
                                  skY: skewMag * 0.18 * -axis }),
        offset: at(0.62) },

      // Jiggle A.
      { transform: _ssTransform({ tY: 0, sX: boom * 0.97, sY: boom * 0.99,
                                  rot: jiggleA * -axis }),
        offset: at(0.70) },

      // Jiggle B.
      { transform: _ssTransform({ tY: 0, sX: boom * 0.94, sY: boom * 0.96,
                                  rot: jiggleB * axis }),
        offset: at(0.77) },

      // SQUEEZE 2 — soft counter-tilt.
      { transform: _ssTransform({ tY: 0, sX: 1.04, sY: sq2YDip,
                                  rot: rotMag * 0.55 * -axis,
                                  skX: skXJitter2,
                                  skY: skewMag * 0.45 * -axis }),
        offset: at(0.86) },

      // Tiny overshoot.
      { transform: _ssTransform({ tY: 0, sX: 1.02, sY: 1.012,
                                  rot: rotMag * 0.18 * axis }),
        offset: at(0.92) },

      // Micro dip.
      { transform: _ssTransform({ tY: 0, sX: 0.996, sY: 0.996 }),
        offset: at(0.97) },

      // End of choreography — rest pose.
      { transform: _ssTransform({ tY: 0, sX: 1, sY: 1 }),
        offset: BOUNCE_ACTIVE_END },

      // Hold rest until end of loop period (the 600 ms gap).
      { transform: _ssTransform({ tY: 0, sX: 1, sY: 1 }),
        offset: 1 }
    ];
  }

  var BOUNCE_TIMING = {
    duration: BOUNCE_PERIOD_MS,
    easing: 'cubic-bezier(.22,1,.36,1)',
    iterations: Infinity,
    fill: 'forwards'
  };

  function stopBounceLoop(logo) {
    if (!logo) return;
    if (logo.__ssBounceAnim && typeof logo.__ssBounceAnim.cancel === 'function') {
      try { logo.__ssBounceAnim.cancel(); } catch (e) { /* noop */ }
    }
    logo.__ssBounceAnim = null;
    logo.__ssBounceLooping = false;
  }

  function bounceOne(logo, opts) {
    if (!logo || !isLayoutVisible(logo)) return;
    opts = opts || {};

    if (prefersReduced) {
      logo.style.opacity = '1';
      logo.style.transform = 'none';
      return;
    }

    // If a loop is already running and the caller did NOT ask for a
    // restart, leave it alone. Pages and the mount scheduler may
    // call bounceLogos() multiple times during intro; we never want
    // to re-randomize mid-flight unless explicitly asked (via
    // gate.js startIdle, which restarts the bounce on the same
    // animation frame it adds .is-idle so the bounce keyframe edge
    // and the sheen keyframe edge are aligned to within ~16 ms).
    if (logo.__ssBounceLooping && logo.__ssBounceAnim && !opts.restart) return;

    if (opts.restart) stopBounceLoop(logo);

    // Make sure the logo is visible before we start the loop. The
    // intro CSS may have it at opacity:0; the bounce keyframes never
    // touch opacity any more (they used to fade in on every loop,
    // which would have re-faded every 2.48 s).
    logo.style.opacity = '1';

    if (typeof logo.animate === 'function') {
      try {
        var anim = logo.animate(buildBounceKeyframes(), BOUNCE_TIMING);
        logo.__ssBounceAnim = anim;
        logo.__ssBounceLooping = true;
        return;      } catch (e) {
        // Fall through to CSS path.
      }
    }

    // CSS keyframe fallback (iOS < 13.1 etc). The .ss-bounce-in class
    // in animate.css runs `ssBounceIn ... infinite` so the loop runs
    // for free on the compositor without us scheduling anything.
    logo.classList.remove('ss-bounce-in');
    void logo.offsetWidth;
    logo.classList.add('ss-bounce-in');
    logo.__ssBounceLooping = true;
  }

  function bounceLogos(root, opts) {
    var scope = scopeFor(root);
    var logos = scope.querySelectorAll(HERO_LOGO_SELECTOR);
    // Bounce every hero logo in the given scope. The previous version of
    // this function skipped any logo nested inside .ss-gate-card unless
    // the caller passed the gate card itself as `root`. That guard was
    // meant to defer to per-page intro scripts, but the page intros on
    // /admin, /db, /g/<slug>, /inv, /l either don't call bounceLogos()
    // at all (gate.js) or call it with a wrapper element that doesn't
    // match .ss-gate-card (#adminGate is a .gate-shell). Net result: the
    // gate-card logo never bounced. The bounceOne() coalescer above
    // makes it safe to bounce unconditionally — repeat calls within
    // 600 ms are dropped, so a page that DOES call bounceLogos(gate)
    // after our bootstrap won't cause a visible re-trigger.
    for (var i = 0; i < logos.length; i++) {
      bounceOne(logos[i], opts);
    }
  }

  /* ----------------------------------------------------------------
   * Mount-time bounce scheduler.
   *
   * Why this exists: the bootstrap pass runs at DOMContentLoaded.
   * On every gate page (/admin, /db, /g/<slug>, /inv, /l) the gate
   * card is still hidden (opacity:0, off-screen translate, or the
   * shell wrapping it has display:none) at that moment. The 1.78 s
   * choreography would run anyway, behind the scenes, and finish
   * before the per-page intro fades the card in — so the user only
   * ever saw the logo at rest. This was the "the jiggle is DONE
   * after the webpage fully loaded" symptom.
   *
   * The fix is to wait until the card is actually mounted, then
   * trigger the bounce. We watch every gate-ish card for class
   * mutations (is-mounted / is-visible) and re-fire bounceLogos
   * scoped to that card the first time it becomes visible. The
   * bootstrap pass still bounces logos that are *already* visible
   * at load time (e.g. /), so the homepage path is unchanged.
   * ---------------------------------------------------------------- */
  var GATE_CARD_SELECTOR = '.ss-gate-card,' + CARD_SELECTOR;
  var MOUNT_CLASS_RE = /(^|\s)(is-mounted|is-visible)(\s|$)/;

  function scheduleMountBounce(card) {
    if (!card || card.__ssBounceWatch) return;
    card.__ssBounceWatch = true;

    // If the card is already visible at scheduler time, bounce now.
    if (isLayoutVisible(card) && (card.classList.contains('is-mounted') ||
                                   card.classList.contains('is-visible'))) {
      bounceLogos(card);
      return;
    }

    if (typeof MutationObserver !== 'function') {
      // Old browser: poll a few times so the bounce eventually fires.
      var tries = 0;
      var poll = setInterval(function () {
        tries++;
        if (isLayoutVisible(card) && (card.classList.contains('is-mounted') ||
                                       card.classList.contains('is-visible'))) {
          clearInterval(poll);
          bounceLogos(card);
        } else if (tries >= 30) {
          clearInterval(poll);
          bounceLogos(card);
        }
      }, 120);
      return;
    }

    var fired = false;
    var observer = new MutationObserver(function () {
      if (fired) return;
      if (!isLayoutVisible(card)) return;
      if (!MOUNT_CLASS_RE.test(card.className)) return;
      fired = true;
      observer.disconnect();
      // One rAF so the browser paints the mount frame first; the
      // bounce starts on the very next frame, in lockstep with the
      // card's own opacity/translate transition.
      requestAnimationFrame(function () { bounceLogos(card); });
    });
    observer.observe(card, { attributes: true, attributeFilter: ['class', 'style', 'hidden'] });

    // Hard safety so we never lose the bounce entirely if the page
    // never adds is-mounted (e.g. JS error mid-intro).
    setTimeout(function () {
      if (fired) return;
      fired = true;
      try { observer.disconnect(); } catch (e) { /* noop */ }
      bounceLogos(card);
    }, SAFETY_TIMEOUT_MS);
  }

  function watchGateMounts(root) {
    var scope = scopeFor(root);
    var cards = scope.querySelectorAll(GATE_CARD_SELECTOR);
    for (var i = 0; i < cards.length; i++) scheduleMountBounce(cards[i]);
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
    // Schedule a deferred bounce for any gate card that is still
    // hidden at load time. See scheduleMountBounce() for context.
    watchGateMounts(document);
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
    // Clear the per-card watch flag so a card that re-mounts after
    // bfcache restore can be picked up again by the mount scheduler.
    var cards = document.querySelectorAll(GATE_CARD_SELECTOR);
    for (var i = 0; i < cards.length; i++) cards[i].__ssBounceWatch = false;
    // Tear down any in-flight loops from the pre-bfcache page so the
    // fresh mount can start clean — bounceOne will rearm.
    var logos = document.querySelectorAll(HERO_LOGO_SELECTOR);
    for (var k = 0; k < logos.length; k++) stopBounceLoop(logos[k]);
    bounceLogos(document);
    watchGateMounts(document);
    runDeclarativeIntro(document);
  });
})();
