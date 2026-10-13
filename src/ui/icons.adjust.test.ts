import { describe, expect, it, vi } from 'vitest';
import { paramsInGroup } from '../engine/params';
import { hasIcon } from './icons';
import { PRESET_PARTS } from './panelModel';

describe('調節 and 質感 visuals (step-2 spec §2.5, §7)', () => {
  it('every 調節 item, both 一鍵 parts and the look thumbnail fallback have an icon', () => {
    for (const d of paramsInGroup('adjust')) expect(hasIcon(d.icon), d.icon).toBe(true);
    for (const p of PRESET_PARTS) expect(hasIcon(p.icon), p.icon).toBe(true);
    expect(hasIcon('look')).toBe(true);
  });

  it('調節 and 一鍵 are never dimmed by the face note (基本模式, no face)', async () => {
    // BeautyPanel imports the app store: stub the browser globals first, as flows.test.ts does
    vi.stubGlobal('window', { setTimeout, clearTimeout });
    vi.stubGlobal('document', { createElement: () => ({ className: '', addEventListener: vi.fn() }) });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { FACE_TABS } = await import('./components/BeautyPanel');
    expect(FACE_TABS).not.toContain('adjust');
    expect(FACE_TABS).not.toContain('preset');
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
});
