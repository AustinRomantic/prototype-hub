import path from 'node:path';

export const ACCEPTED_ASSET_ICON_TYPES = 'PNG、JPEG 或 WebP';

type AssetIconInfo = {
  extension: '.png' | '.jpg' | '.webp';
  contentType: 'image/png' | 'image/jpeg' | 'image/webp';
};

export function validateAssetIcon(filename: string, buffer: Buffer): AssetIconInfo {
  const extension = path.extname(filename).toLowerCase();
  if (!['.png', '.jpg', '.jpeg', '.webp'].includes(extension)) {
    throw new Error(`图标只支持 ${ACCEPTED_ASSET_ICON_TYPES}`);
  }

  const isPng = buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isJpeg = buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const isWebp = buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';

  if (isPng && extension === '.png') return { extension: '.png', contentType: 'image/png' };
  if (isJpeg && ['.jpg', '.jpeg'].includes(extension)) return { extension: '.jpg', contentType: 'image/jpeg' };
  if (isWebp && extension === '.webp') return { extension: '.webp', contentType: 'image/webp' };
  throw new Error('图标扩展名与文件内容不一致');
}
