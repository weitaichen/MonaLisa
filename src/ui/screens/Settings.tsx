// Settings 設定 bottom sheet (spec §7.2.5) with the 關於與授權 credits page (spec §11).
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Prefs } from '../../types';
import { IconButton, Segmented, ToggleRow } from '../components/Controls';
import { reportError } from '../debug';
import { Icon } from '../icons';
import { restartTracker } from '../services';
import { app, setPrefs } from '../state';
import { useStore } from '../store';

const TIER_OPTIONS = [
  { value: 'auto', label: '自動' },
  { value: 'H', label: '高' },
  { value: 'M', label: '中' },
  { value: 'L', label: '低' },
] as const;

const DELEGATE_OPTIONS = [
  { value: 'auto', label: '自動（GPU）' },
  { value: 'CPU', label: 'CPU' },
] as const;

export const PRIVACY_TEXT = '所有影像處理都在你的裝置上完成，照片不會上傳。';

export function SettingsSheet() {
  const sheet = useStore(app, (s) => s.sheet);
  const prefs = useStore(app, (s) => s.prefs);
  const dlg = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const open = !!sheet;

  // remember what opened the sheet; give focus back to it on close
  useEffect(() => {
    if (!open) return;
    const a = document.activeElement;
    opener.current = a instanceof HTMLElement && a !== document.body ? a : null;
    return () => {
      const o = opener.current;
      opener.current = null;
      if (o?.isConnected) o.focus({ preventScroll: true });
    };
  }, [open]);

  // aria-modal: VoiceOver / keyboard start inside the dialog (it carries the page's label), also after a
  // page switch unmounts the row that had focus
  useEffect(() => {
    if (sheet) dlg.current?.focus({ preventScroll: true });
  }, [sheet]);

  useEffect(() => {
    if (!sheet) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      app.set({ sheet: null });
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [sheet]);

  if (!sheet) return null;
  const close = () => app.set({ sheet: null });
  const credits = sheet === 'credits';

  return (
    <>
      <div class="sheet-backdrop" onClick={close} />
      <div class="sheet" role="dialog" aria-modal="true" aria-label={credits ? '關於與授權' : '設定'} ref={dlg} tabIndex={-1}>
        <div class="sheet-grabber" />
        <div class="sheet-head">
          {credits ? <IconButton icon="back" label="返回設定" onClick={() => app.set({ sheet: 'settings' })} /> : <span style={{ width: 44 }} />}
          <div class="sheet-title">{credits ? '關於與授權' : '設定'}</div>
          <button type="button" class="text-btn" onClick={close}>
            完成
          </button>
        </div>
        {/* keyed per page: each page gets its own scroller, starting at the top */}
        <div class="sheet-body" key={sheet}>
          {credits ? <Credits /> : <SettingsBody prefs={prefs} />}
        </div>
      </div>
    </>
  );
}

function SettingsBody({ prefs }: { prefs: Prefs }) {
  return (
    <>
      <div class="group-label">拍攝</div>
      <div class="group">
        <ToggleRow
          title="儲存時鏡像"
          sub="前鏡頭照片與預覽畫面方向一致"
          on={prefs.mirrorOnSave}
          onChange={(on) => setPrefs({ mirrorOnSave: on })}
        />
      </div>

      <div class="group-label">效能</div>
      <div class="group">
        <div class="row stack">
          <div class="row-text">
            <div class="row-title">畫質</div>
            <div class="row-sub">自動會在畫面不順時降低預覽解析度</div>
          </div>
          <Segmented label="畫質" value={prefs.tier} options={TIER_OPTIONS} onChange={(tier) => setPrefs({ tier })} />
        </div>
        <div class="row stack">
          <div class="row-text">
            <div class="row-title">偵測器</div>
            <div class="row-sub">臉部偵測不穩定時可改用 CPU</div>
          </div>
          <Segmented
            label="偵測器"
            value={prefs.delegate}
            options={DELEGATE_OPTIONS}
            onChange={(delegate) => {
              setPrefs({ delegate });
              restartTracker().catch((e: unknown) => reportError(e, 'restartTracker'));
            }}
          />
        </div>
      </div>

      <div class="group-label">進階</div>
      <div class="group">
        <ToggleRow
          title="對齊 GPUPixel 原始效果"
          sub="停用臉部遮罩，磨皮套用到整張畫面"
          on={prefs.matchGpupixel}
          onChange={(on) => setPrefs({ matchGpupixel: on })}
        />
        <ToggleRow
          title="顯示臉部特徵點"
          sub="除錯用：在畫面上標出偵測到的特徵點"
          on={prefs.showLandmarks}
          onChange={(on) => setPrefs({ showLandmarks: on })}
        />
      </div>

      <div class="group-label">關於</div>
      <div class="group">
        <button type="button" class="row" onClick={() => app.set({ sheet: 'credits' })}>
          <span class="row-text">
            <span class="row-title">關於與授權</span>
          </span>
          <Icon name="chevronRight" size={18} class="chev" />
        </button>
        <div class="privacy-card">
          <Icon name="shield" size={20} />
          <span>
            <b style={{ color: '#fff', fontWeight: 600 }}>隱私</b>
            <br />
            {PRIVACY_TEXT}沒有帳號、沒有追蹤、沒有雲端。
          </span>
        </div>
      </div>
      <div class="sheet-foot">MonaLisa 美顏 · v0.1</div>
    </>
  );
}

interface Credit {
  name: string;
  license: string;
  body: string;
  /** LICENSES/<file> holding the full license text, shown in the sheet */
  text: string;
}

// The license texts ship inside the app (a lazy JS chunk, so the service worker precaches it): the
// deployed site has no project folder to point at, and a link to a .txt would be a navigation the SW
// answers with the app shell, which also strands the user in an iOS standalone app.
const LICENSE_TEXTS = import.meta.glob<string>('/LICENSES/*.txt', { query: '?raw', import: 'default' });

function loadLicense(file: string): Promise<string> {
  const load = LICENSE_TEXTS[`/LICENSES/${file}`];
  return load ? load() : Promise.reject(new Error(`license text missing: ${file}`));
}

export const CREDITS: readonly Credit[] = [
  {
    name: 'GPUPixel',
    license: 'Apache-2.0',
    body: '© 2021 PixPark。美膚、臉型與美妝著色器移植自 GPUPixel（WebGL2 改寫並修改）；並使用其素材 lookup_gray、lookup_origin、lookup_skin、lookup_light、mouth（口紅）與 blusher（腮紅）圖檔；另由 mouth、blusher 衍生 lip_mask、blush_mask 遮罩（修改：取 1−min(G,B) 轉為單色並拉伸至 0..1，腮紅另加 σ1.5 模糊，重新編碼為不含色彩區塊的 PNG）。',
    text: 'GPUPixel-Apache-2.0.txt',
  },
  {
    name: 'GPUImage',
    license: 'BSD-3-Clause',
    body: 'Copyright (c) 2012, Brad Larson, Ben Cochran, Hugues Lismonde, Keitaroh Kobayashi, Alaric Cole, Matthew Clark, Jacob Gundersen, Chris Williams. 方框模糊的取樣位移演算法源自 GPUImage。授權條件與免責聲明全文見下方。',
    text: 'GPUImage-BSD-3-Clause.txt',
  },
  {
    name: 'GPUImage-x',
    license: 'Apache-2.0',
    body: '© 2017 Yijin Wang, Yiqian Wang。GPUPixel 濾鏡架構的前身。',
    text: 'GPUPixel-Apache-2.0.txt',
  },
  {
    name: 'CainCamera',
    license: 'Apache-2.0',
    body: '© 2018 cain.huang。美顏、臉型變形與美妝方案的源流（curveWarp / enlargeEye、111 點延伸）。',
    text: 'GPUPixel-Apache-2.0.txt',
  },
  {
    name: 'MediaPipe Tasks Vision · Face Landmarker',
    license: 'Apache-2.0',
    body: '© Google LLC。臉部特徵點偵測，使用 0.10.35 版與 Face Mesh V2 模型，全部在裝置上執行。',
    text: 'MediaPipe-Apache-2.0.txt',
  },
  {
    name: 'Preact',
    license: 'MIT',
    body: '© 2015-present Jason Miller。介面框架。',
    text: 'Preact-MIT.txt',
  },
  {
    name: 'Workbox',
    license: 'MIT',
    body: '© 2018 Google LLC。Service Worker 離線快取（sw.js 與 workbox 模組）。',
    text: 'Workbox-MIT.txt',
  },
  {
    name: 'vite-plugin-pwa',
    license: 'MIT',
    body: '© 2020-present Anthony Fu。Service Worker 註冊程式。',
    text: 'vite-plugin-pwa-MIT.txt',
  },
];

function Credits() {
  return (
    <>
      <div class="group-label">開放原始碼</div>
      <div class="group">
        {CREDITS.map((c) => (
          <div class="credit" key={c.name}>
            <div class="credit-name">
              {c.name}
              <span class="credit-lic">{c.license}</span>
            </div>
            <div class="credit-body">{c.body}</div>
            <LicenseText file={c.text} />
          </div>
        ))}
      </div>
      <p class="credits-note">
        參數設計參考公開的 SDK 文件（PixelFree、FaceUnity FULiveDemo、阿里雲 Queen SDK），未使用其任何程式碼或素材。濾鏡
        LUT、色號與圖示為本專案原創；口紅與腮紅的單色遮罩（lip_mask、blush_mask）由 GPUPixel 的 mouth、blusher
        圖檔經程式轉換而成，屬修改後的衍生素材。各元件的完整授權條款可於上方展開檢視。
      </p>
      <div class="group credit-notice">
        <LicenseText file="NOTICE.txt" summary="第三方聲明（NOTICE）" />
      </div>
      <p class="credits-note">{PRIVACY_TEXT}</p>
    </>
  );
}

/** Expandable full license text, loaded on first open. */
function LicenseText({ file, summary = '授權條款全文' }: { file: string; summary?: string }) {
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const onToggle = (e: Event) => {
    if (!(e.currentTarget as HTMLDetailsElement).open || text !== null) return;
    loadLicense(file).then(setText, (err: unknown) => {
      reportError(err, `license ${file}`);
      setFailed(true);
    });
  };
  return (
    <details class="credit-license" onToggle={onToggle}>
      <summary>{summary}</summary>
      <pre>{text ?? (failed ? '無法載入授權條款。' : '載入中…')}</pre>
    </details>
  );
}
