import type { FastifyReply } from 'fastify';
import { getObject } from '@prototype-hub/storage';

export function safeContentDisposition(name: string) {
  const fallback = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_') || 'download';
  const encoded = encodeURIComponent(name).replace(/['()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

export async function sendOriginalDownload(reply: FastifyReply, key: string, name: string) {
  let object;
  try { object = await getObject(key); }
  catch (error) {
    const detail = error as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (detail.name === 'NoSuchKey' || detail.$metadata?.httpStatusCode === 404) return reply.code(404).send({ error: '原文件不存在' });
    reply.log.error(error, 'original download failed');
    return reply.code(503).send({ error: '暂时无法读取原文件，请稍后重试' });
  }
  if (!object.Body) return reply.code(404).send({ error: '原文件不存在' });
  reply.type('application/octet-stream')
    .header('Content-Disposition', safeContentDisposition(name))
    .header('Content-Security-Policy', "default-src 'none'; sandbox")
    .header('X-Content-Type-Options', 'nosniff')
    .header('Cache-Control', 'private, no-store');
  if (object.ContentLength !== undefined) reply.header('Content-Length', String(object.ContentLength));
  return reply.send(object.Body);
}
