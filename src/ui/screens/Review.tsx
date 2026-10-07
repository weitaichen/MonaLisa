// Review 預覽 (spec §7.2.3): the captured result; 重拍 · 編輯 · 儲存. The JPEG is encoded right after
// capture so 儲存 can call the share sheet synchronously inside the tap (RB §1 #10).
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { errorText, reportError } from '../debug';
import { deps } from '../deps';
import { Icon } from '../icons';
import { haptic } from '../platform';
import { go, showSaveFallback, toast, type Shot } from '../state';

export function Review({ shot }: { shot: Shot }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [encodeErr, setEncodeErr] = useState<string | null>(null);
  const handedOff = useRef(false);

  useLayoutEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    c.width = shot.image.width;
    c.height = shot.image.height;
    c.getContext('2d')?.putImageData(shot.image, 0, 0);
  }, [shot]);

  useEffect(() => {
    let alive = true;
    shot.file.then(
      (f) => alive && setFile(f),
      (e: unknown) => alive && setEncodeErr(errorText(e)),
    );
    return () => {
      alive = false;
    };
  }, [shot]);

  // the unprocessed frame is ours unless it was handed to the editor
  useEffect(
    () => () => {
      if (!handedOff.current) shot.original?.close();
    },
    [shot],
  );

  const save = () => {
    if (!file) {
      if (encodeErr) {
        setEncodeErr(null);
        let p: Promise<File>;
        try {
          p = deps.encodeJpeg(shot.image, 0.92);
        } catch (e) {
          p = Promise.reject(e);
        }
        p.then(setFile, (e: unknown) => {
          setEncodeErr(reportError(e, 'encodeJpeg'));
          toast(`無法編碼照片：${errorText(e)}`, 4000);
        });
      }
      return;
    }
    // no await before this call: the share sheet needs the tap's transient activation
    let p: Promise<string>;
    try {
      p = deps.saveFile(file);
    } catch (e) {
      p = Promise.reject(e);
    }
    p.then(
      (r) => {
        if (r === 'fallback') showSaveFallback(file);
        else if (r === 'shared') toast('完成');
      },
      (e: unknown) => {
        reportError(e, 'saveFile');
        showSaveFallback(file);
      },
    );
  };

  const retake = () => {
    haptic();
    go({ name: 'camera' });
  };

  const edit = () => {
    haptic();
    if (!shot.original) {
      toast('無法取得原始畫面，請重新拍攝');
      return;
    }
    handedOff.current = true;
    go({ name: 'editor', source: { bitmap: shot.original, params: shot.params, historyId: null, returnTo: 'camera' } });
  };

  const busy = !file && !encodeErr;
  return (
    <div class="screen review">
      <div class="topbar">
        <span style={{ width: 44 }} />
        <div class="topbar-center" style={{ fontSize: 15, fontWeight: 650 }}>
          預覽
        </div>
        <span style={{ width: 44 }} />
      </div>
      <div class="stage review-stage">
        <canvas ref={canvasRef} aria-label="拍攝結果" />
        {encodeErr && <span class="badge error">照片編碼失敗：{encodeErr}</span>}
      </div>
      <div class="review-bar">
        <button type="button" class="side-btn" onClick={retake}>
          <span class="side-icon">
            <Icon name="refresh" size={22} />
          </span>
          重拍
        </button>
        <button type="button" class={`save-btn${busy ? ' busy' : ''}`} onClick={save} aria-busy={busy}>
          {busy ? <div class="spinner" style={{ width: 22, height: 22 }} /> : <Icon name="download" size={24} stroke={2.2} />}
          {busy ? '準備中' : encodeErr ? '重試' : '儲存'}
        </button>
        <button type="button" class="side-btn" onClick={edit} disabled={!shot.original}>
          <span class="side-icon">
            <Icon name="custom" size={22} />
          </span>
          編輯
        </button>
      </div>
    </div>
  );
}
