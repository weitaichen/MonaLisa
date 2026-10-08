// App entry: mount the Preact UI and register the service worker (production only; the app must
// also work without one — Lockdown Mode disables SW, RB §1 #12).
import { render } from 'preact';
import { App } from './ui/app';
import { announceUpdate, onNeedRefresh, onNeedReload, onRegisteredSW, setUpdateSW } from './ui/update';
import './ui/theme.css';

const root = document.getElementById('app');
if (root) render(<App />, root);
announceUpdate();

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  // registerType 'prompt': a new version waits until the user taps 更新 (ui/update.ts)
  import('virtual:pwa-register')
    .then(({ registerSW }) => setUpdateSW(registerSW({ immediate: true, onNeedRefresh, onRegisteredSW, onNeedReload })))
    .catch((e: unknown) => console.warn('[meiyan] service worker unavailable', e));
}
