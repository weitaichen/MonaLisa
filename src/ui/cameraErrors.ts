// User-facing copy for camera errors (spec §8). Pure, so it is unit-testable without the screen.
import type { CameraErrorKind } from '../types';

export interface CameraErrorCopy {
  title: string;
  body: string;
  steps?: string[];
  /** shown in the selectable detail block when there is no start error to show */
  detail: string;
}

/** Closing a Home Screen app on every iPhone: Face ID models swipe up and hold, Home-button models double-press. */
const APP_SWITCHER = '打開 App 切換器（多工畫面；從螢幕底部往上滑並停住，有主畫面按鈕的機型請連按兩下主畫面按鈕），把這個 App 往上滑掉';
/** the last resort of a stuck Home Screen camera: the selectable detail holds the bare URL, so copying all of it pastes as one */
const SAFARI_LAST = '還是不行：重新開機，或先長按複製下方網址，再開啟 Safari 貼到網址列';

const COPY: Record<Exclude<CameraErrorKind, 'black' | 'noanswer' | 'noframe'>, { title: string; body: string; steps?: string[] }> = {
  denied: {
    title: '無法使用相機',
    body: '相機權限已被拒絕。',
    steps: ['開啟 iPhone「設定」', '找到 Safari（或此 App）→「相機」', '選擇「允許」，再回來點「重試」'],
  },
  notfound: { title: '找不到相機', body: '這台裝置沒有可用的相機，或相機不支援要求的設定。' },
  insecure: { title: '需要安全連線', body: '相機只能在 HTTPS 網址下使用。請改用 https:// 開頭的網址開啟。' },
  inuse: { title: '相機正在被使用', body: '其他 App 或分頁正在使用相機。請先關閉它，再點「重試」。' },
  unknown: { title: '相機發生錯誤', body: '無法啟動相機，請重試。' },
};

/**
 * `black` is WK 252465 (RB §1 #8c) only in a Home Screen app, where the fix is opening the site in Safari:
 * a standalone app has no address bar, so the URL itself goes in the selectable detail. Anywhere else a
 * black stream means a covered lens or a very dark scene, and the Safari advice would be wrong.
 */
export function cameraErrorCopy(kind: CameraErrorKind, standalone: boolean, origin: string): CameraErrorCopy {
  // Still waiting for getUserMedia (shown under the spinner, the state is 'starting'): the permission prompt first. A
  // request WebKit left unanswered blocks every later one of the page: only closing the app (or another browser) helps.
  if (kind === 'noanswer') {
    const body = '還在等相機回應。如果畫面上有詢問相機權限的視窗，請點「允許」。';
    if (standalone) {
      return {
        title: '相機還沒有回應',
        body,
        steps: [`若一直沒有反應：${APP_SWITCHER}`, '再從主畫面重新開啟', SAFARI_LAST],
        detail: origin,
      };
    }
    return {
      title: '相機還沒有回應',
      body,
      steps: ['若一直沒有反應：關閉這個分頁後重新開啟', '還是不行就重新啟動瀏覽器或裝置'],
      detail: '錯誤代碼：noanswer',
    };
  }
  // Two streams in a row showed no frame (WK 252465 and kin, Home Screen apps only): 重試 once, then close the app;
  // Safari does not have the bug
  if (kind === 'noframe') {
    if (standalone) {
      return {
        title: '收不到相機畫面',
        body: '沒有收到相機畫面。這是主畫面 App 偶爾會遇到的系統問題：',
        steps: ['先點「重試」', `仍然不行：${APP_SWITCHER}，再從主畫面重新開啟`, SAFARI_LAST],
        detail: origin,
      };
    }
    return {
      title: '收不到相機畫面',
      body: '沒有收到相機畫面，這通常是暫時的系統問題：',
      steps: ['先點「重試」', '仍然不行：關閉這個分頁後重新開啟', '還是不行就重新啟動瀏覽器或裝置'],
      detail: '錯誤代碼：noframe',
    };
  }
  if (kind === 'black') {
    if (standalone) {
      return {
        title: '相機畫面全黑',
        body: '沒有收到相機畫面。這可能是主畫面 App 的已知系統問題，可改用 Safari 開啟：',
        steps: ['先確認鏡頭沒有被遮住，再點「重試」', '若仍全黑：開啟 Safari', '在網址列貼上或輸入下方網址', '點「拍攝」並允許相機'],
        detail: `網址：${origin}`,
      };
    }
    return {
      title: '相機畫面全黑',
      body: '沒有收到相機畫面。請確認鏡頭沒有被遮住，或換到較亮的地方，再點「重試」。',
      detail: '錯誤代碼：black',
    };
  }
  return { ...COPY[kind], detail: `錯誤代碼：${kind}` };
}
