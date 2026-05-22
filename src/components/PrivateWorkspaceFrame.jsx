import { GlobalBackground } from './GlobalBackground.jsx';
import './PrivateWorkspaceFrame.css';

/**
 * Cross-tool navigation rendered inside the left panel, low-emphasis.
 * "Dashboard" intentionally omitted now that /db is the workspace home.
 */
const NAV_ITEMS = [
  { href: '/db/', label: 'Database' },
  { href: '/l/', label: 'Links' },
  { href: '/inv/', label: 'Invoice' },
  { href: '/subs/', label: 'Subs' },
];

/**
 * PrivateWorkspaceFrame
 *
 * Shared after-password shell. Mirrors the /inv canvas:
 *   - flat blue/dark page background (from invcs.css ss-bg),
 *   - centered two-panel grid up to 1440px wide,
 *   - each panel scrolls as a single unit (header scrolls with content),
 *   - logo top-left of the left panel, contextual pills right-aligned on
 *     the same row,
 *   - low-emphasis cross-tool nav directly below the header,
 *   - on mobile, one panel at a time with a fixed bottom tab bar.
 *
 * Props:
 *   active            - active nav href, e.g. "/db/"
 *   pills             - optional ReactNode rendered right of the logo;
 *                       pass null on pages that have no contextual mode
 *                       (the row stays clean — no fake pills are forced).
 *   left              - left-panel content (page-specific).
 *   right             - right-panel content; omit for single-panel pages.
 *   mobileView        - on mobile, which panel is visible: 'left' | 'right'.
 *   onMobileViewChange - called when the user taps a mobile tab.
 *   mobileTabs        - { left, right } labels for the bottom tabs.
 *                       Omit to hide the bar (selection-driven swap only).
 *   logoHref          - logo destination; defaults to "/db/".
 */
export function PrivateWorkspaceFrame({
  active,
  pills = null,
  left,
  right = null,
  mobileView = 'left',
  onMobileViewChange,
  mobileTabs,
  logoHref = '/db/',
}) {
  const showDetail = mobileView === 'right' && right !== null;

  return (
    <main className="pf-page" data-show-detail={showDetail ? 'true' : undefined}>
      <GlobalBackground />
      <section className="pf-shell">
        <aside className="pf-panel pf-panel--left">
          <header className="pf-header">
            <a className="pf-logo" href={logoHref} aria-label="StarShots Workspace">
              <img src="/logo-hero.png" alt="StarShots" />
            </a>
            {pills ? <div className="pf-pills">{pills}</div> : <div className="pf-pills" aria-hidden="true" />}
          </header>
          <nav className="pf-nav" aria-label="Workspace tools">
            {NAV_ITEMS.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className={active === item.href ? 'active' : ''}
                aria-current={active === item.href ? 'page' : undefined}
              >
                {item.label}
              </a>
            ))}
          </nav>
          {left}
        </aside>
        {right !== null ? (
          <section className="pf-panel pf-panel--right">{right}</section>
        ) : null}
      </section>
      {right !== null && mobileTabs ? (
        <nav className="pf-mobile-tabs" aria-label="Panel switcher">
          <button
            type="button"
            className={mobileView === 'left' ? 'active' : ''}
            onClick={() => onMobileViewChange?.('left')}
          >
            {mobileTabs.left}
          </button>
          <button
            type="button"
            className={mobileView === 'right' ? 'active' : ''}
            onClick={() => onMobileViewChange?.('right')}
          >
            {mobileTabs.right}
          </button>
        </nav>
      ) : null}
    </main>
  );
}
