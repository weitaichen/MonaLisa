// Root component: one screen at a time (no router), plus global overlays.
import { useEffect, useRef, useState } from 'preact/hooks';
import { Status } from './components/Status';
import { UpdateBanner } from './components/UpdateBanner';
import { Icon } from './icons';
import { Camera } from './screens/Camera';
import { Editor } from './screens/Editor';
import { Home } from './screens/Home';
import { Review } from './screens/Review';
import { SettingsSheet } from './screens/Settings';
import { applyPrefsToEngine, bindPrefs, prefetchWhenIdle, svc, webgl2Supported } from './services';
import { app, closeSaveFallback } from './state';
import { useStore } from './store';

bindPrefs(() => app.get().prefs);

export function App() {
  // probed once: the check may create a throwaway WebGL context
  const [webgl2] = useState(webgl2Supported);
  const screen = useStore(app, (s) => s.screen);

  useEffect(() => {
    if (webgl2) prefetchWhenIdle();
    // keep engine options in sync with prefs (and push them once the engine exists)
    let last = app.get().prefs;
    const offPrefs = app.subscribe((s) => {
      if (s.prefs === last) return;
      last = s.prefs;
      applyPrefsToEngine(s.prefs);
    });
    let wasReady = false;
    const offSvc = svc.subscribe((s) => {
      const ready = s.engine.state === 'ready';
      if (ready && !wasReady) applyPrefsToEngine(app.get().prefs);
      wasReady = ready;
    });
    return () => {
      offPrefs();
      offSvc();
    };
  }, [webgl2]);

  if (!webgl2) {
    return (
      <div class="screen">
        <Status icon="warning" tone="danger" title="此裝置不支援 WebGL2" body="MonaLisa 美顏需要 WebGL2 才能處理影像。請更新 iOS，或改用較新的瀏覽器開啟。" />
      </div>
    );
  }

  return (
    <>
      {screen.name === 'home' && <Home />}
      {screen.name === 'camera' && <Camera />}
      {screen.name === 'review' && <Review key={screen.shot.image} shot={screen.shot} />}
      {screen.name === 'editor' && <Editor key={screen.source.bitmap} source={screen.source} />}
      <UpdateBanner place="home" />
      <SettingsSheet />
      <Busy />
      <Toast />
      <SaveFallback />
    </>
  );
}

function Toast() {
  const toast = useStore(app, (s) => s.toast);
  if (!toast) return null;
  return (
    <div class="toast" key={toast.id} role="status" aria-live="polite">
      {toast.text}
    </div>
  );
}

function Busy() {
  const busy = useStore(app, (s) => s.busy);
  if (!busy) return null;
  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 30 }}>
      <Status spinner scrim title={busy} />
    </div>
  );
}

/** Share sheet unavailable → long-press the image to save (RB §4 "Capture and save"). */
function SaveFallback() {
  const url = useStore(app, (s) => s.saveFallback);
  const dlg = useRef<HTMLDivElement>(null);
  // aria-modal: start VoiceOver / keyboard focus inside the dialog
  useEffect(() => {
    if (url) dlg.current?.focus({ preventScroll: true });
  }, [url]);
  if (!url) return null;
  return (
    <div class="fallback" role="dialog" aria-modal="true" aria-label="儲存照片" ref={dlg} tabIndex={-1}>
      <div class="topbar">
        <button type="button" class="icon-btn" aria-label="關閉" onClick={closeSaveFallback}>
          <Icon name="close" />
        </button>
        <span />
        <span style={{ width: 44 }} />
      </div>
      <div class="fallback-img">
        <img src={url} alt="編輯結果" />
      </div>
      <div class="fallback-hint">
        <b>長按圖片 → 儲存到照片</b>
        <span>這個瀏覽器無法直接開啟分享選單</span>
      </div>
    </div>
  );
}
