// 膚質 copy, 繁體中文, verbatim from skin-cleanup spec §2.4 and C §2.6. Shared by the lens, the panel and the editor.
export const TONE_COPY = {
  noFace: '未偵測到臉部，膚質工具不會套用',
  basic: '基本模式不支援膚質工具',
  recovering: '臉部偵測重新啟動中，膚質工具暫不套用',
  paused: '臉部偵測暫停，膚質工具暫不套用',
  failed: '臉部偵測失敗，膚質工具暫不套用',
  mouthClosed: '嘴巴閉合時看不到牙齒，白牙效果不明顯',
  eyesClosed: '閉眼時亮眼效果不明顯',
  spotHint: '點一下痘痘或瑕疵即可去除',
  spotSize: '大小',
  spotCap: '祛痘點已達上限',
  spotRefused: '眼睛和嘴巴不適用祛痘',
  zoomHint: '放大畫面可以點得更準',
  clearConfirm: '確定清除？',
  clearAll: (n: number): string => `全部清除（${n}）`,
  clearPerson: (n: number): string => `清除此人（${n}）`,
  warmEnds: ['冷', '暖'] as const,
} as const;
