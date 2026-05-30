import { useEffect, useId, useMemo, useRef, useState } from 'react';

function normalizeOptions(options = []) {
  return options.map((option) => {
    if (typeof option === 'string') return { value: option, label: option };
    return {
      value: String(option?.value ?? option?.label ?? ''),
      label: String(option?.label ?? option?.value ?? ''),
    };
  }).filter((option) => option.value || option.label);
}

export function Combobox({
  value,
  onChange,
  options,
  placeholder = 'Select',
  ariaLabel,
  className = '',
}) {
  const id = useId();
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const normalized = useMemo(() => normalizeOptions(options), [options]);
  const selected = normalized.find((option) => option.value === value) || null;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return normalized;
    return normalized.filter((option) => option.label.toLowerCase().includes(q));
  }, [normalized, query]);

  useEffect(() => {
    if (activeIndex >= filtered.length) setActiveIndex(0);
  }, [activeIndex, filtered.length]);

  useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

  const displayValue = open ? query : selected?.label || String(value || '');

  function openMenu() {
    setQuery('');
    setActiveIndex(Math.max(0, normalized.findIndex((option) => option.value === value)));
    setOpen(true);
  }

  function choose(option) {
    if (!option) return;
    onChange?.(option.value);
    setOpen(false);
    setQuery('');
    inputRef.current?.blur();
  }

  function handleKeyDown(event) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!open) {
        openMenu();
        return;
      }
      setActiveIndex((current) => Math.min(current + 1, Math.max(0, filtered.length - 1)));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        openMenu();
        return;
      }
      setActiveIndex((current) => Math.max(current - 1, 0));
    } else if (event.key === 'Enter') {
      if (!open) return;
      event.preventDefault();
      choose(filtered[activeIndex]);
    } else if (event.key === 'Escape') {
      if (!open) return;
      event.preventDefault();
      setOpen(false);
      setQuery('');
    }
  }

  return (
    <div ref={rootRef} className={`combobox${open ? ' is-open' : ''}${className ? ` ${className}` : ''}`}>
      <div className="combobox-control">
        <input
          ref={inputRef}
          className="combobox-input"
          role="combobox"
          aria-label={ariaLabel || placeholder}
          aria-expanded={open}
          aria-controls={`${id}-listbox`}
          aria-autocomplete="list"
          aria-activedescendant={open && filtered[activeIndex] ? `${id}-option-${activeIndex}` : undefined}
          value={displayValue}
          placeholder={placeholder}
          autoComplete="off"
          onFocus={openMenu}
          onClick={openMenu}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            setActiveIndex(0);
          }}
          onKeyDown={handleKeyDown}
        />
        <span className="combobox-chevron" aria-hidden="true">
          <svg viewBox="0 0 24 24" focusable="false">
            <path d="M7 10l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </div>
      {open ? (
        <div className="combobox-menu" id={`${id}-listbox`} role="listbox">
          {filtered.length ? filtered.map((option, index) => {
            const active = index === activeIndex;
            const chosen = option.value === value;
            return (
              <button
                key={`${option.value}-${index}`}
                id={`${id}-option-${index}`}
                type="button"
                role="option"
                aria-selected={chosen}
                className={`combobox-option${active ? ' is-active' : ''}${chosen ? ' is-selected' : ''}`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => choose(option)}
              >
                {option.label}
              </button>
            );
          }) : (
            <span className="combobox-empty">No matches</span>
          )}
        </div>
      ) : null}
    </div>
  );
}
