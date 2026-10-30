// Clip 預覽 (beauty video spec §4.5): the recording plays back on a loop; 重錄 · 儲存. The file exists already when
// the screen opens, so 儲存 calls the share sheet synchronously inside the tap (RB §1 #10) through shareFile, as Review
// does. No 編輯.
import { useEffect } from 'preact/hooks';
import { shareFile } from '../flows';
import { Icon } from '../icons';
import { haptic } from '../platform';
import { go, type Clip } from '../state';

export function ClipReview({ clip }: { clip: Clip }) {
  // the screen owns the clip's object URL (the camera made it): nothing keeps the Blob alive once it goes
  useEffect(() => () => URL.revokeObjectURL(clip.url), [clip.url]);

  // no await before this call: the share sheet needs the tap's transient activation
  const save = () => shareFile(clip.file);

  const retake = () => {
    haptic();
    go({ name: 'camera' });
  };

  return (
    <div class="screen review">
      <div class="topbar">
        <span style={{ width: 44 }} />
        <div class="topbar-center" style={{ fontSize: 15, fontWeight: 650 }}>
          預覽
        </div>
        <span style={{ width: 44 }} />
      </div>
      <div class="stage review-stage clip-stage">
        {/* muted lets it autoplay; the controls let the person unmute */}
        <video src={clip.url} playsInline loop autoPlay muted controls aria-label="錄影結果" />
      </div>
      <div class="review-bar">
        <button type="button" class="side-btn" onClick={retake}>
          <span class="side-icon">
            <Icon name="refresh" size={22} />
          </span>
          重錄
        </button>
        <button type="button" class="save-btn" onClick={save}>
          <Icon name="download" size={24} stroke={2.2} />
          儲存
        </button>
        {/* the third column stays empty so 儲存 is centred as on Review */}
        <span />
      </div>
    </div>
  );
}
