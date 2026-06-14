import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import {
  MONTH_NAMES,
  DOW_LABELS,
  HOUR_OPTIONS,
  MINUTE_PRESETS,
  todayIso,
  buildMonthGrid,
} from './dateTimeFieldUtils.js';

/**
 * CalendarPopover
 *
 * The custom popover rendered by DateTimeField when the calendar
 * icon (or the field itself) is opened.
 *
 * Date-only mode renders just the month grid plus Today/Clear — the
 * original picker, unchanged. When `withTime` is true the popover
 * grows into a two-pane layout: the calendar on the left and a
 * compact hour/minute selector on the right (stacked vertically on
 * narrow viewports). A Done button is added so the operator can pick
 * a date AND a time without the popover closing on the first pick.
 *
 * Props:
 *   - `anchorRef`   : ref to the field wrapper, used for positioning.
 *   - `anchorIso`   : selected ISO date ('' when empty); drives the
 *                     initial view month and the selected cell.
 *   - `onPick(iso)` : fires with the chosen ISO date, today, or ''.
 *   - `withTime`    : when true, show the time selector + Done.
 *   - `anchorTime`  : the field's live 'HH:mm' (or partial) string;
 *                     drives the highlighted hour/minute chips.
 *   - `onTimePick(hhmm)` : fires with the chosen 'HH:mm' or '' (Clear).
 *   - `onClose()`   : closes the popover (Done).
 */
export function CalendarPopover({
  anchorRef,
  anchorIso,
  onPick,
  withTime = false,
  anchorTime = '',
  onTimePick,
  onClose,
}) {
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

  // Derive the currently-selected hour/minute from the field's live
  // time string so the chips stay in sync with manual segment typing.
  const [rawHour, rawMinute] = String(anchorTime || '').split(':');
  const selHour = /^\d{1,2}$/.test(rawHour || '') ? String(rawHour).padStart(2, '0') : '';
  const selMinute = /^\d{1,2}$/.test(rawMinute || '') ? String(rawMinute).padStart(2, '0') : '';

  function shiftMonth(delta) {
    let nm = viewMonth + delta;
    let ny = viewYear;
    while (nm < 1) { nm += 12; ny -= 1; }
    while (nm > 12) { nm -= 12; ny += 1; }
    setViewMonth(nm);
    setViewYear(ny);
  }

  // Picking an hour/minute emits a complete 'HH:mm'. The other half
  // defaults to '00' when still empty so a single tap yields a valid
  // time immediately (matching the "update immediately" UX).
  function pickHour(h) {
    onTimePick?.(`${h}:${selMinute || '00'}`);
  }
  function pickMinute(m) {
    onTimePick?.(`${selHour || '00'}:${m}`);
  }

  // Clear wipes the date and, in time mode, the time too.
  function handleClear() {
    onPick('');
    if (withTime) onTimePick?.('');
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

  const calendar = (
    <div className="dtf-popover-cal">
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
    </div>
  );

  const timePanel = withTime ? (
    <div className="dtf-popover-time">
      <div className="dtf-time-col">
        <div className="dtf-time-label" id="dtf-hour-label">Hour</div>
        <div className="dtf-time-grid dtf-time-grid--hour" role="group" aria-labelledby="dtf-hour-label">
          {HOUR_OPTIONS.map((h) => {
            const selected = h === selHour;
            return (
              <button
                key={h}
                type="button"
                className={`dtf-time-cell${selected ? ' dtf-selected' : ''}`}
                onClick={() => pickHour(h)}
                aria-pressed={selected}
              >
                {h}
              </button>
            );
          })}
        </div>
      </div>
      <div className="dtf-time-col">
        <div className="dtf-time-label" id="dtf-minute-label">Minute</div>
        <div className="dtf-time-grid dtf-time-grid--minute" role="group" aria-labelledby="dtf-minute-label">
          {MINUTE_PRESETS.map((m) => {
            const selected = m === selMinute;
            return (
              <button
                key={m}
                type="button"
                className={`dtf-time-cell${selected ? ' dtf-selected' : ''}`}
                onClick={() => pickMinute(m)}
                aria-pressed={selected}
              >
                {m}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  ) : null;

  const content = (
    <div
      ref={popoverRef}
      className={`dtf-popover${withTime ? ' dtf-popover--with-time' : ''}`}
      role="dialog"
      aria-label={withTime ? 'Pick date and time' : 'Pick date'}
      style={{ position: 'fixed', zIndex: 99999, top: '-999px', left: '-999px' }}
    >
      <div className="dtf-popover-body">
        {calendar}
        {timePanel}
      </div>
      <footer className="dtf-popover-foot">
        <button type="button" className="dtf-popover-foot-btn" onClick={() => onPick(today)}>Today</button>
        <button type="button" className="dtf-popover-foot-btn dtf-popover-foot-btn--ghost" onClick={handleClear}>Clear</button>
        {withTime ? (
          <button type="button" className="dtf-popover-foot-btn dtf-popover-foot-btn--done" onClick={() => onClose?.()}>Done</button>
        ) : null}
      </footer>
    </div>
  );

  return createPortal(content, document.body);
}
