import './GlobalBackground.css';

/**
 * Shared monochrome page canvas.
 *
 * The former aurora/rainbow background is preserved in
 * GlobalBackgroundBackup.jsx + GlobalBackgroundBackup.css.
 * Keep this layer intentionally quiet: it supports editorial,
 * photography-first pages without competing with photos or UI.
 */
export function GlobalBackground() {
  return <div className="ss-bg" aria-hidden="true" />;
}
