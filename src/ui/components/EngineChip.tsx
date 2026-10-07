// Engine-download progress chip (spec §7.2 Home). Model ≈ 3.7 MB + wasm warm-up
// (≈ 6–8 MB over the wire in total, RB row 14 / risk 11).
import { useEffect, useRef, useState } from 'preact/hooks';
import { progressFraction, progressText } from '../format';
import { Icon } from '../icons';
import { prefetchAssets, svc } from '../services';
import { useStore } from '../store';

function Ring({ fraction }: { fraction: number | null }) {
  const r = 7;
  const c = 2 * Math.PI * r;
  return (
    <svg class={`ring${fraction === null ? ' spin' : ''}`} width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <circle class="bg" cx="9" cy="9" r={r} />
      <circle class="fg" cx="9" cy="9" r={r} stroke-dasharray={c} stroke-dashoffset={c * (1 - (fraction ?? 0.28))} />
    </svg>
  );
}

export function EngineChip() {
  const assets = useStore(svc, (s) => s.assets);
  const [showDone, setShowDone] = useState(false);
  // announce "ready" only for a download finishing while this chip is on screen
  const prev = useRef(assets.state);
  useEffect(() => {
    const was = prev.current;
    prev.current = assets.state;
    if (assets.state !== 'done' || was === 'done') return;
    setShowDone(true);
    const t = window.setTimeout(() => setShowDone(false), 2600);
    return () => clearTimeout(t);
  }, [assets.state]);

  if (assets.state === 'loading') {
    return (
      <div class="engine-chip num" role="status" aria-live="polite">
        <Ring fraction={progressFraction(assets.progress)} />
        {progressText(assets.progress)}
      </div>
    );
  }
  if (assets.state === 'error') {
    return (
      <>
        <div class="engine-chip error" role="alert">
          <Icon name="warning" size={16} />
          引擎下載失敗
          <button type="button" class="retry" onClick={() => prefetchAssets().catch(() => undefined)}>
            重試
          </button>
        </div>
        <div class="chip-detail">
          {assets.hint}
          <span class="chip-raw">{assets.message}</span>
        </div>
      </>
    );
  }
  if (assets.state === 'done' && showDone) {
    return (
      <div class="engine-chip done" role="status">
        <Icon name="check" size={16} stroke={2.2} />
        美顏引擎已就緒
      </div>
    );
  }
  return null;
}
