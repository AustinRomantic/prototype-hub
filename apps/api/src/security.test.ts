import { describe, expect, it } from 'vitest';
import { createPreviewToken, normalizePreviewPath, PREVIEW_ROUTE_MAX_PARAM_LENGTH, sanitizeSourceFileName, verifyPreviewToken } from './security.js';

describe('preview token', () => {
  it('accepts a valid token and rejects tampering or expiry', () => {
    const token = createPreviewToken('a-long-preview-secret', 'version-1', 1000, 5000);
    expect(token.length).toBeLessThan(PREVIEW_ROUTE_MAX_PARAM_LENGTH);
    expect(verifyPreviewToken('a-long-preview-secret', token, 'version-1', 2000)).toBe(true);
    expect(verifyPreviewToken('a-long-preview-secret', `${token}x`, 'version-1', 2000)).toBe(false);
    expect(verifyPreviewToken('a-long-preview-secret', token, 'version-1', 7000)).toBe(false);
  });
});

describe('preview path', () => {
  it('allows nested static assets', () => expect(normalizePreviewPath('assets/app.js')).toBe('assets/app.js'));
  it.each(['../secret', '/etc/passwd', 'assets/../../secret', 'C:\\secret', 'a//b'])('rejects %s', value => {
    expect(() => normalizePreviewPath(value)).toThrow();
  });
});

describe('source file name', () => {
  it('keeps a Unicode file name for display', () => expect(sanitizeSourceFileName('订单原型 V1.6.html')).toBe('订单原型 V1.6.html'));
  it('removes client paths and control characters', () => expect(sanitizeSourceFileName('C:\\fakepath\\demo\u0000.zip')).toBe('demo.zip'));
  it('rejects an empty display name', () => expect(() => sanitizeSourceFileName('\u0000')).toThrow('上传文件名无效'));
});
