import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { APP_VERSION, displayVersion, isVersion } from './version';

describe('version', () => {
  it('APP_VERSION is package.json "version"', () => {
    const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, '../package.json'), 'utf8')) as { version: string };
    expect(APP_VERSION).toBe(pkg.version);
    // a plain x.y.z, so the 設定 footer shows e.g. v0.2 (not pinned: a version bump must not need a test edit)
    expect(isVersion(APP_VERSION)).toBe(true);
  });

  it('displayVersion drops a zero patch', () => {
    expect(displayVersion('0.2.0')).toBe('v0.2');
    expect(displayVersion('0.2.1')).toBe('v0.2.1');
    expect(displayVersion('1.0.0')).toBe('v1.0');
    expect(displayVersion('1.10.0')).toBe('v1.10');
    expect(displayVersion('2.3.10')).toBe('v2.3.10');
  });

  it('displayVersion shows anything else as-is', () => {
    expect(displayVersion('0.3.0-beta.1')).toBe('v0.3.0-beta.1');
    expect(displayVersion('dev')).toBe('vdev');
  });

  it('isVersion accepts only x.y.z', () => {
    expect(isVersion('0.2.1')).toBe(true);
    for (const v of ['0.2', 'v0.2.1', '0.2.1-rc', '', ' 0.2.1', null, undefined, 21, { version: '0.2.1' }]) {
      expect(isVersion(v), String(v)).toBe(false);
    }
  });
});
