import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';

/**
 * Combobox
 *
 * Reusable, styled drop-down replacement for native <select>. It
 * matches the StarShots input/field design so a Title or Status
 * picker reads as part of the same form family as the surrounding
 * text inputs (same height, radius, palette, focus halo) instead
 * of falling back to the OS-painted select that varies between
 * Windows / macOS / mobile browsers.
 *
 * Props
 *   value     - currently selected option value (string).
 *   onChange  - (nextValue) => void. Called with the option's
 *               value when the user picks one.
 *   options   - [{ value, label }] | [string]. Strings are auto-
 *               normalised to { value, label }.
 *   ariaLabel - accessible name when the field is rendered without
 *               a wrapping <label>.
 *   placeholder - shown when the value doesn't match any option.
 *   searchable - when true, the menu shows a small search field
 *                that filters the option list (case-insensitive).
 *                Defaults to false because most current callers
 *                (Title, Status) have a fixed handful of options.
 *   disabled  - when true the trigger is non-interactive.
 *   id        - optional id for the trigger button (forwarded for
 *               <label htmlFor> wiring).
 *
 * Behaviour
 *   - Click trigger → toggles menu.
 *   - Click outside / Escape → closes.
 *   - Arrow keys navigate, Enter selects, Home/End jump to the
 *     edges, typing (when not searchable) jumps to the first
 *     option whose label starts with the pressed character.
 *   - Selecting an option closes the menu and focuses the trigger.
 *   - Mobile-friendly: the menu sits inside the form layout so it
 *     scrolls with the right panel and never relies on portal
 *     positioning. Touch targets respect the 44px minimum.
 */
export function Combobox({
  value,
  onChange,
  options,
  ariaLabel,
  placeholder = 'Select…',
  searchable = false,
  disabled = false,
  id,
  className,
}) {
  const normalisedOptions = useMemo(() => {
    return (Array.isArray(options) ? options : []).map((opt) => {
      if (opt && typeof opt === 'object') {
        const v = opt.value ?? opt.label ?? '';
        return { value: String(v), label: String(opt.label ?? opt.value ?? '') };
      }
      const s = String(opt ?? '');
      return { value: s, label: s };
    });
  }, [options]);

  const [open, setOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const [filter, setFilter] = useState('');

  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const listRef = useRef(null);
  const searchRef = useRef(null);
  const reactId = useId();
  const triggerId = id || `cbx-${reactId}`;
  const listId = `${triggerId}-list`;

  const filteredOptions = useMemo(() => {
    if (!searchable || !filter.trim()) return normalisedOptions;
    const q = filter.trim().toLowerCase();
    return normalisedOptions.filter((opt) => opt.label.toLowerCase().includes(q));
  }, [normalisedOptions, searchable, filter]);

  const selectedOption = useMemo(() => {
    return normalisedOptions.find((opt) => opt.value === String(value ?? '')) || null;
  }, [normalisedOptions, value]);

  // Close on outside click / touch.
  useEffect(() => {
    if (!open) return undefined;
    const handler = (event) => {
      const root = rootRef.current;
      if (root && !root.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler, { passive: true });
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [open]);

  // Reset highlight + filter when opening / when option set
  // changes. Default highlight to the currently-selected option so
  // the user sees the keyboard cursor land on what they have.
  useEffect(() => {
    if (!open) {
      setFilter('');
      setHighlightIndex(-1);
      return;
    }
    const idx = filteredOptions.findIndex((opt) => opt.value === String(value ?? ''));
    setHighlightIndex(idx >= 0 ? idx : (filteredOptions.length ? 0 : -1));
    if (searchable) {
      // Defer focus so the menu has rendered.
      Promise.resolve().then(() => searchRef.current?.focus());
    }
  }, [open, filteredOptions, searchable, value]);

  // Scroll the highlighted option into view inside the listbox.
  useEffect(() => {
    if (!open || highlightIndex < 0) return;
    const list = listRef.current;
    if (!list) return;
    const el = list.querySelector(`[data-index="${highlightIndex}"]`);
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest' });
    }
  }, [open, highlightIndex]);

  const closeAndFocus = useCallback(() => {
    setOpen(false);
    Promise.resolve().then(() => triggerRef.current?.focus());
  }, []);

  const commit = useCallback((nextValue) => {
    if (typeof onChange === 'function') onChange(nextValue);
    closeAndFocus();
  }, [onChange, closeAndFocus]);

  const onTriggerKeyDown = useCallback((event) => {
    if (disabled) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setOpen(true);
      return;
    }
  }, [disabled]);

  const onListKeyDown = useCallback((event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeAndFocus();
      return;
    }
    if (event.key === 'Tab') {
      // Let focus leave the menu naturally, but close it first so
      // the next focus target gets a clean field.
      setOpen(false);
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!filteredOptions.length) return;
      setHighlightIndex((cur) => {
        const next = cur + 1;
        return next >= filteredOptions.length ? 0 : next;
      });
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!filteredOptions.length) return;
      setHighlightIndex((cur) => {
        const next = cur - 1;
        return next < 0 ? filteredOptions.length - 1 : next;
      });
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      if (filteredOptions.length) setHighlightIndex(0);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      if (filteredOptions.length) setHighlightIndex(filteredOptions.length - 1);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (highlightIndex >= 0 && highlightIndex < filteredOptions.length) {
        commit(filteredOptions[highlightIndex].value);
      }
      return;
    }
    // Type-to-jump (only when search input isn't capturing the
    // keystrokes). Single printable characters land on the first
    // option whose label starts with the typed letter.
    if (!searchable && event.key.length === 1 && /\S/.test(event.key)) {
      const ch = event.key.toLowerCase();
      const startFrom = (highlightIndex + 1) % Math.max(1, filteredOptions.length);
      const tryFind = (start) => {
        for (let i = 0; i < filteredOptions.length; i += 1) {
          const idx = (start + i) % filteredOptions.length;
          if (filteredOptions[idx].label.toLowerCase().startsWith(ch)) return idx;
        }
        return -1;
      };
      const found = tryFind(startFrom);
      if (found >= 0) setHighlightIndex(found);
    }
  }, [closeAndFocus, filteredOptions, highlightIndex, commit, searchable]);

  const triggerLabel = selectedOption?.label || (value ? String(value) : placeholder);
  const triggerClassName = ['combobox-trigger', open ? 'open' : '', className || ''].filter(Boolean).join(' ');

  return (
    <div className={`combobox${open ? ' open' : ''}`} ref={rootRef}>
      <button
        type="button"
        id={triggerId}
        ref={triggerRef}
        className={triggerClassName}
        aria-haspopup="listbox"
        aria-expanded={open ? 'true' : 'false'}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => { if (!disabled) setOpen((cur) => !cur); }}
        onKeyDown={onTriggerKeyDown}
      >
        <span className={`combobox-value${selectedOption ? '' : ' is-placeholder'}`}>{triggerLabel}</span>
        <span className="combobox-caret" aria-hidden="true">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2.5 4.25L6 7.75L9.5 4.25" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>
      {open ? (
        <div className="combobox-menu" role="presentation" onKeyDown={onListKeyDown}>
          {searchable ? (
            <div className="combobox-search">
              <input
                ref={searchRef}
                type="text"
                value={filter}
                onChange={(event) => {
                  setFilter(event.target.value);
                  setHighlightIndex(0);
                }}
                placeholder="Search…"
                aria-label="Filter options"
                autoComplete="off"
                spellCheck="false"
              />
            </div>
          ) : null}
          <ul
            id={listId}
            ref={listRef}
            role="listbox"
            tabIndex={-1}
            className="combobox-list"
            aria-activedescendant={highlightIndex >= 0 ? `${listId}-opt-${highlightIndex}` : undefined}
          >
            {filteredOptions.length === 0 ? (
              <li className="combobox-empty">No matches</li>
            ) : null}
            {filteredOptions.map((opt, idx) => {
              const isSelected = opt.value === String(value ?? '');
              const isHighlighted = idx === highlightIndex;
              const optionClass = [
                'combobox-option',
                isSelected ? 'selected' : '',
                isHighlighted ? 'highlighted' : '',
              ].filter(Boolean).join(' ');
              return (
                <li
                  key={`${opt.value}-${idx}`}
                  id={`${listId}-opt-${idx}`}
                  role="option"
                  aria-selected={isSelected ? 'true' : 'false'}
                  data-index={idx}
                  className={optionClass}
                  onMouseDown={(event) => {
                    // Use mousedown so the click registers before
                    // focus shifts away from the menu (otherwise
                    // the outside-click handler would close before
                    // commit fires).
                    event.preventDefault();
                    commit(opt.value);
                  }}
                  onMouseEnter={() => setHighlightIndex(idx)}
                >
                  {opt.label}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
