import path from 'node:path';
import { prisma, VersionStatus } from '@prototype-hub/db';

export class InvalidBaselineError extends Error {}

export function originalVersionFileName(version: { sourceFileName: string | null; sourceKey: string; versionNo: number }) {
  return version.sourceFileName || `prototype-v${version.versionNo}${path.extname(version.sourceKey).toLowerCase() || '.zip'}`;
}

type NewVersion = {
  id: string; assetId: string; sourceKey: string; previewPrefix: string;
  sourceFileName: string; entryPath: string; sizeBytes: number; checksum: string;
  note: string; changeContent: string; baseVersionId?: string | null;
};

export async function createPrototypeVersion(input: NewVersion) {
  return prisma.$transaction(async tx => {
    // UPDATE locks the asset row until commit, serializing allocations for this asset.
    const asset = await tx.prototypeAsset.update({
      where: { id: input.assetId }, data: { lastVersionNo: { increment: 1 } }, select: { lastVersionNo: true }
    });
    const base = input.baseVersionId === null ? null : await tx.prototypeVersion.findFirst({
      where: { assetId: input.assetId, status: VersionStatus.READY, ...(input.baseVersionId ? { id: input.baseVersionId } : {}) },
      orderBy: { versionNo: 'desc' }, select: { id: true, versionNo: true }
    });
    if (input.baseVersionId && !base) throw new InvalidBaselineError('比较基线必须是当前原型中已成功处理的版本，请重新选择');
    const { baseVersionId: _base, ...data } = input;
    return tx.prototypeVersion.create({ data: {
      ...data, versionNo: asset.lastVersionNo, status: VersionStatus.PROCESSING,
      baselineRecorded: true, baseVersionId: base?.id ?? null, baseVersionNo: base?.versionNo ?? null
    } });
  });
}
