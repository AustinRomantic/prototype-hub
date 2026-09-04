import crypto from 'node:crypto';
import path from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '@prototype-hub/config';
import { materialCategorySchema, materialMetadataInputSchema } from '@prototype-hub/contracts';
import { MaterialCategory, MaterialStatus, Prisma, prisma, type VersionMaterial } from '@prototype-hub/db';
import { deleteObject, deletePrefix, getObject, putObject } from '@prototype-hub/storage';
import { ensureMaterialExtension, nextAvailableMaterialName, normalizeMaterialTags, validateMaterialFile } from './material.js';
import { sanitizeSourceFileName } from './security.js';

type AuthRequest = FastifyRequest & { userId?: string };

function multipartValue(field: unknown) {
  if (!field || Array.isArray(field) || typeof field !== 'object' || !('value' in field)) return '';
  return String((field as { value?: unknown }).value ?? '');
}

function jsonMaterial<T extends { id: string; sizeBytes: bigint }>(material: T) {
  const version = 'version' in material && material.version && typeof material.version === 'object'
    ? { ...material.version, ...('sizeBytes' in material.version && typeof material.version.sizeBytes === 'bigint' ? { sizeBytes: Number(material.version.sizeBytes) } : {}) }
    : undefined;
  return {
    ...material,
    ...(version ? { version } : {}),
    sizeBytes: Number(material.sizeBytes),
    previewUrl: `/api/v1/materials/${material.id}/preview`,
    downloadUrl: `/api/v1/materials/${material.id}/download`
  };
}

async function bodyBuffer(body: unknown) {
  if (!body || typeof body !== 'object' || !('transformToByteArray' in body) || typeof body.transformToByteArray !== 'function') throw new Error('对象存储返回空内容');
  return Buffer.from(await body.transformToByteArray());
}

async function ownedVersion(versionId: string, userId: string) {
  return prisma.prototypeVersion.findFirst({
    where: { id: versionId, asset: { project: { ownerId: userId } } },
    include: { asset: { include: { project: true } } }
  });
}

async function ownedMaterial(materialId: string, userId: string) {
  return prisma.versionMaterial.findFirst({
    where: { id: materialId, version: { asset: { project: { ownerId: userId } } } },
    include: { version: { include: { asset: { include: { project: true } } } } }
  });
}

function materialPrefix(sourceKey: string) {
  return `${path.posix.dirname(sourceKey)}/`;
}

function safeContentDisposition(name: string) {
  const fallback = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_') || 'download';
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

async function sendStoredObject(reply: FastifyReply, key: string, contentType: string, range?: string) {
  const object = await getObject(key, range);
  const buffer = await bodyBuffer(object.Body);
  reply.header('Accept-Ranges', 'bytes').header('X-Content-Type-Options', 'nosniff').header('Cache-Control', 'private, max-age=300').type(contentType);
  if (object.ContentRange) reply.code(206).header('Content-Range', object.ContentRange);
  if (object.ContentLength !== undefined) reply.header('Content-Length', String(object.ContentLength));
  return reply.send(buffer);
}

export async function registerMaterialRoutes(app: FastifyInstance) {
  app.get('/api/v1/versions/:versionId/workspace', async (request: AuthRequest, reply) => {
    const { versionId } = request.params as { versionId: string };
    const version = await ownedVersion(versionId, request.userId!);
    if (!version) return reply.code(404).send({ error: '版本不存在' });
    const [activeCount, trashCount, storage] = await Promise.all([
      prisma.versionMaterial.count({ where: { versionId, deletedAt: null } }),
      prisma.versionMaterial.count({ where: { versionId, deletedAt: { not: null } } }),
      prisma.versionMaterial.aggregate({ where: { versionId }, _sum: { sizeBytes: true } })
    ]);
    return {
      ...version,
      sizeBytes: Number(version.sizeBytes),
      stats: { activeCount, trashCount, totalCount: activeCount + trashCount, totalBytes: Number(storage._sum.sizeBytes ?? 0n) }
    };
  });

  app.get('/api/v1/versions/:versionId/materials', async (request: AuthRequest, reply) => {
    const { versionId } = request.params as { versionId: string };
    if (!(await ownedVersion(versionId, request.userId!))) return reply.code(404).send({ error: '版本不存在' });
    const query = request.query as { trash?: string; category?: string; tag?: string; q?: string; sort?: string };
    const category = materialCategorySchema.safeParse(query.category).success ? query.category as MaterialCategory : undefined;
    const q = String(query.q || '').trim();
    const tag = String(query.tag || '').trim();
    const orderBy: Prisma.VersionMaterialOrderByWithRelationInput = query.sort === 'oldest' ? { createdAt: 'asc' } : query.sort === 'name' ? { displayName: 'asc' } : { createdAt: 'desc' };
    const rows = await prisma.versionMaterial.findMany({
      where: {
        versionId,
        deletedAt: query.trash === 'true' ? { not: null } : null,
        ...(category ? { category } : {}),
        ...(tag ? { tags: { has: tag } } : {}),
        ...(q ? { OR: [
          { displayName: { contains: q, mode: 'insensitive' } },
          { originalFileName: { contains: q, mode: 'insensitive' } },
          { extractedText: { contains: q, mode: 'insensitive' } },
          { tags: { has: q } }
        ] } : {})
      },
      orderBy
    });
    return rows.map(jsonMaterial);
  });

  app.post('/api/v1/versions/:versionId/materials', async (request: AuthRequest, reply) => {
    const { versionId } = request.params as { versionId: string };
    const version = await ownedVersion(versionId, request.userId!);
    if (!version) return reply.code(404).send({ error: '版本不存在' });
    let part;
    try { part = await request.file({ limits: { fileSize: config.MATERIAL_MAX_BYTES, files: 1 } }); }
    catch { return reply.code(413).send({ error: '材料超过 100MB 限制' }); }
    if (!part) return reply.code(400).send({ error: '请选择迭代材料' });
    let buffer: Buffer;
    try { buffer = await part.toBuffer(); }
    catch { return reply.code(413).send({ error: '材料超过 100MB 限制' }); }
    if (part.file.truncated || buffer.byteLength > config.MATERIAL_MAX_BYTES) return reply.code(413).send({ error: '材料超过 100MB 限制' });

    let definition;
    let originalFileName: string;
    try {
      originalFileName = sanitizeSourceFileName(part.filename);
      definition = validateMaterialFile(originalFileName, buffer, part.mimetype);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : '材料文件无效' });
    }
    const categoryResult = materialCategorySchema.safeParse(multipartValue(part.fields.category) || 'OTHER');
    if (!categoryResult.success) return reply.code(400).send({ error: '材料分类无效' });
    const tags = normalizeMaterialTags(multipartValue(part.fields.tags));
    const materialId = crypto.randomUUID();
    const sourceKey = `materials/${version.asset.projectId}/${version.assetId}/${versionId}/${materialId}/original${definition.extension}`;
    await putObject(sourceKey, buffer, definition.contentType);
    try {
      let material: VersionMaterial | undefined;
      for (let attempt = 0; attempt < 5 && !material; attempt += 1) {
        try {
          material = await prisma.$transaction(async tx => {
            const [count, storage, existing] = await Promise.all([
              tx.versionMaterial.count({ where: { versionId } }),
              tx.versionMaterial.aggregate({ where: { versionId }, _sum: { sizeBytes: true } }),
              tx.versionMaterial.findMany({ where: { versionId, deletedAt: null }, select: { displayName: true } })
            ]);
            if (count >= config.MATERIALS_PER_VERSION_MAX) throw new Error(`每个版本最多保存 ${config.MATERIALS_PER_VERSION_MAX} 个材料（含回收站）`);
            if (BigInt(storage._sum.sizeBytes ?? 0n) + BigInt(buffer.byteLength) > BigInt(config.MATERIAL_VERSION_TOTAL_BYTES)) throw new Error('该版本材料总容量超过 1GB 限制');
            const displayName = nextAvailableMaterialName(originalFileName, existing.map(item => item.displayName));
            return tx.versionMaterial.create({ data: {
              id: materialId,
              versionId,
              category: categoryResult.data,
              displayName,
              originalFileName,
              extension: definition.extension,
              mimeType: definition.contentType,
              sourceKey,
              previewKind: definition.previewKind,
              sizeBytes: buffer.byteLength,
              checksum: crypto.createHash('sha256').update(buffer).digest('hex'),
              tags
            } });
          }, { isolationLevel: 'Serializable' });
        } catch (error) {
          const retryable = error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(error.code);
          if (!retryable || attempt === 4) throw error;
        }
      }
      if (!material) throw new Error('材料记录创建失败');
      return reply.code(202).send(jsonMaterial(material));
    } catch (error) {
      await deleteObject(sourceKey).catch(() => undefined);
      if (error instanceof Error && (error.message.includes('最多保存') || error.message.includes('总容量'))) return reply.code(409).send({ error: error.message });
      throw error;
    }
  });

  app.get('/api/v1/materials/search', async (request: AuthRequest) => {
    const query = request.query as { q?: string; projectId?: string; assetId?: string; versionId?: string; category?: string; tag?: string };
    const q = String(query.q || '').trim();
    const category = materialCategorySchema.safeParse(query.category).success ? query.category as MaterialCategory : undefined;
    const rows = await prisma.versionMaterial.findMany({
      where: {
        deletedAt: null,
        version: { asset: { project: { ownerId: request.userId }, ...(query.projectId ? { projectId: query.projectId } : {}), ...(query.assetId ? { id: query.assetId } : {}) }, ...(query.versionId ? { id: query.versionId } : {}) },
        ...(category ? { category } : {}),
        ...(query.tag ? { tags: { has: query.tag } } : {}),
        ...(q ? { OR: [
          { displayName: { contains: q, mode: 'insensitive' } },
          { originalFileName: { contains: q, mode: 'insensitive' } },
          { extractedText: { contains: q, mode: 'insensitive' } },
          { tags: { has: q } }
        ] } : {})
      },
      include: { version: { select: { id: true, versionNo: true, asset: { select: { id: true, name: true, project: { select: { id: true, name: true } } } } } } },
      orderBy: { updatedAt: 'desc' },
      take: 100
    });
    return rows.map(jsonMaterial);
  });

  app.get('/api/v1/materials/:materialId', async (request: AuthRequest, reply) => {
    const { materialId } = request.params as { materialId: string };
    const material = await ownedMaterial(materialId, request.userId!);
    if (!material) return reply.code(404).send({ error: '材料不存在' });
    return jsonMaterial(material);
  });

  app.patch('/api/v1/materials/:materialId', async (request: AuthRequest, reply) => {
    const { materialId } = request.params as { materialId: string };
    const material = await ownedMaterial(materialId, request.userId!);
    if (!material || material.deletedAt) return reply.code(404).send({ error: '材料不存在' });
    const parsed = materialMetadataInputSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: '材料信息不符合要求', details: parsed.error.flatten() });
    let displayName = parsed.data.displayName;
    if (displayName) {
      try { displayName = ensureMaterialExtension(displayName, material.extension); }
      catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : '材料名称无效' }); }
      const duplicate = await prisma.versionMaterial.findFirst({ where: { versionId: material.versionId, id: { not: materialId }, deletedAt: null, displayName: { equals: displayName, mode: 'insensitive' } } });
      if (duplicate) return reply.code(409).send({ error: '该版本空间已存在同名材料' });
    }
    const updated = await prisma.versionMaterial.update({ where: { id: materialId }, data: { ...parsed.data, ...(displayName ? { displayName } : {}) } });
    return jsonMaterial(updated);
  });

  app.delete('/api/v1/materials/:materialId', async (request: AuthRequest, reply) => {
    const { materialId } = request.params as { materialId: string };
    const material = await ownedMaterial(materialId, request.userId!);
    if (!material) return reply.code(404).send({ error: '材料不存在' });
    if (!material.deletedAt) await prisma.versionMaterial.update({ where: { id: materialId }, data: { deletedAt: new Date() } });
    return { ok: true };
  });

  app.post('/api/v1/materials/:materialId/restore', async (request: AuthRequest, reply) => {
    const { materialId } = request.params as { materialId: string };
    const material = await ownedMaterial(materialId, request.userId!);
    if (!material?.deletedAt) return reply.code(404).send({ error: '回收站中不存在该材料' });
    const duplicate = await prisma.versionMaterial.findFirst({ where: { versionId: material.versionId, deletedAt: null, displayName: { equals: material.displayName, mode: 'insensitive' } } });
    if (duplicate) return reply.code(409).send({ error: '存在同名活动材料，请先改名或删除冲突文件' });
    const restored = await prisma.versionMaterial.update({ where: { id: materialId }, data: { deletedAt: null } });
    return jsonMaterial(restored);
  });

  app.delete('/api/v1/materials/:materialId/permanent', async (request: AuthRequest, reply) => {
    const { materialId } = request.params as { materialId: string };
    const material = await ownedMaterial(materialId, request.userId!);
    if (!material) return reply.code(404).send({ error: '材料不存在' });
    if (!material.deletedAt) return reply.code(409).send({ error: '请先将材料移入回收站' });
    await prisma.versionMaterial.delete({ where: { id: materialId } });
    await deletePrefix(materialPrefix(material.sourceKey)).catch(error => app.log.error(error, 'failed to purge material objects'));
    return { ok: true };
  });

  app.post('/api/v1/materials/:materialId/retry-preview', async (request: AuthRequest, reply) => {
    const { materialId } = request.params as { materialId: string };
    const material = await ownedMaterial(materialId, request.userId!);
    if (!material || material.deletedAt) return reply.code(404).send({ error: '材料不存在' });
    if (material.status !== MaterialStatus.FAILED) return reply.code(409).send({ error: '只有预览生成失败的材料可以重试' });
    if (material.previewKey && material.previewKey !== material.sourceKey) await deleteObject(material.previewKey).catch(() => undefined);
    const updated = await prisma.versionMaterial.update({ where: { id: materialId }, data: { status: MaterialStatus.PROCESSING, previewKey: null, errorMessage: null, processingStartedAt: null } });
    return reply.code(202).send(jsonMaterial(updated));
  });

  app.get('/api/v1/materials/:materialId/preview', async (request: AuthRequest, reply) => {
    const { materialId } = request.params as { materialId: string };
    const material = await ownedMaterial(materialId, request.userId!);
    if (!material) return reply.code(404).send({ error: '材料不存在' });
    if (material.status !== MaterialStatus.READY || !material.previewKey) return reply.code(409).send({ error: material.errorMessage || '材料预览尚未就绪' });
    const contentType = material.previewKind === 'PDF' ? 'application/pdf' : material.previewKind === 'IMAGE' ? material.mimeType : material.previewKey.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8';
    const rawRange = request.headers.range;
    const range = material.previewKind === 'PDF' && rawRange && /^bytes=\d*-\d*$/.test(rawRange) ? rawRange : undefined;
    if (contentType.startsWith('text/html')) reply.header('Content-Security-Policy', "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox");
    return sendStoredObject(reply, material.previewKey, contentType, range).catch(() => reply.code(404).send({ error: '预览文件不存在' }));
  });

  app.get('/api/v1/materials/:materialId/download', async (request: AuthRequest, reply) => {
    const { materialId } = request.params as { materialId: string };
    const material = await ownedMaterial(materialId, request.userId!);
    if (!material) return reply.code(404).send({ error: '材料不存在' });
    reply.header('Content-Disposition', safeContentDisposition(material.displayName)).header('Content-Security-Policy', "default-src 'none'; sandbox");
    return sendStoredObject(reply, material.sourceKey, material.mimeType).catch(() => reply.code(404).send({ error: '原文件不存在' }));
  });
}
