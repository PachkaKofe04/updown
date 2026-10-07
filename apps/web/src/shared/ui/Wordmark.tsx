/** Знак направления: одна сетка и те же пропорции, что у стрелок интерфейса. */
export function Wordmark() {
  return (
    <span className="wordmark" aria-label="UpDown">
      <svg className="wordmark-emblem" width="27" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
        <path d="M8 22V6m-4 4 4-4 4 4M20 6v16m-4-4 4 4 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="wordmark-name">UPDOWN</span>
    </span>
  );
}
