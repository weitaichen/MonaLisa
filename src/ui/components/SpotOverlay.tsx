// 祛痘 tap feedback (skin-cleanup spec §2.3): a 1.5 px accent ring at the finger with the spot's on-screen radius, inside
// .zoom-layer (its stroke divided by the zoom scale --zs), scaling 1.15 → 1 and fading out over 350 ms. Visual only.
export interface SpotRing {
  id: number;
  /** layer-normalized centre */
  x: number;
  y: number;
  /** radius as a fraction of the layer width */
  r: number;
}

export function SpotOverlay({ rings }: { rings: readonly SpotRing[] }) {
  return (
    <div class="spot-overlay" aria-hidden="true">
      {rings.map((g) => (
        <i key={g.id} class="spot-ring" style={{ left: `${g.x * 100}%`, top: `${g.y * 100}%`, width: `${g.r * 200}%` }} />
      ))}
    </div>
  );
}
