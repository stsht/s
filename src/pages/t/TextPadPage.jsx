import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// /t — Text Pad.
//
// A minimal, backend-free plain-text editor / paste surface. The
// title doubles as the download filename (always exported as
// `<title>.md`), Ctrl/Cmd+S triggers the download, and the body
// autosaves to localStorage so an accidental reload never loses
// work. No database, no formatting, no network — just a pad.

const STORAGE_KEY = 'sshots_textpad_v1';

// Turn the title into a safe, human download filename. Strips the
// characters that are illegal in filenames across Windows/macOS/
// Linux, collapses whitespace, and falls back to "untitled" so the
// download always has a sensible name.
function sanitizeFilename(value) {
  const base = String(value || '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return base || 'untitled';
}

function DownloadIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="17"
      height="17"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 3v12" />
      <path d="m7 11 5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  );
}

export function TextPadPage() {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [saved, setSaved] = useState(true);
  // Guards the autosave effect so the first persist can't overwrite
  // stored content with empty defaults before the restore runs.
  const hydrated = useRef(false);

  // Restore the last session once on mount.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        if (typeof data?.title === 'string') setTitle(data.title);
        if (typeof data?.body === 'string') setBody(data.body);
      }
    } catch {
      /* ignore corrupt/unavailable storage */
    }
    hydrated.current = true;
  }, []);

  // Debounced autosave to localStorage. Local-only; no backend.
  useEffect(() => {
    if (!hydrated.current) return undefined;
    setSaved(false);
    const id = setTimeout(() => {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ title, body }));
        setSaved(true);
      } catch {
        /* storage full / disabled — editing still works in-memory */
      }
    }, 300);
    return () => clearTimeout(id);
  }, [title, body]);

  const download = useCallback(() => {
    const filename = `${sanitizeFilename(title)}.md`;
    const blob = new Blob([body], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [title, body]);

  // Ctrl/Cmd+S downloads instead of invoking the browser's save.
  useEffect(() => {
    function onKeyDown(event) {
      if ((event.metaKey || event.ctrlKey) && String(event.key).toLowerCase() === 's') {
        event.preventDefault();
        download();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [download]);

  const counts = useMemo(() => {
    const trimmed = body.trim();
    return {
      words: trimmed ? trimmed.split(/\s+/).length : 0,
      chars: body.length,
      lines: body ? body.split('\n').length : 0,
    };
  }, [body]);

  return (
    <main className="t-app">
      <section className="t-shell">
        <header className="t-bar">
          <input
            className="t-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Untitled"
            aria-label="Document title (used as the download filename)"
            spellCheck="false"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
          />
          <button
            type="button"
            className="t-download"
            onClick={download}
            title="Download (Ctrl/Cmd+S)"
            tabIndex={-1}
          >
            <DownloadIcon />
            <span>Download&nbsp;.md</span>
          </button>
        </header>

        <textarea
          className="t-editor scroll-surface-y"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="Start typing or paste text here…"
          aria-label="Text body"
          spellCheck="true"
          autoComplete="off"
          autoFocus
        />

        <footer className="t-foot">
          <span className="t-stat">{counts.words.toLocaleString()} words</span>
          <span className="t-stat">{counts.chars.toLocaleString()} chars</span>
          <span className="t-stat t-stat-lines">{counts.lines.toLocaleString()} lines</span>
          <span className="t-foot-spacer" aria-hidden="true" />
          <span className={`t-saved${saved ? ' is-saved' : ''}`}>
            {saved ? 'Saved on this device' : 'Saving…'}
          </span>
        </footer>
      </section>
    </main>
  );
}
