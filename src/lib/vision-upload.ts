import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat, type ImageRef } from 'expo-image-manipulator';

type VisionPurpose = 'scan' | 'stream' | 'stream-fast';

// The scanner's public proxy accepts 1 MiB including multipart fields. Keep
// headroom and use a smaller budget for repeated streaming frames.
const budgets = {
  scan: { bytes: 900 * 1024, dimension: 2048, quality: 0.82 },
  stream: { bytes: 320 * 1024, dimension: 1280, quality: 0.72 },
  'stream-fast': { bytes: 128 * 1024, dimension: 960, quality: 0.65 },
};

function imageBytes(base64: string) {
  return Math.floor(base64.length * 3 / 4) - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0);
}

export async function prepareVisionUpload(dataUrl: string, purpose: VisionPurpose): Promise<string> {
  const match = dataUrl.match(/^data:image\/(?:jpeg|png);base64,(.+)$/s);
  if (!match) throw new Error('El formato de la imagen no es válido.');
  const budget = budgets[purpose];
  if (imageBytes(match[1]) <= budget.bytes) return dataUrl;

  const context = ImageManipulator.manipulate(dataUrl);
  const images: ImageRef[] = [];
  try {
    const original = await context.renderAsync();
    images.push(original);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const scale = Math.min(1, budget.dimension * 0.75 ** attempt / Math.max(original.width, original.height));
      context.reset().resize({ width: Math.max(1, Math.round(original.width * scale)), height: Math.max(1, Math.round(original.height * scale)) });
      const rendered = await context.renderAsync();
      images.push(rendered);
      const result = await rendered.saveAsync({ base64: true, compress: budget.quality - attempt * 0.1, format: SaveFormat.JPEG });
      try {
        if (!result.base64) throw new Error('No se pudo preparar la imagen. Intentá capturarla nuevamente.');
        if (imageBytes(result.base64) <= budget.bytes) return `data:image/jpeg;base64,${result.base64}`;
      } finally {
        // Only remove the generated cache copy, never the captured source.
        try { if (result.uri.startsWith('file://')) new File(result.uri).delete(); } catch { /* Cache eviction is best effort. */ }
      }
    }
    throw new Error('La imagen sigue siendo demasiado grande. Intentá capturarla nuevamente.');
  } finally {
    for (const image of images) image.release();
    context.release();
  }
}
