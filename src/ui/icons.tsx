// Original line icons, 24×24 grid, 1.75 px stroke, round caps/joins (spec §7.1: our own 1.5–2 px SVGs).
import type { JSX } from 'preact';

/** 8-tooth cog outline, generated once (outer r 9.4, root r 7.2, flat-topped teeth). */
const GEAR = (() => {
  const pts: string[] = [];
  const teeth = 8;
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * Math.PI * 2;
    const step = (Math.PI * 2) / teeth;
    const add = (ang: number, r: number) => pts.push(`${(12 + r * Math.cos(ang)).toFixed(2)} ${(12 + r * Math.sin(ang)).toFixed(2)}`);
    add(a - step * 0.3, 7.2);
    add(a - step * 0.17, 9.4);
    add(a + step * 0.17, 9.4);
    add(a + step * 0.3, 7.2);
  }
  return `M${pts.join('L')}Z`;
})();

const P: Record<string, JSX.Element> = {
  // ── ParamDef.icon keys ──
  smooth: (
    <>
      <path d="M12 3.6c3.4 4.1 5.6 7.2 5.6 10.1a5.6 5.6 0 0 1-11.2 0c0-2.9 2.2-6 5.6-10.1Z" />
      <path d="M9.4 14.6a2.7 2.7 0 0 0 2.4 2.5" />
    </>
  ),
  whiten: (
    <>
      <circle cx="12" cy="12" r="3.6" />
      <path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.4 1.4M16.6 16.6 18 18M6 18l1.4-1.4M16.6 7.4 18 6" />
    </>
  ),
  rosy: (
    <>
      <circle cx="12" cy="12" r="8.2" />
      <path d="M6.9 13.6l1.6-1.6M8.6 15.3l1.6-1.6M13.8 13.6l1.6-1.6M15.5 15.3l1.6-1.6" />
    </>
  ),
  sharpen: (
    <>
      <path d="M12 3.4 19 12l-7 8.6L5 12Z" />
      <path d="M12 3.4v17.2" />
    </>
  ),
  eye: (
    <>
      <path d="M2.8 12c2.4-3.9 5.5-5.8 9.2-5.8s6.8 1.9 9.2 5.8c-2.4 3.9-5.5 5.8-9.2 5.8S5.2 15.9 2.8 12Z" />
      <circle cx="12" cy="12" r="2.9" />
    </>
  ),
  faceSlim: (
    <>
      <path d="M12 3.6c-3.6 0-5.8 2.7-5.8 6.6 0 4.6 2.9 9.4 5.8 9.4s5.8-4.8 5.8-9.4c0-3.9-2.2-6.6-5.8-6.6Z" />
      <path d="M1.8 12.4h2.4m-1.1-1.3 1.2 1.3-1.2 1.3M22.2 12.4h-2.4m1.1-1.3-1.2 1.3 1.2 1.3" />
    </>
  ),
  faceV: (
    <>
      <path d="M5.6 4.2v5.6c0 3.5 2.6 7.5 6.4 10 3.8-2.5 6.4-6.5 6.4-10V4.2" />
      <path d="M9.4 13.4 12 16l2.6-2.6" />
    </>
  ),
  faceNarrow: (
    <>
      <path d="M12 3.6c-3.9 0-6.3 2.8-6.3 6.8 0 4.7 3.1 9.2 6.3 9.2s6.3-4.5 6.3-9.2c0-4-2.4-6.8-6.3-6.8Z" />
      <path d="M8.2 10.2h2.2m-1-1.1 1 1.1-1 1.1M15.8 10.2h-2.2m1-1.1-1 1.1 1 1.1" />
    </>
  ),
  chin: (
    <>
      <path d="M5.4 3.8v3.6c0 4.4 3 8.2 6.6 8.2s6.6-3.8 6.6-8.2V3.8" />
      <path d="M12 17.6v3.6m-1.6-1.8L12 21.2l1.6-1.8M10.4 19.4 12 17.6l1.6 1.8" />
    </>
  ),
  forehead: (
    <>
      <path d="M5.4 20.2v-6.4c0-4.4 3-7.2 6.6-7.2s6.6 2.8 6.6 7.2v6.4" />
      <path d="M12 2.4v3m-1.6-1.4L12 2.4l1.6 1.6" />
      <path d="M8.6 12.6h6.8" />
    </>
  ),
  nose: (
    <>
      <path d="M12.6 4.2c-.3 3.6-1.6 6.5-3.6 9.2" />
      <path d="M7.2 15.8c.6 1.8 2.6 2.4 4.8 2.4s4.2-.6 4.8-2.4c-.4-1.5-1.6-2.2-3-2.2" />
      <path d="M9.4 16.6h.01M14.6 16.6h.01" />
    </>
  ),
  mouth: (
    <>
      <path d="M3.4 12c2.6-3 4.6-4.3 6.2-4.3.9 0 1.6.5 2.4.5s1.5-.5 2.4-.5c1.6 0 3.6 1.3 6.2 4.3-2.4 3.2-5.2 4.7-8.6 4.7s-6.2-1.5-8.6-4.7Z" />
      <path d="M3.4 12h17.2" />
    </>
  ),
  eyeDistance: (
    <>
      <path d="M1.8 9.6c1.3-2 2.8-3 4.4-3s3.1 1 4.4 3c-1.3 2-2.8 3-4.4 3s-3.1-1-4.4-3ZM13.4 9.6c1.3-2 2.8-3 4.4-3s3.1 1 4.4 3c-1.3 2-2.8 3-4.4 3s-3.1-1-4.4-3Z" />
      <path d="M7.6 17.4h8.8m-7.2-1.6-1.6 1.6 1.6 1.6m5.6-3.2 1.6 1.6-1.6 1.6" />
    </>
  ),
  filter: (
    <>
      <circle cx="9" cy="9.4" r="5.4" />
      <circle cx="15" cy="9.4" r="5.4" />
      <circle cx="12" cy="14.6" r="5.4" />
    </>
  ),
  lip: (
    <>
      <path d="M7.4 14.6h9.2v6.4H7.4Z" />
      <path d="M9 14.6V12h6v2.6" />
      <path d="M10.2 12V7.4c0-1.1 1.5-2.7 3.6-3.4V12" />
    </>
  ),
  blush: (
    <>
      <circle cx="12" cy="12" r="8.2" />
      <ellipse cx="8" cy="13.6" rx="1.9" ry="1.2" />
      <ellipse cx="16" cy="13.6" rx="1.9" ry="1.2" />
      <path d="M9.6 9.2h.01M14.4 9.2h.01" />
    </>
  ),
  // ── panel extras ──
  none: (
    <>
      <circle cx="12" cy="12" r="8.2" />
      <path d="m6.2 17.8 11.6-11.6" />
    </>
  ),
  presetNatural: (
    <>
      <path d="M5 19c0-8.2 5.2-13.4 14-14 .4 8.6-4.6 14-12 14Z" />
      <path d="M5 19c2.6-4.2 5.6-7 9.2-9" />
    </>
  ),
  presetRefined: (
    <>
      <path d="M7.4 4.4h9.2L20.4 9 12 19.8 3.6 9Z" />
      <path d="M3.6 9h16.8M9.2 4.4 12 9l2.8-4.6M8.4 9 12 19.8 15.6 9" />
    </>
  ),
  presetGlow: (
    <>
      <path d="M12 3.2c.8 4.6 2.6 6.6 7.6 7.6-5 1-6.8 3-7.6 7.6-.8-4.6-2.6-6.6-7.6-7.6 5-1 6.8-3 7.6-7.6Z" />
      <path d="M18.6 16.4c.3 1.6.9 2.2 2.4 2.5-1.5.3-2.1.9-2.4 2.5-.3-1.6-.9-2.2-2.4-2.5 1.5-.3 2.1-.9 2.4-2.5Z" />
    </>
  ),
  custom: (
    <>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </>
  ),
  // ── chrome ──
  close: <path d="M6.2 6.2 17.8 17.8M17.8 6.2 6.2 17.8" />,
  back: <path d="M14.8 5.4 8.2 12l6.6 6.6" />,
  chevronRight: <path d="m9.6 6 6 6-6 6" />,
  undo: (
    <>
      <path d="M8.6 5.8 4.4 10l4.2 4.2" />
      <path d="M4.4 10h10a5.2 5.2 0 0 1 0 10.4h-3" />
    </>
  ),
  redo: (
    <>
      <path d="M15.4 5.8 19.6 10l-4.2 4.2" />
      <path d="M19.6 10h-10a5.2 5.2 0 0 0 0 10.4h3" />
    </>
  ),
  gear: (
    <>
      <path d={GEAR} />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  flip: (
    <>
      <path d="M3.6 8.6a2 2 0 0 1 2-2h2l1.5-2.1h5.8l1.5 2.1h2a2 2 0 0 1 2 2v9.2a2 2 0 0 1-2 2H5.6a2 2 0 0 1-2-2Z" />
      <path d="M8.9 12.2a3.2 3.2 0 0 1 5.7-1.6M15.1 13.4a3.2 3.2 0 0 1-5.7 1.6" />
      <path d="M14.9 8.9v1.9H13M9.1 16.9V15H11" />
    </>
  ),
  timer: (
    <>
      <circle cx="12" cy="13.2" r="7.4" />
      <path d="M12 9.4v3.8l2.4 1.6M9.6 2.8h4.8M12 2.8v2.4" />
    </>
  ),
  camera: (
    <>
      <path d="M3.4 8.6a2 2 0 0 1 2-2h2.2l1.6-2.2h5.6l1.6 2.2h2.2a2 2 0 0 1 2 2v9.2a2 2 0 0 1-2 2H5.4a2 2 0 0 1-2-2Z" />
      <circle cx="12" cy="12.8" r="3.6" />
    </>
  ),
  aperture: (
    <>
      <circle cx="12" cy="12" r="8.6" />
      <path d="M14.6 3.8 9.8 12.2M20.2 9.8h-9.6M17.6 18.4l-4.8-8.4M9.4 20.2l4.8-8.4M3.8 14.2h9.6M6.4 5.6l4.8 8.4" />
    </>
  ),
  image: (
    <>
      <rect x="3.4" y="4.4" width="17.2" height="15.2" rx="2.4" />
      <circle cx="9" cy="9.8" r="1.6" />
      <path d="m3.8 17.2 4.8-4.6 3.6 3.2 3-2.6 5 4.4" />
    </>
  ),
  compare: (
    <>
      <path d="M12 3v18" />
      <path d="M9.4 5.6H6a2 2 0 0 0-2 2v8.8a2 2 0 0 0 2 2h3.4M14.6 5.6H18a2 2 0 0 1 2 2v8.8a2 2 0 0 1-2 2h-3.4" />
    </>
  ),
  check: <path d="m5 12.6 4.4 4.4L19 7.4" />,
  share: (
    <>
      <path d="M12 3.4v11.2M8 7.2l4-3.8 4 3.8" />
      <path d="M7.6 10.4H6.4a2 2 0 0 0-2 2v6.2a2 2 0 0 0 2 2h11.2a2 2 0 0 0 2-2v-6.2a2 2 0 0 0-2-2h-1.2" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10.6" width="14" height="9.6" rx="2.2" />
      <path d="M8.2 10.6V8a3.8 3.8 0 0 1 7.6 0v2.6" />
    </>
  ),
  plusSquare: (
    <>
      <rect x="4.2" y="4.2" width="15.6" height="15.6" rx="3.6" />
      <path d="M12 8.4v7.2M8.4 12h7.2" />
    </>
  ),
  warning: (
    <>
      <path d="M10.3 4.6 3 17.6a2 2 0 0 0 1.7 3h14.6a2 2 0 0 0 1.7-3L13.7 4.6a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9.6v4.4M12 17.2h.01" />
    </>
  ),
  refresh: (
    <>
      <path d="M19.4 12a7.4 7.4 0 1 1-2.2-5.2" />
      <path d="M19.6 4.4v3.8h-3.8" />
    </>
  ),
  reset: (
    <>
      <path d="M4.6 12a7.4 7.4 0 1 0 2.2-5.2" />
      <path d="M4.4 4.4v3.8h3.8" />
    </>
  ),
  trash: (
    <>
      <path d="M4.8 7h14.4M9.6 7V4.8h4.8V7M6.6 7l.9 12.2a1.8 1.8 0 0 0 1.8 1.6h5.4a1.8 1.8 0 0 0 1.8-1.6L17.4 7" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.6" />
      <path d="M12 11v5.4M12 7.8h.01" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3.2 5 6v5.6c0 4.4 3 7.8 7 9.2 4-1.4 7-4.8 7-9.2V6Z" />
      <path d="m9 12 2.2 2.2L15.4 10" />
    </>
  ),
  download: (
    <>
      <path d="M12 3.8v11M7.8 10.8 12 15l4.2-4.2M4.6 19.8h14.8" />
    </>
  ),
};

export type IconName = keyof typeof P;

export function hasIcon(name: string): boolean {
  return name in P;
}

export function Icon({ name, size = 24, stroke = 1.75, class: cls }: { name: string; size?: number; stroke?: number; class?: string }) {
  return (
    <svg
      class={cls ? `icon ${cls}` : 'icon'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width={stroke}
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {P[name] ?? P.none}
    </svg>
  );
}
