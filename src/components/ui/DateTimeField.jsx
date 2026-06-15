import { useEffect, useId, useRef, useState } from 'react';

import { CalendarPopover } from './DateTimePopover.jsx';
import { normaliseHhmm, parsePastedDateTime } from './dateTimeFieldUtils.js';

import './DateTimeField.css';

/**
 * DateTimeField
 *
 * Unified DD/MM/YY (+ optional HH:mm) input used everywhere we
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
 *   - Typing only a 2-digit day auto-fills the current month/year.
 *     Otherwise day advances to month, month to year, and year
 *     displays 2 digits while storing as 20YY. For time, 2 digits in hour
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
      setYear(yy.slice(-2));
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
      if (event.target.closest?.('.dtf-popover')) return;
      if (!wrapRef.current?.contains(event.target)) setPopoverOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [popoverOpen]);

  // ── Date emit ─────────────────────────────────────────────────
  function emitDate(nextDay, nextMonth, nextYear) {
    const dd = String(nextDay || '').padStart(2, '0');
    const mm = String(nextMonth || '').padStart(2, '0');
    const rawYear = String(nextYear || '');
    const yyyy = rawYear.length === 2 ? `20${rawYear}` : rawYear;
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
    const maxLen = 2;
    const cleaned = String(raw || '').replace(/\D/g, '').slice(0, maxLen);
    let nextAdvance = advanceTo;
    let nextDay = day;
    let nextMonth = month;
    let nextYear = year;
    let nextHour = hour;
    let nextMinute = minute;
    if (segment === 'day') {
      setDay(cleaned);
      nextDay = cleaned;
      if (cleaned.length === 2 && !month && !year) {
        const now = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        nextMonth = pad(now.getMonth() + 1);
        nextYear = String(now.getFullYear()).slice(-2);
        setMonth(nextMonth);
        setYear(nextYear);
        nextAdvance = withTime ? hourRef : null;
      }
    }
    else if (segment === 'month') { setMonth(cleaned); nextMonth = cleaned; }
    else if (segment === 'year') { setYear(cleaned); nextYear = cleaned; }
    else if (segment === 'hour') { setHour(cleaned); nextHour = cleaned; }
    else if (segment === 'minute') { setMinute(cleaned); nextMinute = cleaned; }

    if (segment === 'day' || segment === 'month' || segment === 'year') {
      emitDate(nextDay, nextMonth, nextYear);
    } else {
      emitTime(nextHour, nextMinute);
    }
    if (nextAdvance && cleaned.length === maxLen) {
      nextAdvance.current?.focus();
      nextAdvance.current?.select?.();
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
    setYear(parsed.year.slice(-2));
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
      setYear(yy.slice(-2)); setMonth(mm); setDay(dd);
      lastEmittedDateRef.current = iso;
      onChange?.(iso);
    } else {
      setYear(''); setMonth(''); setDay('');
      lastEmittedDateRef.current = '';
      onChange?.('');
    }
    // In time mode the popover stays open so the operator can also
    // pick an hour/minute; Done (or an outside click) closes it.
    // Date-only keeps the original close-on-pick behaviour.
    if (!withTime) setPopoverOpen(false);
  }

  // Hour/minute chosen from the popover time selector. Mirrors the
  // segment state and emits 'HH:mm' (or clears) without closing the
  // popover so date + time can be set in one session.
  function handleCalendarTimePick(hhmm) {
    if (hhmm) {
      const [hh, mm] = hhmm.split(':');
      setHour(hh); setMinute(mm);
      emitTime(hh, mm);
    } else {
      setHour(''); setMinute('');
      emitTime('', '');
    }
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
        maxLength={2}
        autoComplete="off"
        placeholder="YY"
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
          anchorRef={wrapRef}
          anchorIso={value || ''}
          onPick={handleCalendarPick}
          withTime={withTime}
          anchorTime={withTime ? `${hour}:${minute}` : ''}
          onTimePick={handleCalendarTimePick}
          onClose={() => setPopoverOpen(false)}
        />
      ) : null}
    </div>
  );
}
