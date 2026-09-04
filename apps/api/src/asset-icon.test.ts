import { describe, expect, it } from 'vitest';
import { validateAssetIcon } from './asset-icon.js';

describe('validateAssetIcon', () => {
  it('accepts PNG by signature', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(validateAssetIcon('原型图标.PNG', png)).toEqual({ extension: '.png', contentType: 'image/png' });
  });

  it('accepts JPEG and normalizes its extension', () => {
    expect(validateAssetIcon('icon.jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toEqual({ extension: '.jpg', contentType: 'image/jpeg' });
  });

  it('accepts WebP by RIFF and WEBP markers', () => {
    expect(validateAssetIcon('icon.webp', Buffer.from('RIFF0000WEBP', 'ascii'))).toEqual({ extension: '.webp', contentType: 'image/webp' });
  });

  it('rejects a renamed non-image', () => {
    expect(() => validateAssetIcon('icon.png', Buffer.from('<script>alert(1)</script>'))).toThrow('扩展名与文件内容不一致');
  });

  it('rejects unsupported image extensions', () => {
    expect(() => validateAssetIcon('icon.svg', Buffer.from('<svg/>'))).toThrow('图标只支持');
  });
});
