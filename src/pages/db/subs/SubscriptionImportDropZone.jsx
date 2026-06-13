import { useRef, useState } from 'react';

// Polished drag-and-drop upload zone used by SubscriptionImport.
// Wraps a visually-hidden <input type="file"> so the same control
// handles three input modes:
//   • click anywhere on the zone       → opens the file picker
//   • drag a file over the zone        → highlights drop target
//   • drop a file onto the zone        → handed to onFile(File)
// The native input also stays keyboard-focusable: pressing Enter
// or Space while focused opens the picker, matching link/button
// affordances. The dragCounter ref is what keeps the highlight
// stable when the pointer crosses child elements (each enter/leave
// nests, and naive boolean state would flicker).
export function SubsImportDropZone({ busy, fileName, onFile }) {
  const inputRef = useRef(null);
  const dragCounter = useRef(0);
  const [dragActive, setDragActive] = useState(false);

  function pickFile() {
    if (busy) return;
    inputRef.current?.click();
  }

  function onKeyDown(event) {
    if (busy) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      pickFile();
    }
  }

  function onChange(event) {
    const file = event.target?.files?.[0];
    if (file) onFile(file);
    // Reset so re-selecting the same file fires another change.
    if (event.target) event.target.value = '';
  }

  function onDragEnter(event) {
    event.preventDefault();
    event.stopPropagation();
    if (busy) return;
    dragCounter.current += 1;
    if (event.dataTransfer?.items?.length) setDragActive(true);
  }

  function onDragOver(event) {
    // Required to make the element a valid drop target — without
    // this the browser cancels the drop before our handler runs.
    event.preventDefault();
    event.stopPropagation();
    if (busy) return;
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  }

  function onDragLeave(event) {
    event.preventDefault();
    event.stopPropagation();
    dragCounter.current = Math.max(0, dragCounter.current - 1);
    if (dragCounter.current === 0) setDragActive(false);
  }

  function onDrop(event) {
    event.preventDefault();
    event.stopPropagation();
    dragCounter.current = 0;
    setDragActive(false);
    if (busy) return;
    const file = event.dataTransfer?.files?.[0];
    if (file) onFile(file);
  }

  const stateClass = busy
    ? ' subs-drop--busy'
    : dragActive
      ? ' subs-drop--active'
      : '';

  return (
    <div className="subs-drop-wrap">
      <span className="qr-upload-label">Receipt JPG</span>
      <div
        role="button"
        tabIndex={busy ? -1 : 0}
        aria-disabled={busy}
        aria-label="Drop a StarShots receipt JPG here, or click to browse"
        className={`subs-drop${stateClass}`}
        onClick={pickFile}
        onKeyDown={onKeyDown}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={onChange}
          disabled={busy}
          tabIndex={-1}
          aria-hidden="true"
        />
        <svg className="subs-drop-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path
            d="M12 16V4m0 0l-4 4m4-4l4 4M5 20h14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <strong className="subs-drop-title">
          {busy
            ? 'Reading image…'
            : dragActive
              ? 'Drop to extract fields'
              : 'Drop a StarShots receipt here'}
        </strong>
        <span className="subs-drop-hint">
          {fileName
            ? fileName
            : 'or click to browse · JPG, PNG, or WebP'}
        </span>
      </div>
    </div>
  );
}
