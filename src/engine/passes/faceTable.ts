// The face table's layout (S §4.4, face-detail spec §4.4): texel offsets inside a face's 96-texel row. A leaf module:
// reshape.ts builds RESHAPE_FS's text from it at load time and packs the step-5 block (packFaceDetail, detailMask), and
// faceCap.ts packs the rest of each row. Every texel is in use:
//   0–55 PTS (pts111 pairs) · 56–59 EXT · 60–62 VT · 63–64 NT · 65 CHIN_EYE · 66 S1 · 67 S2 · 68 RADII · 69 PROT
//   70 RIGHT, 71 RIGHT2 (step 5: the 左右分開 right-side strengths) · 72 BOX · 73 CAP · 74 WIN (step 1)
//   75–95 step 5: S5, S6 (strengths), JT ×5, TA ×3, TT ×3 (下頜線 targets, 太陽穴 anchors and targets, pairs), AXES,
//   HAIR_R, HAIR_MOUTH_DISP, MOUTH_R, MOUTH_AXIS, WING, ROOT, ROOT_RY
export const FT = {
  ROW: 96,
  PTS: 0,
  EXT: 56,
  VT: 60,
  NT: 63,
  CHIN_EYE: 65,
  S1: 66,
  S2: 67,
  RADII: 68,
  PROT: 69,
  /** right side (GPUPixel-right): slimR, vR, narrowR, eyeR */
  RIGHT: 70,
  /** right side: jawlineR, templeR */
  RIGHT2: 71,
  BOX: 72,
  CAP: 73,
  WIN: 74,
  /** 下頜線 and 太陽穴 strengths (GPUPixel-left), 髮際線 and 鼻翼 effective strengths */
  S5: 75,
  /** 山根 k, 嘴高 effective strength */
  S6: 76,
  /** 下頜線 targets: 10 × vec2 in JAW order, texels 77–81 */
  JT: 77,
  /** 太陽穴 anchors: 6 × vec2 in TEMPLE order, texels 82–84 */
  TA: 82,
  /** 太陽穴 targets: 6 × vec2 in TEMPLE order, texels 85–87 */
  TT: 85,
  /** iso unit axes r̂ (xy) and m̂ (zw); read only by 髮際線 and 山根 */
  AXES: 88,
  /** 髮際線 radii (rx, ry↑, ry↓), iso */
  HAIR_R: 89,
  /** 髮際線 disp (xy) and 嘴高 disp (zw), UV */
  HAIR_MOUTH_DISP: 90,
  /** 嘴高 radii (rx, ry↑, ry↓), iso */
  MOUTH_R: 91,
  /** 嘴高 axis ay (xy, iso, toward the chin side) */
  MOUTH_AXIS: 92,
  /** 鼻翼: disc radius (x, iso), the left wing's disp (yz, UV; the right gets −) */
  WING: 93,
  /** 山根: band centre (xy, UV), r− and r+ (zw, iso) */
  ROOT: 94,
  /** 山根: band half-height (x, iso) */
  ROOT_RY: 95,
} as const;

/** the entries that take more than one texel, and how many (every other entry takes one) */
export const FT_SPAN: Partial<Record<keyof typeof FT, number>> = { PTS: 56, EXT: 4, VT: 3, NT: 2, JT: 5, TA: 3, TT: 3 };
