import crypto from 'node:crypto';
import path from 'node:path';

// Fastify defaults route parameters to 100 characters. Signed preview tokens are
// intentionally longer, while 512 still provides a strict upper bound.
export const PREVIEW_ROUTE_MAX_PARAM_LENGTH = 512;

export function sanitizeSourceFileName(rawName: string) {
  const baseName = path.posix.basename(rawName.replaceAll('\\', '/'));
  const cleaned = baseName.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!cleaned) throw new Error('上传文件名无效');
  return Array.from(cleaned).slice(0, 255).join('');
}

export function createPreviewToken(secret: string, versionId: string, now = Date.now(), ttlMs = 60 * 60 * 1000) {
  const payload = Buffer.from(JSON.stringify({ versionId, expiresAt: now + ttlMs })).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function verifyPreviewToken(secret: string, token: string, versionId: string, now = Date.now()) {
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra) return false;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  const actualBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expected);
  if (actualBytes.length !== expectedBytes.length || !crypto.timingSafeEqual(actualBytes, expectedBytes)) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { versionId?: unknown; expiresAt?: unknown };
    return data.versionId === versionId && typeof data.expiresAt === 'number' && data.expiresAt > now;
  } catch {
    return false;
  }
}

export function normalizePreviewPath(rawPath: string) {
  if (!rawPath || rawPath.includes('\0') || rawPath.includes('\\') || rawPath.startsWith('/') || /^[A-Za-z]:/.test(rawPath)) {
    throw new Error('Invalid preview path');
  }
  const segments = rawPath.split('/');
  if (segments.some(segment => segment === '..' || segment === '')) throw new Error('Invalid preview path');
  const normalized = path.posix.normalize(rawPath).replace(/^\.\//, '');
  if (!normalized || normalized === '.' || normalized.startsWith('../')) throw new Error('Invalid preview path');
  return normalized;
}
