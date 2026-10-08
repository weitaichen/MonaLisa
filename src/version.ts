// The app version, single source: package.json "version", injected at build time as __APP_VERSION__
// (vite.config.ts `define`; vitest.config.ts mirrors it). Shown in 設定 and compared with /version.json
// when a new service worker is waiting.

/** e.g. "0.2.0" */
export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0';

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

/** true for a plain x.y.z version (what package.json and /version.json carry) */
export function isVersion(v: unknown): v is string {
  return typeof v === 'string' && SEMVER.test(v);
}

/** "0.2.0" → "v0.2", "0.2.1" → "v0.2.1"; anything else is shown as-is with a "v" prefix. */
export function displayVersion(v: string): string {
  const m = SEMVER.exec(v);
  if (!m) return `v${v}`;
  const [, major, minor, patch] = m;
  return Number(patch) === 0 ? `v${Number(major)}.${Number(minor)}` : `v${Number(major)}.${Number(minor)}.${Number(patch)}`;
}
