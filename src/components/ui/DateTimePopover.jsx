import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import {
  MONTH_NAMES,
  DOW_LABELS,
  todayIso,
  buildMonthGrid,
} from './dateTimeFieldUtils.js';

/**
 * CalendarPopover
 *
 * The custom month-grid popover rendered by DateTimeField when the
 * calendar icon is opened. Extracted verbatim from DateTimeField.jsx
 * — same month grid, prev/next nav, Today/Clear actions, portal
 * positioning, and classNames. No visual or behavioural redesign.
 *
 *   - `anchorRef` : ref to the field wrapper used for positioning.
 *   - `anchorIso` : currently selected ISO date ('' when empty),
 *                   drives the initial view month and selected cell.
 *   - `onPick(iso)` : fires with the chosen ISO date, today, or ''
 *                     (Clear).
 */
export function CalendarPopover({ anchorRef, anchorIso, onPick }) {
  const today = todayIso();
  const initial = /^\d{4}-\d{2}-\d{2}$/.test(anchorIso) ? anchorIso : today;
  const [yy, mm] = initial.split('-').map(Number);
  const [viewYear, setViewYear] = useState(yy);
  const [viewMonth, setViewMonth] = useState(mm); // 1-12
  const popoverRef = useRef(null);

  const cells = useMemo(
    () => buildMonthGrid(viewYear, viewMonth),
    [viewYear, viewMonth],
  );

  function shiftMonth(delta) {
    let nm = viewMonth + delta;
    let ny = viewYear;
    while (nm < 1) { nm += 12; ny -= 1; }
    while (nm > 12) { nm -= 12; ny += 1; }
    setViewMonth(nm);
    setViewYear(ny);
  }

  useEffect(() => {
    if (!anchorRef?.current || !popoverRef.current) return;
    function updatePosition() {
      const anchor = anchorRef.current.getBoundingClientRect();
      const popover = popoverRef.current.getBoundingClientRect();
      let top = anchor.bottom + 8;
      let left = anchor.left;

      // Vertical flip if clipped by bottom of viewport
      if (top + popover.height > window.innerHeight && anchor.top - popover.height - 8 > 0) {
        top = anchor.top - popover.height - 8;
      }
      // Horizontal shift if clipped by right of viewport
      if (left + popover.width > window.innerWidth) {
        left = Math.max(8, window.innerWidth - popover.width - 8);
      }

      popoverRef.current.style.top = `${top}px`;
      popoverRef.current.style.left = `${left}px`;
    }

    updatePosition();
    // Update on scroll or resize to keep it anchored
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [anchorRef]);

  const content = (
    <div ref={popoverRef} className="dtf-popover" role="dialog" aria-label="Pick date" style={{ position: 'fixed', zIndex: 99999, top: '-999px', left: '-999px' }}>
      <header className="dtf-popover-head">
        <button
          type="button"
          className="dtf-popover-nav"
          onClick={() => shiftMonth(-1)}
          aria-label="Previous month"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" width="16" height="16">
            <path d="M15 6l-6 6 6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <span className="dtf-popover-title">
          {MONTH_NAMES[viewMonth - 1]} {viewYear}
        </span>
        <button
          type="button"
          className="dtf-popover-nav"
          onClick={() => shiftMonth(1)}
          aria-label="Next month"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" width="16" height="16">
            <path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </header>
      <div className="dtf-popover-dow" aria-hidden="true">
        {DOW_LABELS.map((d, i) => <span key={i}>{d}</span>)}
      </div>
      <div className="dtf-popover-grid">
        {cells.map((cell) => {
          const selected = cell.iso === anchorIso;
          const isToday = cell.iso === today;
          const cls = [
            'dtf-popover-cell',
            cell.muted ? 'dtf-muted' : '',
            selected ? 'dtf-selected' : '',
            isToday ? 'dtf-today' : '',
          ].filter(Boolean).join(' ');
          return (
            <button
              key={cell.iso}
              type="button"
              className={cls}
              onClick={() => onPick(cell.iso)}
              aria-label={cell.iso}
              aria-pressed={selected}
            >
              {cell.day}
            </button>
          );
        })}
      </div>
      <footer className="dtf-popover-foot">
        <button type="button" className="dtf-popover-foot-btn" onClick={() => onPick(today)}>Today</button>
        <button type="button" className="dtf-popover-foot-btn dtf-popover-foot-btn--ghost" onClick={() => onPick('')}>Clear</button>
      </footer>
    </div>
  );

  return createPortal(content, document.body);
}
