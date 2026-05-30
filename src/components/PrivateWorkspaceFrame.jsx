import { GlobalBackground } from './GlobalBackground.jsx';
import './PrivateWorkspaceFrame.css';

/**
 * Cross-tool navigation rendered inside the left panel, low-emphasis.
 * "Dashboard" intentionally omitted now that /db is the workspace home.
 *
 * The three tool tabs (Links, Invoice, Subs) open in a new tab so the
 * /db dashboard stays the operator's "home" tab — switching to a tool
 * doesn't lose the current /db selection / scroll position.
 */
const NAV_ITEMS = [
  { href: '/db/', label: 'Database' },
  { href: '/l/', label: 'Links', target: '_blank' },
  { href: '/inv/', label: 'Invoice', target: '_blank' },
  { href: '/subs/', label: 'Subs', target: '_blank' },
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
 *   showNav           - render the cross-tool nav row (default true);
 *                       pass false for public/embed pages like the
 *                       gallery delivery view, or for pages whose
 *                       only context is themselves (e.g. /subs).
 *   navItems          - override the cross-tool nav array. Defaults
 *                       to the full NAV_ITEMS list. Pass a single
 *                       item (e.g. just Database) for pages like /l
 *                       that only need a back-link.
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
  showNav = true,
  navItems = NAV_ITEMS,
}) {
  const showDetail = mobileView === 'right' && right !== null;
  const navList = Array.isArray(navItems) ? navItems : [];
  const renderNav = showNav && navList.length > 0;
  const isSinglePanel = right === null;

  return (
    <main
      className="pf-page scroll-root"
      data-show-detail={showDetail ? 'true' : undefined}
      data-single-panel={isSinglePanel ? 'true' : undefined}
    >
      <GlobalBackground />
      <section className="pf-shell">
        <aside className="pf-panel pf-panel--left">
          <div className="pf-panel-scroll scroll-surface-y">
            <header className="pf-header">
              <a className="pf-logo" href={logoHref} aria-label="StarShots Workspace">
                {/* Picture/source swap to a real white asset in dark
                 * mode keeps the brand visible on the deep-blue panel
                 * without relying on CSS filter:invert. */}
                <picture>
                  <source media="(prefers-color-scheme: dark)" srcSet="/logo-hero-white.png" />
                  <img src="/logo-hero.png" alt="StarShots" />
                </picture>
              </a>
              {pills ? <div className="pf-pills">{pills}</div> : <div className="pf-pills" aria-hidden="true" />}
            </header>
            {renderNav ? (
              <nav
                className="pf-nav"
                aria-label="Workspace tools"
                // Override the default 4-column grid so a single back-link
                // (e.g. /l => only "Database") spans the full row instead
                // of sitting in a 1/4-width cell.
                style={{ gridTemplateColumns: `repeat(${navList.length}, minmax(0, 1fr))` }}
              >
                {navList.map((item) => (
                  <a
                    key={item.href}
                    href={item.href}
                    target={item.target || undefined}
                    rel={item.target === '_blank' ? 'noopener noreferrer' : undefined}
                    className={active === item.href ? 'active' : ''}
                    aria-current={active === item.href ? 'page' : undefined}
                  >
                    {item.label}
                  </a>
                ))}
              </nav>
            ) : null}
            {left}
          </div>
        </aside>
        {right !== null ? (
          <section className="pf-panel pf-panel--right">
            <div className="pf-panel-scroll scroll-surface-y">{right}</div>
          </section>
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
