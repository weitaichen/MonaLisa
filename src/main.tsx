// App entry: mount the Preact UI and register the service worker (production only; the app must
// also work without one — Lockdown Mode disables SW, RB §1 #12).
import { render } from 'preact';
import { App } from './ui/app';
import './ui/theme.css';

const root = document.getElementById('app');
if (root) render(<App />, root);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  import('virtual:pwa-register')
    .then(({ registerSW }) => registerSW({ immediate: true }))
    .catch((e: unknown) => console.warn('[meiyan] service worker unavailable', e));
}
