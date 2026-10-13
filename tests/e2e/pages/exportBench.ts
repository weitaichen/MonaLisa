// The export bench's synthetic frame (S §6.4 rows 1 and 3): the 4096 × 3072 JPEG it decodes, then the export's own
// encoders on that decode, as /bench.html's 輸出測試 runs them. Sizes only: the times are SwiftShader's.
import { synthJpeg, timeEncode } from '../../../src/bench/exportBench';
import { importPhotoInfo } from '../../../src/media/importer';

export interface BenchFrameCheck {
  w: number;
  h: number;
  /** the synthetic source JPEG (q 0.92) */
  sourceBytes: number;
  jpegBytes: number;
  pngBytes: number;
}

declare global {
  interface Window {
    runBenchFrame?: () => Promise<BenchFrameCheck>;
  }
}

window.runBenchFrame = async () => {
  const blob = await synthJpeg(4096, 3072);
  const { bitmap } = await importPhotoInfo(blob, 4096);
  try {
    const jpeg = await timeEncode(bitmap, 'image/jpeg');
    const png = await timeEncode(bitmap, 'image/png');
    return { w: bitmap.width, h: bitmap.height, sourceBytes: blob.size, jpegBytes: jpeg.bytes, pngBytes: png.bytes };
  } finally {
    bitmap.close();
  }
};
