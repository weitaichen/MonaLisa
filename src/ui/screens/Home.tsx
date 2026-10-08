// Home 首頁 (spec §7.2.1): 拍攝 / 匯入照片 tiles, 最近編輯 strip, settings, engine chip, install hint.
// Renders without any engine module: every store call is guarded.
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { HistoryEntry } from '../../types';
import { EngineChip } from '../components/EngineChip';
import { IconButton } from '../components/Controls';
import { reportError } from '../debug';
import { deps } from '../deps';
import { openInEditor, pickPhoto } from '../flows';
import { Icon } from '../icons';
import { haptic, isIOS, isStandalone } from '../platform';
import { cameraWasGranted, getCamera } from '../services';
import { app, go, historySettled, setPrefs, toast } from '../state';
import { useStore } from '../store';

/** accessible names: position + last edit time, so VoiceOver can tell the 最近編輯 thumbnails apart */
const stamp = new Intl.DateTimeFormat('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
function whenText(t: number): string {
  try {
    return stamp.format(t);
  } catch {
    return '';
  }
}

export function Home() {
  const prefs = useStore(app, (s) => s.prefs);
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [editing, setEditing] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const reload = () => {
    let p: Promise<HistoryEntry[]>;
    try {
      p = deps.listEntries();
    } catch (e) {
      p = Promise.reject(e);
    }
    p.then(setEntries, (e: unknown) => {
      reportError(e, 'listEntries');
      setEntries([]);
    });
  };
  useEffect(() => {
    // render what is stored now, then again once an editor write still in flight (closing the editor
    // flushes its last edit) has landed; never gate the first read on it
    let alive = true;
    reload();
    historySettled().then(() => {
      if (alive) reload();
    });
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (entries.length === 0) setEditing(false);
  }, [entries.length]);

  const urls = useMemo(() => new Map(entries.map((e) => [e.id, URL.createObjectURL(e.thumb)])), [entries]);
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);

  const shoot = () => {
    haptic();
    // the tile tap is a user gesture: once permission was granted this session, start right here
    if (cameraWasGranted()) {
      try {
        const cam = getCamera();
        if (cam.snapshot.state === 'idle' || cam.snapshot.state === 'error') {
          cam.start(cam.snapshot.facing).catch((e: unknown) => reportError(e, 'camera.start'));
        }
      } catch (e) {
        reportError(e, 'createCamera');
      }
    }
    go({ name: 'camera' });
  };

  const importPhoto = () => {
    haptic();
    pickPhoto((f) => void openInEditor(f, { returnTo: 'home' }));
  };

  const openEntry = async (id: string) => {
    try {
      await historySettled(); // a fast reopen must see the edit the editor just flushed
      const entry = await deps.getEntry(id);
      if (!entry) {
        toast('這筆紀錄已不存在');
        reload();
        return;
      }
      await openInEditor(entry.original, { params: entry.params, historyId: entry.id, body: entry.body, returnTo: 'home' });
    } catch (e) {
      toast(`無法開啟紀錄：${reportError(e, 'getEntry')}`, 4000);
    }
  };

  const remove = async (id: string) => {
    setConfirmId(null);
    setEntries((list) => list.filter((e) => e.id !== id));
    try {
      await deps.deleteEntry(id);
    } catch (e) {
      toast(`刪除失敗：${reportError(e, 'deleteEntry')}`, 4000);
    }
    reload();
  };

  const showHint = isIOS() && !isStandalone() && !prefs.installHintDismissed;

  return (
    <div class="screen home">
      <header class="home-head">
        <div class="wordmark">
          MonaLisa<em>美顏</em>
        </div>
        <IconButton icon="gear" label="設定" onClick={() => app.set({ sheet: 'settings' })} />
      </header>
      <div class="home-sub">即時美顏 · 專業修圖 · 全程在裝置上</div>
      <div class="home-chip-row">
        <EngineChip />
      </div>

      <div class="tiles">
        <button type="button" class="tile primary" onClick={shoot}>
          <TileArt dark />
          <span class="tile-icon">
            <Icon name="camera" size={24} stroke={1.9} />
          </span>
          <span>
            <div class="tile-title">拍攝</div>
            <div class="tile-desc">即時美顏相機</div>
          </span>
        </button>
        <button type="button" class="tile" onClick={importPhoto}>
          <TileArt />
          <span class="tile-icon">
            <Icon name="image" size={24} stroke={1.9} />
          </span>
          <span>
            <div class="tile-title">匯入照片</div>
            <div class="tile-desc">從相簿精修</div>
          </span>
        </button>
      </div>

      <section class="section" aria-label="最近編輯">
        <div class="section-head">
          <div class="section-title">
            最近編輯
            {entries.length > 0 && <span class="section-count num">{entries.length}</span>}
          </div>
          {entries.length > 0 && (
            <button
              type="button"
              class={`text-btn${editing ? '' : ' muted'}`}
              onClick={() => {
                setEditing(!editing);
                setConfirmId(null);
              }}
            >
              {editing ? '完成' : '編輯'}
            </button>
          )}
        </div>
        {entries.length === 0 ? (
          <div class="recent-empty">
            還沒有編輯紀錄
            <br />
            拍攝或匯入照片後會出現在這裡
          </div>
        ) : (
          <div class="recent" role="list">
            {entries.map((e, i) => {
              const nth = `第 ${i + 1} 張`;
              const when = whenText(e.updatedAt);
              const what = when ? `${nth}（${when}）` : nth;
              return (
              <div key={e.id} class={`thumb${editing ? ' editing' : ''}`} role="listitem">
                <button
                  type="button"
                  class="open"
                  aria-label={editing ? `選取${what}以刪除` : `開啟編輯：${nth}${when ? `，${when}` : ''}`}
                  onClick={() => (editing ? setConfirmId(e.id) : void openEntry(e.id))}
                >
                  <img src={urls.get(e.id)} alt="" draggable={false} />
                </button>
                {editing && confirmId !== e.id && (
                  <button type="button" class="thumb-x" aria-label={`刪除${what}`} onClick={() => setConfirmId(e.id)}>
                    <span>
                      <Icon name="close" size={14} stroke={2.4} />
                    </span>
                  </button>
                )}
                {confirmId === e.id && (
                  <div class="thumb-confirm">
                    <button type="button" class="del" aria-label={`確認刪除${nth}`} onClick={() => void remove(e.id)}>
                      刪除
                    </button>
                    <button type="button" class="keep" aria-label="取消刪除" onClick={() => setConfirmId(null)}>
                      取消
                    </button>
                  </div>
                )}
              </div>
              );
            })}
          </div>
        )}
      </section>

      {showHint && (
        <div class="hint-card">
          <span class="hint-icon">
            <Icon name="share" size={20} />
          </span>
          <span class="hint-text">
            <b>加入主畫面，像 App 一樣使用</b>
            點「分享」→「加入主畫面」。安裝後會重新下載一次美顏引擎。
          </span>
          <IconButton icon="close" label="不再顯示" size={18} onClick={() => setPrefs({ installHintDismissed: true })} />
        </div>
      )}

      <footer class="privacy-line">
        <Icon name="lock" size={14} stroke={2} />
        所有影像處理都在你的裝置上完成，照片不會上傳。
      </footer>
    </div>
  );
}

/** Decorative concentric rings, echoing a lens / the app mark. */
function TileArt({ dark }: { dark?: boolean }) {
  const c = dark ? 'rgba(0,0,0,0.13)' : 'rgba(255,255,255,0.06)';
  return (
    <svg class="tile-art" viewBox="0 0 150 150" overflow="visible" aria-hidden="true">
      {[22, 42, 62, 82, 102].map((r) => (
        <circle key={r} cx="75" cy="75" r={r} fill="none" stroke={c} stroke-width="1.5" />
      ))}
    </svg>
  );
}
