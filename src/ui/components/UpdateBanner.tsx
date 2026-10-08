// 有新版本 banner: floating above 首頁, or as the first group of 設定 (updateModel.bannerPlace decides).
import { APP_VERSION, displayVersion } from '../../version';
import { Icon } from '../icons';
import { app } from '../state';
import { useStore } from '../store';
import { applyUpdate, dismissUpdate, updates } from '../update';
import { bannerPlace, bannerTitle, type BannerPlace } from '../updateModel';

export function useUpdatePlace(): BannerPlace {
  const u = useStore(updates, (s) => s);
  const screen = useStore(app, (s) => s.screen.name);
  const sheet = useStore(app, (s) => s.sheet);
  return bannerPlace(u, screen, sheet);
}

export function UpdateBanner({ place }: { place: Exclude<BannerPlace, null> }) {
  const u = useStore(updates, (s) => s);
  const shown = useUpdatePlace() === place;
  const applying = u.phase === 'applying';
  // the live region stays mounted so VoiceOver announces the card when it appears
  return (
    <div class={`update-live ${place}`} aria-live="polite">
      {shown && (
        <div class="update-card" role="group" aria-label="App 更新">
          <span class="update-icon" aria-hidden="true">
            <Icon name="refresh" size={20} stroke={2} />
          </span>
          <span class="update-text">
            <b>{bannerTitle(u)}</b>
            目前 {displayVersion(APP_VERSION)}
          </span>
          <button type="button" class="text-btn muted" disabled={applying} onClick={dismissUpdate}>
            稍後
          </button>
          <button type="button" class="pill" disabled={applying} onClick={() => void applyUpdate()}>
            <span>更新</span>
          </button>
        </div>
      )}
    </div>
  );
}
