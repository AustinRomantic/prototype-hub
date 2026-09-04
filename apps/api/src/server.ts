import crypto from 'node:crypto';
import path from 'node:path';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import bcrypt from 'bcryptjs';
import { config } from '@prototype-hub/config';
import { assetInputSchema, loginSchema, openApiDocument, projectInputSchema, versionMetadataInputSchema } from '@prototype-hub/contracts';
import { prisma, Prisma, VersionStatus } from '@prototype-hub/db';
import { deleteObject, deletePrefix, ensureBucket, getObject, putObject } from '@prototype-hub/storage';
import { ACCEPTED_ASSET_ICON_TYPES, validateAssetIcon } from './asset-icon.js';
import { createPreviewToken, normalizePreviewPath, PREVIEW_ROUTE_MAX_PARAM_LENGTH, sanitizeSourceFileName, verifyPreviewToken } from './security.js';

const app = Fastify({
  logger: true,
  bodyLimit: config.UPLOAD_MAX_BYTES + 1024 * 1024,
  maxParamLength: PREVIEW_ROUTE_MAX_PARAM_LENGTH
});
type AuthRequest = FastifyRequest & { userId?: string };

const sha256 = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
const slug = (value: string) => value.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 80) || 'untitled';
const jsonVersion = <T extends { sizeBytes: bigint }>(version: T) => ({ ...version, sizeBytes: Number(version.sizeBytes) });
const jsonIconAsset = <T extends { id: string; iconKey: string | null; updatedAt: Date }>(asset: T) => {
  const { iconKey, ...rest } = asset;
  return { ...rest, iconUrl: iconKey ? `/api/v1/assets/${asset.id}/icon?v=${asset.updatedAt.getTime()}` : null };
};
const jsonAsset = <T extends { id: string; iconKey: string | null; updatedAt: Date; versions: Array<{ sizeBytes: bigint }> }>(asset: T) => jsonIconAsset({ ...asset, versions: asset.versions.map(jsonVersion) });
const isPublic = (url: string) => url.startsWith('/health') || url.startsWith('/api/v1/auth') || url.startsWith('/preview/');

async function requireUser(request: AuthRequest, reply: FastifyReply) {
  if (isPublic(request.url)) return;
  const token = request.cookies.session;
  if (!token) return reply.code(401).send({ error: '请先登录' });
  const session = await prisma.session.findUnique({ where: { tokenHash: sha256(token) } });
  if (!session || session.expiresAt < new Date()) return reply.code(401).send({ error: '登录已过期' });
  request.userId = session.userId;
}

async function getOwnedProject(projectId: string, userId: string) {
  return prisma.project.findFirst({ where: { id: projectId, ownerId: userId } });
}

async function getOwnedAsset(assetId: string, userId: string) {
  return prisma.prototypeAsset.findFirst({ where: { id: assetId, project: { ownerId: userId } } });
}

async function deleteStoredVersion(version: { sourceKey: string; previewPrefix: string }) {
  await Promise.all([deleteObject(version.sourceKey), deletePrefix(`${version.previewPrefix}/`)]);
}

function multipartValue(field: unknown) {
  if (!field || Array.isArray(field) || typeof field !== 'object' || !('value' in field)) return '';
  return String((field as { value?: unknown }).value ?? '');
}

function validateUpload(filename: string, buffer: Buffer) {
  const extension = path.extname(filename).toLowerCase();
  if (!['.html', '.htm', '.zip'].includes(extension)) throw new Error('只支持 HTML、HTM 或 ZIP 文件');
  const zipMagic = ['504b0304', '504b0506', '504b0708'].includes(buffer.subarray(0, 4).toString('hex'));
  if (extension === '.zip' && !zipMagic) throw new Error('ZIP 文件格式无效');
  if (extension !== '.zip' && zipMagic) throw new Error('文件扩展名与内容不一致');
  if (extension !== '.zip') {
    const sample = buffer.subarray(0, Math.min(buffer.length, 8192)).toString('utf8');
    if (!/<(?:!doctype\s+html|html|head|body)\b/i.test(sample)) throw new Error('HTML 文件格式无效');
  }
  return extension;
}

async function init() {
  await ensureBucket();
  const existing = await prisma.user.findUnique({ where: { username: config.ADMIN_USERNAME } });
  if (!existing) {
    await prisma.user.create({ data: { username: config.ADMIN_USERNAME, passwordHash: await bcrypt.hash(config.ADMIN_PASSWORD, 12) } });
    app.log.info(`created admin user ${config.ADMIN_USERNAME}`);
  }
}

await app.register(cookie, { secret: config.SESSION_SECRET });
await app.register(cors, { origin: config.WEB_ORIGIN, credentials: true });
await app.register(multipart, { limits: { fileSize: config.UPLOAD_MAX_BYTES, files: 1 } });
app.addHook('preHandler', requireUser);

app.get('/health', async () => ({ ok: true }));
app.get('/api/v1/openapi.json', async () => openApiDocument);

app.post('/api/v1/auth/login', async (request, reply) => {
  const parsed = loginSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: '用户名和密码不能为空' });
  const user = await prisma.user.findUnique({ where: { username: parsed.data.username } });
  if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) return reply.code(401).send({ error: '用户名或密码错误' });
  const token = crypto.randomBytes(32).toString('hex');
  await prisma.session.create({ data: { tokenHash: sha256(token), userId: user.id, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) } });
  reply.setCookie('session', token, { httpOnly: true, sameSite: 'lax', secure: config.COOKIE_SECURE, path: '/', maxAge: 7 * 24 * 60 * 60 });
  return { user: { id: user.id, username: user.username } };
});

app.post('/api/v1/auth/logout', async (request: AuthRequest, reply) => {
  const token = request.cookies.session;
  if (token) await prisma.session.deleteMany({ where: { tokenHash: sha256(token) } });
  reply.clearCookie('session', { path: '/' });
  return { ok: true };
});

app.get('/api/v1/auth/me', async (request: AuthRequest, reply) => {
  if (!request.userId) return reply.code(401).send({ error: '请先登录' });
  return prisma.user.findUnique({ where: { id: request.userId }, select: { id: true, username: true } });
});

app.get('/api/v1/projects', async (request: AuthRequest) => prisma.project.findMany({
  where: { ownerId: request.userId }, orderBy: { updatedAt: 'desc' },
  include: { _count: { select: { assets: true } }, assets: { select: { id: true, name: true, previewVersionId: true, releaseVersionId: true, updatedAt: true }, orderBy: { updatedAt: 'desc' }, take: 6 } }
}));

app.post('/api/v1/projects', async (request: AuthRequest, reply) => {
  const parsed = projectInputSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: '项目名称无效' });
  const base = slug(parsed.data.name);
  const suffix = crypto.randomBytes(3).toString('hex');
  return prisma.project.create({ data: { ...parsed.data, slug: `${base}-${suffix}`, ownerId: request.userId! } });
});

app.get('/api/v1/projects/:projectId', async (request: AuthRequest, reply) => {
  const { projectId } = request.params as { projectId: string };
  const project = await prisma.project.findFirst({ where: { id: projectId, ownerId: request.userId }, include: { assets: { include: { tags: { include: { tag: true } }, _count: { select: { versions: true } } }, orderBy: { updatedAt: 'desc' } } } });
  if (!project) return reply.code(404).send({ error: '项目不存在' });
  return { ...project, assets: project.assets.map(jsonIconAsset) };
});

app.patch('/api/v1/projects/:projectId', async (request: AuthRequest, reply) => {
  const { projectId } = request.params as { projectId: string };
  if (!(await getOwnedProject(projectId, request.userId!))) return reply.code(404).send({ error: '项目不存在' });
  const parsed = projectInputSchema.partial().safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: '项目内容无效' });
  return prisma.project.update({ where: { id: projectId }, data: parsed.data });
});

app.delete('/api/v1/projects/:projectId', async (request: AuthRequest, reply) => {
  const { projectId } = request.params as { projectId: string };
  if (!(await getOwnedProject(projectId, request.userId!))) return reply.code(404).send({ error: '项目不存在' });
  const versions = await prisma.prototypeVersion.findMany({ where: { asset: { projectId } }, select: { sourceKey: true, previewPrefix: true } });
  const assets = await prisma.prototypeAsset.findMany({ where: { projectId }, select: { iconKey: true } });
  await prisma.project.delete({ where: { id: projectId } });
  await Promise.allSettled([...versions.map(deleteStoredVersion), ...assets.flatMap(asset => asset.iconKey ? [deleteObject(asset.iconKey)] : [])]);
  return { ok: true };
});

app.get('/api/v1/projects/:projectId/assets', async (request: AuthRequest, reply) => {
  const { projectId } = request.params as { projectId: string };
  if (!(await getOwnedProject(projectId, request.userId!))) return reply.code(404).send({ error: '项目不存在' });
  const assets = await prisma.prototypeAsset.findMany({ where: { projectId }, include: { tags: { include: { tag: true } }, _count: { select: { versions: true } } }, orderBy: { updatedAt: 'desc' } });
  return assets.map(jsonIconAsset);
});

app.post('/api/v1/projects/:projectId/assets', async (request: AuthRequest, reply) => {
  const { projectId } = request.params as { projectId: string };
  if (!(await getOwnedProject(projectId, request.userId!))) return reply.code(404).send({ error: '项目不存在' });
  const parsed = assetInputSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: '原型名称无效' });
  const asset = await prisma.prototypeAsset.create({ data: { projectId, name: parsed.data.name, slug: `${slug(parsed.data.name)}-${crypto.randomBytes(3).toString('hex')}`, description: parsed.data.description, tags: { create: parsed.data.tags.map(name => ({ tag: { connectOrCreate: { where: { name }, create: { name } } } })) } }, include: { tags: { include: { tag: true } } } });
  return reply.code(201).send(jsonIconAsset(asset));
});

app.get('/api/v1/assets/:assetId', async (request: AuthRequest, reply) => {
  const { assetId } = request.params as { assetId: string };
  const asset = await prisma.prototypeAsset.findFirst({ where: { id: assetId, project: { ownerId: request.userId } }, include: { project: true, tags: { include: { tag: true } }, versions: { orderBy: { versionNo: 'desc' } } } });
  if (!asset) return reply.code(404).send({ error: '原型不存在' });
  return jsonAsset(asset);
});

app.patch('/api/v1/assets/:assetId', async (request: AuthRequest, reply) => {
  const { assetId } = request.params as { assetId: string };
  const asset = await getOwnedAsset(assetId, request.userId!);
  if (!asset) return reply.code(404).send({ error: '原型不存在' });
  const parsed = assetInputSchema.partial().safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: '原型内容无效' });
  const { tags, ...data } = parsed.data;
  if (tags) {
    await prisma.assetTag.deleteMany({ where: { assetId } });
    await prisma.prototypeAsset.update({ where: { id: assetId }, data: { ...data, tags: { create: tags.map(name => ({ tag: { connectOrCreate: { where: { name }, create: { name } } } })) } } });
  } else await prisma.prototypeAsset.update({ where: { id: assetId }, data });
  const updated = await prisma.prototypeAsset.findUniqueOrThrow({ where: { id: assetId }, include: { tags: { include: { tag: true } } } });
  return jsonIconAsset(updated);
});

app.get('/api/v1/assets/:assetId/icon', async (request: AuthRequest, reply) => {
  const { assetId } = request.params as { assetId: string };
  const asset = await getOwnedAsset(assetId, request.userId!);
  if (!asset?.iconKey) return reply.code(404).send({ error: '原型图标不存在' });
  const object = await getObject(asset.iconKey).catch(() => null);
  if (!object?.Body || !('transformToByteArray' in object.Body) || typeof object.Body.transformToByteArray !== 'function') return reply.code(404).send({ error: '原型图标不存在' });
  const body = await object.Body.transformToByteArray();
  return reply
    .header('Content-Security-Policy', "default-src 'none'; sandbox")
    .header('X-Content-Type-Options', 'nosniff')
    .header('Cache-Control', 'private, max-age=300')
    .type(object.ContentType || 'application/octet-stream')
    .send(Buffer.from(body));
});

app.post('/api/v1/assets/:assetId/icon', async (request: AuthRequest, reply) => {
  const { assetId } = request.params as { assetId: string };
  const asset = await getOwnedAsset(assetId, request.userId!);
  if (!asset) return reply.code(404).send({ error: '原型不存在' });

  let part;
  try {
    part = await request.file({ limits: { fileSize: config.ASSET_ICON_MAX_BYTES, files: 1 } });
  } catch {
    return reply.code(413).send({ error: '图标超过 2MB 限制' });
  }
  if (!part) return reply.code(400).send({ error: `请选择 ${ACCEPTED_ASSET_ICON_TYPES} 图标` });

  let buffer: Buffer;
  try {
    buffer = await part.toBuffer();
  } catch {
    return reply.code(413).send({ error: '图标超过 2MB 限制' });
  }
  if (part.file.truncated || buffer.byteLength > config.ASSET_ICON_MAX_BYTES) return reply.code(413).send({ error: '图标超过 2MB 限制' });

  let icon;
  try {
    icon = validateAssetIcon(part.filename, buffer);
  } catch (error) {
    return reply.code(400).send({ error: error instanceof Error ? error.message : '图标内容无效' });
  }

  const iconKey = `asset-icons/${asset.projectId}/${assetId}/${crypto.randomUUID()}${icon.extension}`;
  await putObject(iconKey, buffer, icon.contentType);
  try {
    const updated = await prisma.prototypeAsset.update({ where: { id: assetId }, data: { iconKey } });
    if (asset.iconKey) await deleteObject(asset.iconKey).catch(error => app.log.error(error, 'failed to clean replaced asset icon'));
    return jsonIconAsset(updated);
  } catch (error) {
    await deleteObject(iconKey).catch(() => undefined);
    throw error;
  }
});

app.delete('/api/v1/assets/:assetId/icon', async (request: AuthRequest, reply) => {
  const { assetId } = request.params as { assetId: string };
  const asset = await getOwnedAsset(assetId, request.userId!);
  if (!asset) return reply.code(404).send({ error: '原型不存在' });
  if (!asset.iconKey) return { ok: true };
  await prisma.prototypeAsset.update({ where: { id: assetId }, data: { iconKey: null } });
  await deleteObject(asset.iconKey).catch(error => app.log.error(error, 'failed to clean deleted asset icon'));
  return { ok: true };
});

app.delete('/api/v1/assets/:assetId', async (request: AuthRequest, reply) => {
  const { assetId } = request.params as { assetId: string };
  const asset = await getOwnedAsset(assetId, request.userId!);
  if (!asset) return reply.code(404).send({ error: '原型不存在' });
  const versions = await prisma.prototypeVersion.findMany({ where: { assetId }, select: { sourceKey: true, previewPrefix: true } });
  await prisma.prototypeAsset.delete({ where: { id: assetId } });
  await Promise.allSettled([...versions.map(deleteStoredVersion), ...(asset.iconKey ? [deleteObject(asset.iconKey)] : [])]);
  return { ok: true };
});

app.post('/api/v1/assets/:assetId/versions', async (request: AuthRequest, reply) => {
  const { assetId } = request.params as { assetId: string };
  const asset = await getOwnedAsset(assetId, request.userId!);
  if (!asset) return reply.code(404).send({ error: '原型不存在' });
  const part = await request.file();
  if (!part) return reply.code(400).send({ error: '请选择 HTML 或 ZIP 文件' });
  const buffer = await part.toBuffer();
  if (buffer.byteLength > config.UPLOAD_MAX_BYTES) return reply.code(413).send({ error: '文件超过 100MB 限制' });
  let extension: string;
  let entryPath: string;
  let sourceFileName: string;
  try {
    extension = validateUpload(part.filename, buffer);
    entryPath = normalizePreviewPath(multipartValue(part.fields.entryPath) || 'index.html');
    sourceFileName = sanitizeSourceFileName(part.filename);
  } catch (error) {
    return reply.code(400).send({ error: error instanceof Error ? error.message : '上传内容无效' });
  }
  const versionId = crypto.randomUUID();
  const sourceKey = `sources/${asset.projectId}/${assetId}/${versionId}/source${extension}`;
  const previewPrefix = `previews/${asset.projectId}/${assetId}/${versionId}`;
  await putObject(sourceKey, buffer, part.mimetype || 'application/octet-stream');
  try {
    const version = await prisma.$transaction(async tx => {
      const versionNo = ((await tx.prototypeVersion.aggregate({ _max: { versionNo: true }, where: { assetId } }))._max.versionNo ?? 0) + 1;
      return tx.prototypeVersion.create({ data: { id: versionId, assetId, versionNo, sourceFileName, sourceKey, previewPrefix, note: multipartValue(part.fields.note).slice(0, 2000), entryPath, sizeBytes: buffer.byteLength, status: VersionStatus.PROCESSING } });
    }, { isolationLevel: 'Serializable' });
    return reply.code(202).send(jsonVersion(version));
  } catch (error) {
    await deleteObject(sourceKey).catch(() => undefined);
    throw error;
  }
});

app.get('/api/v1/assets/:assetId/versions', async (request: AuthRequest, reply) => {
  const { assetId } = request.params as { assetId: string };
  if (!(await getOwnedAsset(assetId, request.userId!))) return reply.code(404).send({ error: '原型不存在' });
  const versions = await prisma.prototypeVersion.findMany({ where: { assetId }, orderBy: { versionNo: 'desc' } });
  return versions.map(jsonVersion);
});

app.get('/api/v1/versions/:versionId', async (request: AuthRequest, reply) => {
  const { versionId } = request.params as { versionId: string };
  const version = await prisma.prototypeVersion.findFirst({ where: { id: versionId, asset: { project: { ownerId: request.userId } } } });
  if (!version) return reply.code(404).send({ error: '版本不存在' });
  return jsonVersion(version);
});

app.patch('/api/v1/versions/:versionId', async (request: AuthRequest, reply) => {
  const { versionId } = request.params as { versionId: string };
  const version = await prisma.prototypeVersion.findFirst({ where: { id: versionId, asset: { project: { ownerId: request.userId } } } });
  if (!version) return reply.code(404).send({ error: '版本不存在' });
  const parsed = versionMetadataInputSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: '版本备注不符合要求', details: parsed.error.flatten() });
  const updated = await prisma.prototypeVersion.update({ where: { id: versionId }, data: { note: parsed.data.note } });
  return jsonVersion(updated);
});

async function pointVersion(request: AuthRequest, reply: FastifyReply, field: 'previewVersionId' | 'releaseVersionId') {
  const { versionId } = request.params as { versionId: string };
  const version = await prisma.prototypeVersion.findFirst({ where: { id: versionId, status: VersionStatus.READY, asset: { project: { ownerId: request.userId } } } });
  if (!version) return reply.code(404).send({ error: '可用版本不存在' });
  await prisma.prototypeAsset.update({ where: { id: version.assetId }, data: { [field]: versionId } });
  return { ok: true, assetId: version.assetId, versionId };
}
app.post('/api/v1/versions/:versionId/set-preview', (request, reply) => pointVersion(request as AuthRequest, reply, 'previewVersionId'));
app.post('/api/v1/versions/:versionId/set-release', (request, reply) => pointVersion(request as AuthRequest, reply, 'releaseVersionId'));

app.delete('/api/v1/versions/:versionId', async (request: AuthRequest, reply) => {
  const { versionId } = request.params as { versionId: string };
  const version = await prisma.prototypeVersion.findFirst({ where: { id: versionId, asset: { project: { ownerId: request.userId } } }, include: { asset: true } });
  if (!version) return reply.code(404).send({ error: '版本不存在' });
  if (version.asset.previewVersionId === versionId || version.asset.releaseVersionId === versionId) return reply.code(409).send({ error: '当前预览版或发布版不能删除' });
  await prisma.prototypeVersion.delete({ where: { id: versionId } });
  await deleteStoredVersion(version).catch(error => app.log.error(error, 'failed to clean deleted version objects'));
  return { ok: true };
});

app.get('/api/v1/versions/:versionId/preview-token', async (request: AuthRequest, reply) => {
  const { versionId } = request.params as { versionId: string };
  const version = await prisma.prototypeVersion.findFirst({ where: { id: versionId, status: VersionStatus.READY, asset: { project: { ownerId: request.userId } } } });
  if (!version) return reply.code(404).send({ error: '可预览版本不存在' });
  const token = createPreviewToken(config.PREVIEW_SECRET, versionId);
  return { token, entryPath: version.entryPath, url: `${config.PREVIEW_ORIGIN}/preview/${versionId}/${token}/${version.entryPath}` };
});

app.get('/api/v1/search', async (request: AuthRequest) => {
  type SearchQuery = { q?: string; projectId?: string; status?: VersionStatus; tag?: string; createdFrom?: string; createdTo?: string };
  const query = request.query as SearchQuery;
  const q = String(query.q || '').trim();
  const projectId = query.projectId;
  const status = query.status;
  const tag = String(query.tag || '').trim();
  const createdFrom = query.createdFrom ? new Date(query.createdFrom) : undefined;
  const createdTo = query.createdTo ? new Date(query.createdTo) : undefined;
  const where: Prisma.PrototypeAssetWhereInput = {
    project: { ownerId: request.userId },
    ...(projectId ? { projectId } : {}),
    ...(tag ? { tags: { some: { tag: { name: { equals: tag, mode: 'insensitive' } } } } } : {}),
    ...((createdFrom && !Number.isNaN(createdFrom.valueOf())) || (createdTo && !Number.isNaN(createdTo.valueOf())) ? {
      createdAt: {
        ...(createdFrom && !Number.isNaN(createdFrom.valueOf()) ? { gte: createdFrom } : {}),
        ...(createdTo && !Number.isNaN(createdTo.valueOf()) ? { lte: createdTo } : {})
      }
    } : {}),
    ...(q ? { OR: [
      { name: { contains: q, mode: 'insensitive' } },
      { description: { contains: q, mode: 'insensitive' } },
      { project: { name: { contains: q, mode: 'insensitive' } } },
      { tags: { some: { tag: { name: { contains: q, mode: 'insensitive' } } } } },
      { versions: { some: { OR: [
        { extractedText: { contains: q, mode: 'insensitive' } },
        { note: { contains: q, mode: 'insensitive' } },
        { sourceFileName: { contains: q, mode: 'insensitive' } },
        { entryPath: { contains: q, mode: 'insensitive' } }
      ] } } }
    ] } : {}),
    ...(status && Object.values(VersionStatus).includes(status) ? { versions: { some: { status } } } : {})
  };
  const rows = await prisma.prototypeAsset.findMany({ where, include: { project: { select: { id: true, name: true } }, tags: { include: { tag: true } }, versions: { orderBy: { versionNo: 'desc' }, take: 1, select: { id: true, versionNo: true, status: true, sourceFileName: true, createdAt: true } } }, orderBy: { updatedAt: 'desc' }, take: 100 });
  return rows.map(jsonIconAsset);
});

app.get('/preview/:versionId/:token/*', async (request, reply) => {
  const params = request.params as { versionId: string; token: string; '*': string };
  if (!verifyPreviewToken(config.PREVIEW_SECRET, params.token, params.versionId)) return reply.code(403).send('Invalid preview token');
  const version = await prisma.prototypeVersion.findUnique({ where: { id: params.versionId } });
  if (!version || version.status !== VersionStatus.READY) return reply.code(404).send('Preview not found');
  let normalized: string;
  try { normalized = normalizePreviewPath(params['*'] || version.entryPath); }
  catch { return reply.code(400).send('Invalid path'); }
  const object = await getObject(`${version.previewPrefix}/${normalized}`).catch(() => null);
  if (!object?.Body) return reply.code(404).send('File not found');
  if (!('transformToByteArray' in object.Body) || typeof object.Body.transformToByteArray !== 'function') return reply.code(500).send('Invalid object body');
  const body = await object.Body.transformToByteArray();
  const ext = path.extname(normalized).toLowerCase();
  const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf' };
  return reply
    .header('Content-Security-Policy', `default-src 'self' data: blob: https:; img-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline' https:; script-src 'self' 'unsafe-inline' https:; connect-src 'none'; frame-ancestors ${config.WEB_ORIGIN}`)
    .header('Referrer-Policy', 'no-referrer')
    .header('X-Content-Type-Options', 'nosniff')
    .header('Cache-Control', 'private, max-age=300')
    .type(object.ContentType || types[ext] || 'application/octet-stream')
    .send(Buffer.from(body));
});

await init();
await app.listen({ port: config.API_PORT, host: '0.0.0.0' });

const shutdown = async () => { await app.close(); await prisma.$disconnect(); process.exit(0); };
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
