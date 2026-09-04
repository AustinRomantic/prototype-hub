import crypto from 'node:crypto';
import path from 'node:path';
import { config } from '@prototype-hub/config';
import { MaterialStatus, prisma, VersionStatus, type PrototypeVersion } from '@prototype-hub/db';
import { deletePrefix, getObject, putObject } from '@prototype-hub/storage';
import { extractHtmlText, unpackPrototype } from './archive.js';
import { processMaterial } from './material.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.otf': 'font/otf', '.map': 'application/json'
};

async function bodyBuffer(body: unknown) {
  if (!body || typeof body !== 'object' || !('transformToByteArray' in body) || typeof body.transformToByteArray !== 'function') {
    throw new Error('对象存储返回空内容');
  }
  return Buffer.from(await body.transformToByteArray());
}

async function processVersion(version: PrototypeVersion) {
  const source = await bodyBuffer((await getObject(version.sourceKey)).Body);
  const files = unpackPrototype(source, version.entryPath, { maxFiles: config.MAX_FILES, maxExtractedBytes: config.EXTRACTED_MAX_BYTES });
  await deletePrefix(`${version.previewPrefix}/`);
  let extractedText = '';
  for (const file of files) {
    const ext = path.extname(file.name).toLowerCase();
    await putObject(`${version.previewPrefix}/${file.name}`, file.data, MIME[ext] || 'application/octet-stream');
    if (ext === '.html' || ext === '.htm') extractedText += ` ${extractHtmlText(file.data.toString('utf8'))}`;
  }
  const manifest = { versionId: version.id, entryPath: version.entryPath, fileCount: files.length, files: files.map(file => ({ path: file.name, bytes: file.data.byteLength })) };
  await putObject(`${version.previewPrefix}/manifest.json`, JSON.stringify(manifest, null, 2), 'application/json');
  return { fileCount: files.length, extractedText: extractedText.trim().slice(0, 2_000_000), checksum: crypto.createHash('sha256').update(source).digest('hex') };
}

async function claimAndProcess() {
  const staleBefore = new Date(Date.now() - 15 * 60 * 1000);
  const candidate = await prisma.prototypeVersion.findFirst({
    where: { status: VersionStatus.PROCESSING, OR: [{ processingStartedAt: null }, { processingStartedAt: { lt: staleBefore } }] },
    orderBy: { createdAt: 'asc' }
  });
  if (!candidate) return false;
  const claimedAt = new Date();
  const claim = await prisma.prototypeVersion.updateMany({
    where: { id: candidate.id, status: VersionStatus.PROCESSING, processingStartedAt: candidate.processingStartedAt },
    data: { processingStartedAt: claimedAt, errorMessage: null }
  });
  if (claim.count !== 1) return true;
  const version = { ...candidate, processingStartedAt: claimedAt };
  try {
    const result = await processVersion(version);
    await prisma.$transaction(async tx => {
      const current = await tx.prototypeVersion.findUnique({ where: { id: version.id }, include: { asset: true } });
      if (!current || current.status !== VersionStatus.PROCESSING) return;
      await tx.prototypeVersion.update({ where: { id: version.id }, data: { status: VersionStatus.READY, fileCount: result.fileCount, extractedText: result.extractedText, checksum: result.checksum } });
      if (!current.asset.previewVersionId) await tx.prototypeAsset.update({ where: { id: current.assetId }, data: { previewVersionId: current.id } });
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知处理错误';
    await deletePrefix(`${version.previewPrefix}/`).catch(() => undefined);
    await prisma.prototypeVersion.update({ where: { id: version.id }, data: { status: VersionStatus.FAILED, errorMessage: message.slice(0, 1000) } });
  }
  return true;
}

async function claimAndProcessMaterial() {
  const staleBefore = new Date(Date.now() - 15 * 60 * 1000);
  const candidate = await prisma.versionMaterial.findFirst({
    where: { status: MaterialStatus.PROCESSING, deletedAt: null, OR: [{ processingStartedAt: null }, { processingStartedAt: { lt: staleBefore } }] },
    orderBy: { createdAt: 'asc' }
  });
  if (!candidate) return false;
  const claimedAt = new Date();
  const claim = await prisma.versionMaterial.updateMany({
    where: { id: candidate.id, status: MaterialStatus.PROCESSING, deletedAt: null, processingStartedAt: candidate.processingStartedAt },
    data: { processingStartedAt: claimedAt, errorMessage: null }
  });
  if (claim.count !== 1) return true;
  try {
    const result = await processMaterial({ ...candidate, processingStartedAt: claimedAt });
    await prisma.versionMaterial.updateMany({
      where: { id: candidate.id, status: MaterialStatus.PROCESSING },
      data: { status: MaterialStatus.READY, previewKey: result.previewKey, extractedText: result.extractedText, errorMessage: null }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知材料处理错误';
    await prisma.versionMaterial.update({ where: { id: candidate.id }, data: { status: MaterialStatus.FAILED, errorMessage: message.slice(0, 1000) } });
  }
  return true;
}

async function purgeExpiredMaterials() {
  const expiredBefore = new Date(Date.now() - config.MATERIAL_TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const expired = await prisma.versionMaterial.findMany({ where: { deletedAt: { lt: expiredBefore } }, orderBy: { deletedAt: 'asc' }, take: 20 });
  for (const material of expired) {
    await deletePrefix(`${path.posix.dirname(material.sourceKey)}/`).catch(error => console.error('failed to purge material objects', error));
    await prisma.versionMaterial.deleteMany({ where: { id: material.id, deletedAt: { lt: expiredBefore } } });
  }
  return expired.length > 0;
}

async function main() {
  console.log('prototype worker started');
  let nextPurgeAt = 0;
  while (true) {
    const processedVersion = await claimAndProcess();
    const processedMaterial = await claimAndProcessMaterial();
    let purged = false;
    if (Date.now() >= nextPurgeAt) {
      purged = await purgeExpiredMaterials();
      nextPurgeAt = Date.now() + 60 * 1000;
    }
    if (!processedVersion && !processedMaterial && !purged) await new Promise(resolve => setTimeout(resolve, 1500));
  }
}

main().catch(async error => { console.error(error); await prisma.$disconnect(); process.exit(1); });
