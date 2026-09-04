import crypto from 'node:crypto';
import path from 'node:path';
import { config } from '@prototype-hub/config';
import { prisma, VersionStatus, type PrototypeVersion } from '@prototype-hub/db';
import { deletePrefix, getObject, putObject } from '@prototype-hub/storage';
import { extractHtmlText, unpackPrototype } from './archive.js';

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

async function main() {
  console.log('prototype worker started');
  while (true) {
    const processed = await claimAndProcess();
    if (!processed) await new Promise(resolve => setTimeout(resolve, 1500));
  }
}

main().catch(async error => { console.error(error); await prisma.$disconnect(); process.exit(1); });
