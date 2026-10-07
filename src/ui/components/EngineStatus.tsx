// Overlay for engine states that block a screen: loading (with download progress), errors with
// retry / 基本模式 (spec §8), WebGL2 missing, and a lost WebGL context.
import { reportError } from '../debug';
import { ensureEngine, recoverEngine, svc } from '../services';
import { useStore } from '../store';
import { progressFraction, progressText } from '../format';
import { Status } from './Status';

const STEP_TEXT = { engine: '正在啟動繪圖引擎…', tracker: '正在啟動臉部偵測…' } as const;

/** Renders nothing when the engine is ready (or idle) and the context is healthy. */
export function EngineStatus() {
  const engine = useStore(svc, (s) => s.engine);
  const assets = useStore(svc, (s) => s.assets);
  const lost = useStore(svc, (s) => s.lost);

  const retry = (basic: boolean) => ensureEngine(basic).catch((e: unknown) => reportError(e, 'ensureEngine'));

  if (engine.state === 'unsupported') {
    return (
      <Status icon="warning" tone="danger" title="此裝置不支援 WebGL2" body="美顏引擎需要 WebGL2。請更新 iOS 或改用較新的瀏覽器。" />
    );
  }
  if (engine.state === 'error') {
    return (
      <Status icon="warning" tone="danger" title="美顏引擎無法啟動" body={engine.canBasic ? '可以重試；若網路不穩，也可改用基本模式（僅美膚與濾鏡）。' : '請重試；若持續發生，請重新開啟 App。'}
        detail={engine.message}>
        <button type="button" class="btn primary" onClick={() => retry(false)}>
          重試
        </button>
        {engine.canBasic && (
          <button type="button" class="btn" onClick={() => retry(true)}>
            使用基本模式
          </button>
        )}
      </Status>
    );
  }
  if (engine.state === 'loading') {
    if (engine.step === 'assets') {
      const p = assets.state === 'loading' ? assets.progress : null;
      const f = progressFraction(p);
      return (
        <Status
          spinner
          title="正在準備美顏引擎"
          body="首次使用需下載約 6–8 MB，之後可離線使用。"
          progress={f ?? 'indeterminate'}
          meta={progressText(p)}
        />
      );
    }
    return <Status spinner title={STEP_TEXT[engine.step]} />;
  }
  if (lost) {
    return (
      <Status spinner scrim title="正在恢復畫面…" body="繪圖資源被系統暫時收回。若畫面沒有恢復，請點下方按鈕。">
        <button type="button" class="btn" onClick={recoverEngine}>
          重新載入引擎
        </button>
      </Status>
    );
  }
  return null;
}
