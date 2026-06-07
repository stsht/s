import './GlobalBackground.css';

export function GlobalBackground() {
  return (
    <>
      <div className="ss-bg" aria-hidden="true" />
      {/* Ambient colour pools. Each blob is an independent, blurred
          radial-gradient that drifts on its own transform path, so
          the scene reads as colour MOVING through space rather than
          a background fading/hue-shifting in place. The container
          clips them to the viewport and never intercepts pointers. */}
      <div className="ss-aurora" aria-hidden="true">
        <span className="ss-blob ss-blob-1" />
        <span className="ss-blob ss-blob-2" />
        <span className="ss-blob ss-blob-3" />
        <span className="ss-blob ss-blob-4" />
        <span className="ss-blob ss-blob-5" />
        <span className="ss-blob ss-blob-6" />
      </div>
    </>
  );
}
