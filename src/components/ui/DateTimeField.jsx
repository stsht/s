import { useEffect, useId, useMemo, useRef, useState } from 'react';

/**
 * DateTimeField
 *
 * Unified DD/MM/YYYY (+ optional HH:mm) input used everywhere we
 * edit a date/time across /db, /inv, and /subs. Replaces the trio
 * of native <input type="date">, <input type="time">, and the
 * earlier DateField that overlaid an OS-native picker — every
 * surface inside the operator workspace now uses this control so
 * the look, focus ring, paste UX, and calendar popover are
 * identical wherever a date is edited.
 *
 * The component is fully controlled and stays compatible with the
 * existing wire format:
 *   - `value`        : ISO YYYY-MM-DD (or '' when empty)
 *   - `onChange(v)`  : fires with the new ISO YYYY-MM-DD or ''
 *   - `timeValue`    : 'HH:mm' / 'HH:mm:ss' / '' (only used when
 *                      withTime is true)
 *   - `onTimeChange` : fires with 'HH:mm' or ''
 *
 * Behaviour summary
 * -----------------
 *   - Three numeric date segments wrapped in a single bordered
 *     field. With `withTime`, two extra HH/mm segments are appended
 *     after a thin separator.
 *   - Typing 2 digits in day auto-advances to month, 2 in month to
 *     year (and year accepts 4). For time, 2 digits in hour
 *     auto-advance to minute. '/', '-', '.' or ':' typed mid-segment
 *     also advances focus.
 *   - Backspace on an empty segment hops focus to the previous
 *     segment so corrections feel natural; the time hour segment
 *     hops back to year.
 *   - Pasting a string that contains an 8-digit date (with or
 *     without separators) — optionally followed by an HH:mm time —
 *     fills every segment in one shot. Supported shapes:
 *       28052026
 *       28/05/2026
 *       28-05-2026
 *       2026-05-28
 *       28/05/2026 18:30
 *       28/05/2026T18:30
 *       2026-05-28T18:30:00
 *   - The trailing calendar icon opens a CUSTOM React popover with
 *     month grid, prev/next nav, Today and Clear actions. No native
 *     <input type="date">, no OS picker chrome.
 */
export function DateTimeField({
  value,
  onChange,
  withTime = false,
  timeValue = '',
  onTimeChange,
  ariaLabel,
  id,
  showCalendar = true,
}) {
  const reactId = useId();
  const fieldId = id || reactId;

  // ── Date segment state ────────────────────────────────────────
  const [day, setDay] = useState('');
  const [month, setMonth] = useState('');
  const [year, setYear] = useState('');
  // ── Time segment state (only meaningful when withTime) ────────
  const [hour, setHour] = useState('');
  const [minute, setMinute] = useState('');

  const dayRef = useRef(null);
  const monthRef = useRef(null);
  const yearRef = useRef(null);
  const hourRef = useRef(null);
  const minuteRef = useRef(null);
  const wrapRef = useRef(null);

  // Track the last ISO value we emitted upstream so a fresh prop
  // sync doesn't reformat segments while the operator is mid-typing.
  const lastEmittedDateRef = useRef('');
  const lastEmittedTimeRef = useRef('');

  const [popoverOpen, setPopoverOpen] = useState(false);

  // ── Sync external date prop -> internal segments ──────────────
  useEffect(() => {
    if ((value || '') === lastEmittedDateRef.current) return;
    if (/^\d{4}-\d{2}-\d{2}$/.test(value || '')) {
      const [yy, mm, dd] = value.split('-');
      setYear(yy);
      setMonth(mm);
      setDay(dd);
    } else if (!value) {
      setYear('');
      setMonth('');
      setDay('');
    }
    lastEmittedDateRef.current = value || '';
  }, [value]);

  // ── Sync external time prop -> internal segments ──────────────
  useEffect(() => {
    if (!withTime) return;
    const normalised = normaliseHhmm(timeValue);
    if (normalised === lastEmittedTimeRef.current) return;
    if (normalised) {
      const [hh, mm] = normalised.split(':');
      setHour(hh);
      setMinute(mm);
    } else if (!timeValue) {
      setHour('');
      setMinute('');
    }
    lastEmittedTimeRef.current = normalised;
  }, [timeValue, withTime]);

  // ── Outside-click closes the calendar popover ─────────────────
  useEffect(() => {
    if (!popoverOpen) return undefined;
    const handlePointerDown = (event) => {
      if (!wrapRef.current?.contains(event.target)) setPopoverOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [popoverOpen]);

  // ── Date emit ─────────────────────────────────────────────────
  function emitDate(nextDay, nextMonth, nextYear) {
    const dd = String(nextDay || '').padStart(2, '0');
    const mm = String(nextMonth || '').padStart(2, '0');
    const yyyy = String(nextYear || '');
    if (/^\d{2}$/.test(dd) && /^\d{2}$/.test(mm) && /^\d{4}$/.test(yyyy)) {
      const dNum = Number(dd);
      const mNum = Number(mm);
      const yNum = Number(yyyy);
      if (
        mNum >= 1 && mNum <= 12 &&
        dNum >= 1 && dNum <= 31 &&
        yNum >= 1900 && yNum <= 2999
      ) {
        const iso = `${yyyy}-${mm}-${dd}`;
        if (iso !== lastEmittedDateRef.current) {
          lastEmittedDateRef.current = iso;
          onChange?.(iso);
        }
        return;
      }
    }
    // Half-typed / invalid date -> clear upstream value so callers
    // never store a stale ISO behind a half-edited segment.
    if (lastEmittedDateRef.current !== '') {
      lastEmittedDateRef.current = '';
      onChange?.('');
    }
  }

  // ── Time emit ─────────────────────────────────────────────────
  function emitTime(nextHour, nextMinute) {
    const hh = String(nextHour || '').padStart(2, '0');
    const mm = String(nextMinute || '').padStart(2, '0');
    if (/^\d{2}$/.test(hh) && /^\d{2}$/.test(mm)) {
      const hNum = Number(hh);
      const mNum = Number(mm);
      if (hNum >= 0 && hNum <= 23 && mNum >= 0 && mNum <= 59) {
        const formatted = `${hh}:${mm}`;
        if (formatted !== lastEmittedTimeRef.current) {
          lastEmittedTimeRef.current = formatted;
          onTimeChange?.(formatted);
        }
        return;
      }
    }
    if (!nextHour && !nextMinute) {
      if (lastEmittedTimeRef.current !== '') {
        lastEmittedTimeRef.current = '';
        onTimeChange?.('');
      }
    }
  }

  // ── Segment change handler ────────────────────────────────────
  function handleSegmentChange(segment, raw, advanceTo) {
    const maxLen = segment === 'year' ? 4 : 2;
    const cleaned = String(raw || '').replace(/\D/g, '').slice(0, maxLen);
    let nextDay = day;
    let nextMonth = month;
    let nextYear = year;
    let nextHour = hour;
    let nextMinute = minute;
    if (segment === 'day') { setDay(cleaned); nextDay = cleaned; }
    else if (segment === 'month') { setMonth(cleaned); nextMonth = cleaned; }
    else if (segment === 'year') { setYear(cleaned); nextYear = cleaned; }
    else if (segment === 'hour') { setHour(cleaned); nextHour = cleaned; }
    else if (segment === 'minute') { setMinute(cleaned); nextMinute = cleaned; }

    if (segment === 'day' || segment === 'month' || segment === 'year') {
      emitDate(nextDay, nextMonth, nextYear);
    } else {
      emitTime(nextHour, nextMinute);
    }
    if (advanceTo && cleaned.length === maxLen) {
      advanceTo.current?.focus();
      advanceTo.current?.select?.();
    }
  }

  // ── Segment keydown (backspace hop, separator advance) ────────
  function handleSegmentKeyDown(event, segment, prevRef, nextRef) {
    if (event.key === 'Backspace' && !event.target.value && prevRef?.current) {
      event.preventDefault();
      prevRef.current.focus();
      const v = prevRef.current.value || '';
      try { prevRef.current.setSelectionRange(v.length, v.length); } catch {}
      return;
    }
    if (
      event.key === '/' || event.key === '-' || event.key === '.' ||
      event.key === ':' || event.key === ' ' || event.key === 'Tab'
    ) {
      const filled = String(event.target.value || '').replace(/\D/g, '');
      if (filled && nextRef?.current && event.key !== 'Tab') {
        event.preventDefault();
        nextRef.current.focus();
        nextRef.current.select?.();
      }
    }
  }

  // ── Paste (smart-fill all segments at once) ───────────────────
  function handlePaste(event) {
    const text = (event.clipboardData || window.clipboardData)?.getData('text');
    if (!text) return;
    const parsed = parsePastedDateTime(text);
    if (!parsed) return;
    event.preventDefault();
    setDay(parsed.day);
    setMonth(parsed.month);
    setYear(parsed.year);
    emitDate(parsed.day, parsed.month, parsed.year);
    if (withTime && parsed.hour && parsed.minute) {
      setHour(parsed.hour);
      setMinute(parsed.minute);
      emitTime(parsed.hour, parsed.minute);
    }
    // Move focus to the last segment that got filled so the next
    // keystroke is a natural continuation.
    if (withTime && parsed.hour) {
      minuteRef.current?.focus();
      minuteRef.current?.select?.();
    } else {
      yearRef.current?.focus();
      yearRef.current?.select?.();
    }
  }

  // ── Calendar popover ──────────────────────────────────────────
  function handleCalendarPick(iso) {
    if (iso) {
      const [yy, mm, dd] = iso.split('-');
      setYear(yy); setMonth(mm); setDay(dd);
      lastEmittedDateRef.current = iso;
      onChange?.(iso);
    } else {
      setYear(''); setMonth(''); setDay('');
      lastEmittedDateRef.current = '';
      onChange?.('');
    }
    setPopoverOpen(false);
  }

  return (
    <div
      ref={wrapRef}
      className={`dtf${withTime ? ' dtf--with-time' : ''}${popoverOpen ? ' dtf--open' : ''}`}
      role="group"
      aria-label={ariaLabel || (withTime ? 'Date and time' : 'Date')}
      onClick={(event) => {
        // Make the entire field one clickable target so a tap on
        // the day/month/year text or the calendar icon resolves
        // to the same picker. We skip when the click target is
        // already inside the calendar button — it owns a toggle
        // handler, so leaving that gesture alone preserves the
        // close-on-second-tap behaviour. Segment input clicks
        // still bubble through (the focus has already happened
        // by the time onClick fires) so the operator can type
        // OR tap to open the calendar without picking one over
        // the other. The popover is treated as additive: opening
        // it doesn't steal focus from a segment that was just
        // tapped, so paste/keyboard editing still work. */
        if (!showCalendar) return;
        if (event.target.closest?.('.dtf-icon')) return;
        if (event.target.closest?.('.dtf-popover')) return;
        if (!popoverOpen) setPopoverOpen(true);
      }}
    >
      <input
        ref={dayRef}
        id={fieldId}
        className="dtf-segment dtf-day"
        inputMode="numeric"
        maxLength={2}
        autoComplete="off"
        placeholder="DD"
        aria-label="Day"
        value={day}
        onChange={(e) => handleSegmentChange('day', e.target.value, monthRef)}
        onKeyDown={(e) => handleSegmentKeyDown(e, 'day', null, monthRef)}
        onFocus={(e) => e.target.select()}
        onPaste={handlePaste}
      />
      <span className="dtf-sep" aria-hidden="true">/</span>
      <input
        ref={monthRef}
        className="dtf-segment dtf-month"
        inputMode="numeric"
        maxLength={2}
        autoComplete="off"
        placeholder="MM"
        aria-label="Month"
        value={month}
        onChange={(e) => handleSegmentChange('month', e.target.value, yearRef)}
        onKeyDown={(e) => handleSegmentKeyDown(e, 'month', dayRef, yearRef)}
        onFocus={(e) => e.target.select()}
        onPaste={handlePaste}
      />
      <span className="dtf-sep" aria-hidden="true">/</span>
      <input
        ref={yearRef}
        className="dtf-segment dtf-year"
        inputMode="numeric"
        maxLength={4}
        autoComplete="off"
        placeholder="YYYY"
        aria-label="Year"
        value={year}
        onChange={(e) => handleSegmentChange('year', e.target.value, withTime ? hourRef : null)}
        onKeyDown={(e) => handleSegmentKeyDown(e, 'year', monthRef, withTime ? hourRef : null)}
        onFocus={(e) => e.target.select()}
        onPaste={handlePaste}
      />
      {withTime ? (
        <>
          <span className="dtf-time-divider" aria-hidden="true" />
          <input
            ref={hourRef}
            className="dtf-segment dtf-hour"
            inputMode="numeric"
            maxLength={2}
            autoComplete="off"
            placeholder="HH"
            aria-label="Hour"
            value={hour}
            onChange={(e) => handleSegmentChange('hour', e.target.value, minuteRef)}
            onKeyDown={(e) => handleSegmentKeyDown(e, 'hour', yearRef, minuteRef)}
            onFocus={(e) => e.target.select()}
            onPaste={handlePaste}
          />
          <span className="dtf-sep" aria-hidden="true">:</span>
          <input
            ref={minuteRef}
            className="dtf-segment dtf-minute"
            inputMode="numeric"
            maxLength={2}
            autoComplete="off"
            placeholder="mm"
            aria-label="Minute"
            value={minute}
            onChange={(e) => handleSegmentChange('minute', e.target.value, null)}
            onKeyDown={(e) => handleSegmentKeyDown(e, 'minute', hourRef, null)}
            onFocus={(e) => e.target.select()}
            onPaste={handlePaste}
          />
        </>
      ) : null}
      {showCalendar ? (
        <button
          type="button"
          className="dtf-icon"
          aria-label="Open calendar"
          aria-expanded={popoverOpen}
          tabIndex={-1}
          onClick={() => setPopoverOpen((open) => !open)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <rect x="3.5" y="5" width="17" height="15" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <path d="M3.5 9.5h17" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            <path d="M8 3.5v3M16 3.5v3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      ) : null}
      {popoverOpen ? (
        <CalendarPopover
          anchorIso={value || ''}
          onPick={handleCalendarPick}
          onClose={() => setPopoverOpen(false)}
        />
      ) : null}
    </div>
  );
}

// ── Calendar popover ────────────────────────────────────────────
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const DOW_LABELS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

function CalendarPopover({ anchorIso, onPick }) {
  const today = todayIso();
  const initial = /^\d{4}-\d{2}-\d{2}$/.test(anchorIso) ? anchorIso : today;
  const [yy, mm] = initial.split('-').map(Number);
  const [viewYear, setViewYear] = useState(yy);
  const [viewMonth, setViewMonth] = useState(mm); // 1-12

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

  return (
    <div className="dtf-popover" role="dialog" aria-label="Pick date">
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
}

// ── Helpers ──────────────────────────────────────────────────────
function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

// Build the 6-week (42 cell) month grid that the popover renders.
// Monday-first so European week conventions line up with the rest
// of the operator UI. Every cell carries the ISO date it represents
// plus a `muted` flag for cells that fall outside the active month
// (so they can be styled greyer without computing a separate range).
function buildMonthGrid(year, month) {
  const firstOfMonth = new Date(Date.UTC(year, month - 1, 1));
  // 0 = Mon, 6 = Sun (rotate JS's 0=Sun..6=Sat by 6).
  const dow = (firstOfMonth.getUTCDay() + 6) % 7;
  const start = new Date(Date.UTC(year, month - 1, 1 - dow));
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    const iso = d.toISOString().slice(0, 10);
    cells.push({
      iso,
      day: d.getUTCDate(),
      muted: d.getUTCMonth() !== month - 1,
    });
  }
  return cells;
}

// Strip seconds from an HH:MM:SS so the segments only ever store
// the canonical 'HH:mm' shape on the wire. Returns '' for unparsable
// input; the caller treats that as "leave the time empty".
function normaliseHhmm(value) {
  const raw = String(value || '').trim();
  const match = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(raw);
  if (!match) return '';
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h < 0 || h > 23 || m < 0 || m > 59) return '';
  return `${match[1]}:${match[2]}`;
}

// Parse a pasted blob into segment values. Accepts the common
// ways an operator might paste a date (with or without time):
//   28052026
//   28/05/2026   28-05-2026   28.05.2026
//   2026-05-28   2026/05/28
//   28/05/2026 18:30   2026-05-28T18:30:00
// Returns null when no recognisable date is present.
export function parsePastedDateTime(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;

  // Pattern 1: ISO-ish 'YYYY-MM-DD' optionally followed by a time
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s](\d{1,2}):(\d{2})(?::\d{2})?)?/.exec(raw);
  if (m) {
    return packDateTime(m[3], m[2], m[1], m[4], m[5]);
  }

  // Pattern 2: 'DD/MM/YYYY' optionally followed by a time
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:[T\s](\d{1,2}):(\d{2})(?::\d{2})?)?/.exec(raw);
  if (m) {
    return packDateTime(m[1], m[2], m[3], m[4], m[5]);
  }

  // Pattern 3: bare 8-digit run 'DDMMYYYY' (optionally followed by 4
  // digits 'HHMM'). 12 digits collapse to date+time.
  const digits = raw.replace(/\D/g, '');
  if (digits.length >= 8) {
    const dd = digits.slice(0, 2);
    const mm = digits.slice(2, 4);
    const yyyy = digits.slice(4, 8);
    const hh = digits.length >= 10 ? digits.slice(8, 10) : '';
    const mn = digits.length >= 12 ? digits.slice(10, 12) : '';
    return packDateTime(dd, mm, yyyy, hh, mn);
  }
  return null;
}

function packDateTime(dd, mm, yyyy, hh, mn) {
  const day = String(dd || '').padStart(2, '0');
  const month = String(mm || '').padStart(2, '0');
  const year = String(yyyy || '');
  if (!/^\d{2}$/.test(day) || !/^\d{2}$/.test(month) || !/^\d{4}$/.test(year)) return null;
  const dNum = Number(day);
  const mNum = Number(month);
  const yNum = Number(year);
  if (mNum < 1 || mNum > 12 || dNum < 1 || dNum > 31 || yNum < 1900 || yNum > 2999) return null;
  let hour = '';
  let minute = '';
  if (hh && mn) {
    const h = String(hh).padStart(2, '0');
    const mi = String(mn).padStart(2, '0');
    if (/^\d{2}$/.test(h) && /^\d{2}$/.test(mi) && Number(h) < 24 && Number(mi) < 60) {
      hour = h;
      minute = mi;
    }
  }
  return { day, month, year, hour, minute };
}
