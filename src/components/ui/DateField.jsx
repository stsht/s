import { useEffect, useRef, useState } from 'react';

/**
 * DateField
 *
 * Modern segmented DD/MM/YYYY date input that always emits a
 * normalized ISO YYYY-MM-DD value to its parent (or '' when the
 * three segments are not yet a valid date). Replaces the native
 * <input type="date"> in /inv where the placeholder-style chrome
 * read as "greyed/disabled" until it was clicked.
 *
 * Behaviour:
 *   - Three numeric segments (day, month, year) wrapped in a
 *     single bordered field that picks up the same focus ring as
 *     other text inputs in invcs.css.
 *   - Typing 2 digits in day auto-advances focus to month; 2
 *     digits in month auto-advance to year. Year accepts up to 4
 *     digits.
 *   - A trailing calendar icon overlays a transparent native
 *     <input type="date"> so the operator can still pick from the
 *     OS/browser date picker (Chromium showPicker or Firefox
 *     click-to-open). The native input writes the same ISO value.
 *   - Backspace on an empty segment hops focus back to the
 *     previous segment so corrections feel natural.
 *
 * The component is fully controlled: pass `value` (YYYY-MM-DD or
 * '') and an `onChange(value)` handler. Internal segment state is
 * derived from the prop, with a transient buffer so a half-typed
 * date (e.g. "1") doesn't get clobbered before the user finishes.
 */
export function DateField({ value, onChange, ariaLabel, id }) {
  const [day, setDay] = useState('');
  const [month, setMonth] = useState('');
  const [year, setYear] = useState('');
  const dayRef = useRef(null);
  const monthRef = useRef(null);
  const yearRef = useRef(null);
  const pickerRef = useRef(null);
  const lastEmittedRef = useRef('');

  // Sync external value -> internal segments. We only re-split the
  // ISO when the prop differs from what we last emitted, so a
  // freshly typed segment isn't immediately reformatted while the
  // operator is still typing the next digit.
  useEffect(() => {
    if (value === lastEmittedRef.current) return;
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
    lastEmittedRef.current = value || '';
  }, [value]);

  function emit(nextDay, nextMonth, nextYear) {
    const dd = nextDay.padStart(2, '0');
    const mm = nextMonth.padStart(2, '0');
    const yyyy = nextYear;
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
        if (iso !== lastEmittedRef.current) {
          lastEmittedRef.current = iso;
          onChange?.(iso);
        }
        return;
      }
    }
    // Incomplete or invalid: clear the upstream value so the
    // composer doesn't keep a stale ISO around for a half-typed
    // date. prettyDate('') already renders as '-'.
    if (lastEmittedRef.current !== '') {
      lastEmittedRef.current = '';
      onChange?.('');
    }
  }

  function handleSegmentChange(segment, raw, advanceTo) {
    const cleaned = raw.replace(/\D/g, '').slice(0, segment === 'year' ? 4 : 2);
    let nextDay = day;
    let nextMonth = month;
    let nextYear = year;
    if (segment === 'day') { setDay(cleaned); nextDay = cleaned; }
    else if (segment === 'month') { setMonth(cleaned); nextMonth = cleaned; }
    else if (segment === 'year') { setYear(cleaned); nextYear = cleaned; }
    emit(nextDay, nextMonth, nextYear);
    if (advanceTo && cleaned.length === (segment === 'year' ? 4 : 2)) {
      advanceTo.current?.focus();
      advanceTo.current?.select?.();
    }
  }

  function handleSegmentKeyDown(event, segment, prevRef) {
    if (event.key === 'Backspace' && !event.target.value && prevRef?.current) {
      event.preventDefault();
      prevRef.current.focus();
      const prevValue = prevRef.current.value || '';
      // Move caret to end on hop-back so the next backspace
      // deletes the last digit rather than the whole segment.
      try { prevRef.current.setSelectionRange(prevValue.length, prevValue.length); } catch {}
      return;
    }
    if (event.key === '/' || event.key === '-' || event.key === '.') {
      event.preventDefault();
      const filled = String(event.target.value || '').replace(/\D/g, '');
      if (filled) {
        // Advance to the next segment when the operator types a
        // separator mid-typing (e.g. "5/" -> jumps to month).
        if (segment === 'day') monthRef.current?.focus();
        else if (segment === 'month') yearRef.current?.focus();
      }
    }
  }

  function openPicker() {
    const el = pickerRef.current;
    if (!el) return;
    if (typeof el.showPicker === 'function') {
      try { el.showPicker(); return; } catch {}
    }
    try { el.focus(); el.click(); } catch {}
  }

  function handlePickerChange(event) {
    const raw = String(event.target.value || '');
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      const [yy, mm, dd] = raw.split('-');
      setYear(yy); setMonth(mm); setDay(dd);
      lastEmittedRef.current = raw;
      onChange?.(raw);
    } else if (!raw) {
      setYear(''); setMonth(''); setDay('');
      lastEmittedRef.current = '';
      onChange?.('');
    }
  }

  return (
    <div className="date-field" role="group" aria-label={ariaLabel || 'Date'} id={id}>
      <input
        ref={dayRef}
        className="date-field-segment date-field-day"
        inputMode="numeric"
        maxLength={2}
        autoComplete="off"
        placeholder="DD"
        aria-label="Day"
        value={day}
        onChange={(e) => handleSegmentChange('day', e.target.value, monthRef)}
        onKeyDown={(e) => handleSegmentKeyDown(e, 'day', null)}
        onFocus={(e) => e.target.select()}
      />
      <span className="date-field-sep" aria-hidden="true">/</span>
      <input
        ref={monthRef}
        className="date-field-segment date-field-month"
        inputMode="numeric"
        maxLength={2}
        autoComplete="off"
        placeholder="MM"
        aria-label="Month"
        value={month}
        onChange={(e) => handleSegmentChange('month', e.target.value, yearRef)}
        onKeyDown={(e) => handleSegmentKeyDown(e, 'month', dayRef)}
        onFocus={(e) => e.target.select()}
      />
      <span className="date-field-sep" aria-hidden="true">/</span>
      <input
        ref={yearRef}
        className="date-field-segment date-field-year"
        inputMode="numeric"
        maxLength={4}
        autoComplete="off"
        placeholder="YYYY"
        aria-label="Year"
        value={year}
        onChange={(e) => handleSegmentChange('year', e.target.value, null)}
        onKeyDown={(e) => handleSegmentKeyDown(e, 'year', monthRef)}
        onFocus={(e) => e.target.select()}
      />
      <span className="date-field-picker-wrap">
        <button
          type="button"
          className="date-field-icon"
          tabIndex={-1}
          aria-hidden="true"
          onClick={openPicker}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <rect x="3.5" y="5" width="17" height="15" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <path d="M3.5 9.5h17" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            <path d="M8 3.5v3M16 3.5v3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
        <input
          ref={pickerRef}
          type="date"
          className="date-field-picker"
          aria-label="Pick date from calendar"
          value={value || ''}
          onChange={handlePickerChange}
        />
      </span>
    </div>
  );
}
