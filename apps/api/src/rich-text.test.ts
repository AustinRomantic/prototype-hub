import { describe, expect, it } from 'vitest';
import { MAX_CHANGE_CONTENT_LENGTH, sanitizeChangeContent } from './rich-text.js';

describe('version change rich text', () => {
  it('keeps the supported formatting', () => {
    expect(sanitizeChangeContent('<p><b>新增</b><em>支付流程</em></p><ul><li>银行卡</li></ul>'))
      .toBe('<p><strong>新增</strong><em>支付流程</em></p><ul><li>银行卡</li></ul>');
  });

  it('removes scripts, event handlers and unsupported elements', () => {
    expect(sanitizeChangeContent('<p onclick="alert(1)">安全内容</p><script>alert(1)</script><img src=x onerror=alert(1)>'))
      .toBe('<p>安全内容</p>');
  });

  it('normalizes visually empty content and enforces the storage limit', () => {
    expect(sanitizeChangeContent('<p><br></p>')).toBe('');
    expect(sanitizeChangeContent(`内容${'a'.repeat(MAX_CHANGE_CONTENT_LENGTH)}`).length).toBe(MAX_CHANGE_CONTENT_LENGTH);
  });
});
