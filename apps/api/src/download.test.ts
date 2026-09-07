import { describe, expect, it } from 'vitest';
import { safeContentDisposition } from './download.js';
import { originalVersionFileName } from './version.js';

describe('original download names', () => {
  it('preserves the supplied original name and falls back using the original extension', () => {
    expect(originalVersionFileName({ sourceFileName: '订单（原始）.zip', sourceKey: 'source.zip', versionNo: 4 })).toBe('订单（原始）.zip');
    expect(originalVersionFileName({ sourceFileName: null, sourceKey: 'path/source.htm', versionNo: 4 })).toBe('prototype-v4.htm');
  });
  it('escapes header controls, quotes and RFC 5987 special characters', () => {
    const header = safeContentDisposition('订单"\r\n测试\'(1).html');
    expect(header).not.toMatch(/[\r\n]/);
    expect(header).toContain('%27%281%29.html');
  });
});
