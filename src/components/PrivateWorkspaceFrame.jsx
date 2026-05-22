import { GlobalBackground } from './GlobalBackground.jsx';
import './PrivateWorkspaceFrame.css';

/**
 * Cross-tool navigation rendered inside the left panel.
 * Kept low-emphasis on purpose; pages own their primary controls (the pills).
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
 * Props:
 *   active           - active nav href (e.g. "/db/")
 *   pills            - optional ReactNode rendered right-aligned next to the logo
 *   left             - left-panel content (page-specific)
 *   right            - right-panel content (page-specific); omit for single-panel pages
 *   showDetail       - on mobile, when true, hides left and shows right
 *   showNav          - default true; pages may hide the cross-tool nav if needed
 *   className        - extra class for page-specific styling hooks
 *   logoHref         - logo destination; defaults to "/db/" (workspace home)
 */
export function PrivateWorkspaceFrame({
  active,
  pills = null,
  left,
  right = null,
  showDetail = false,
  showNav = true,
  className = '',
  logoHref = '/db/',
}) {
  const pageClass = `pf-page ${className}`.trim();

  return (
    <main className={pageClass} data-show-detail={showDetail ? 'true' : undefined}>
      <GlobalBackground />
      <div className="pf-shell">
        <aside className="pf-panel pf-panel--left">
          <header className="pf-header">
            <a className="pf-logo" href={logoHref} aria-label="StarShots Workspace">
              <img src="/logo-hero.png" alt="StarShots" />
            </a>
            {pills ? <div className="pf-pills">{pills}</div> : <div className="pf-pills-spacer" />}
          </header>
          {showNav ? (
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
          ) : null}
          <div className="pf-panel__body">{left}</div>
        </aside>
        {right !== null ? (
          <section className="pf-panel pf-panel--right">
            <div className="pf-panel__body">{right}</div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
