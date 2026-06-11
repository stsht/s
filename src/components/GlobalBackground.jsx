import './GlobalBackground.css';

export function GlobalBackground() {
  return (
    <>
      <div className="ss-bg" aria-hidden="true" />
      {/* Ambient colour pools. Each blob is an independent, blurred
          radial-gradient placed at a fixed spot, so together they
          read as a rich, static aurora that adds depth and smooth
          colour blending (no motion — see GlobalBackground.css for
          why the old continuous drift was removed). The container
          clips them to the viewport and never intercepts pointers. */}
      <div className="ss-aurora" aria-hidden="true">
        <span className="ss-blob ss-blob-1" />
        <span className="ss-blob ss-blob-2" />
        <span className="ss-blob ss-blob-3" />
        <span className="ss-blob ss-blob-4" />
        <span className="ss-blob ss-blob-5" />
        <span className="ss-blob ss-blob-6" />
        <span className="ss-blob ss-blob-7" />
        <span className="ss-blob ss-blob-8" />
      </div>
    </>
  );
}
