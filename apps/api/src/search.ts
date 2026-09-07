import { Prisma, prisma, VersionStatus } from '@prototype-hub/db';
import type { PrototypeSearchResult } from '@prototype-hub/contracts';

type SearchQuery = { q?: string; projectId?: string; status?: string; tag?: string; createdFrom?: string; createdTo?: string };
const versionSelect = { id: true, versionNo: true, status: true, sourceFileName: true, createdAt: true } as const;
const assetInclude = { project: { select: { id: true, name: true } }, tags: { include: { tag: true } } } as const;

export async function searchPrototypes(query: SearchQuery, userId: string): Promise<PrototypeSearchResult[]> {
  const q = String(query.q || '').trim();
  const tag = String(query.tag || '').trim();
  const status = Object.values(VersionStatus).includes(query.status as VersionStatus) ? query.status as VersionStatus : undefined;
  const from = query.createdFrom ? new Date(query.createdFrom) : undefined;
  const to = query.createdTo ? new Date(query.createdTo) : undefined;
  const assetScope: Prisma.PrototypeAssetWhereInput = {
    project: { ownerId: userId },
    ...(query.projectId ? { projectId: query.projectId } : {}),
    ...(tag ? { tags: { some: { tag: { name: { equals: tag, mode: 'insensitive' } } } } } : {}),
    createdAt: {
      ...(from && !Number.isNaN(from.valueOf()) ? { gte: from } : {}),
      ...(to && !Number.isNaN(to.valueOf()) ? { lte: to } : {})
    }
  };
  const assets = await prisma.prototypeAsset.findMany({
    where: { ...assetScope,
      ...(status ? { versions: { some: { status } } } : {}),
      ...(q ? { OR: [
        { name: { contains: q, mode: 'insensitive' } }, { description: { contains: q, mode: 'insensitive' } },
        { project: { name: { contains: q, mode: 'insensitive' } } },
        { tags: { some: { tag: { name: { contains: q, mode: 'insensitive' } } } } }
      ] } : {})
    },
    include: { ...assetInclude, versions: { orderBy: { versionNo: 'desc' }, take: 1, select: versionSelect } },
    orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }], take: 100
  });
  const assetResults: PrototypeSearchResult[] = assets.map(asset => ({
    id: asset.id, name: asset.name, description: asset.description, project: asset.project, tags: asset.tags,
    versions: asset.versions, matchType: 'ASSET', matchedVersion: null
  }));
  if (!q || assets.length === 100) return assetResults;
  const versions = await prisma.prototypeVersion.findMany({
    where: { asset: assetScope, ...(status ? { status } : {}), OR: [
      { extractedText: { contains: q, mode: 'insensitive' } }, { note: { contains: q, mode: 'insensitive' } },
      { changeContent: { contains: q, mode: 'insensitive' } }, { sourceFileName: { contains: q, mode: 'insensitive' } },
      { entryPath: { contains: q, mode: 'insensitive' } }
    ] },
    select: { ...versionSelect, asset: { include: assetInclude } },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: 100 - assets.length
  });
  return [...assetResults, ...versions.map(({ asset, ...version }): PrototypeSearchResult => ({
    id: asset.id, name: asset.name, description: asset.description, project: asset.project, tags: asset.tags,
    versions: [version], matchType: 'VERSION', matchedVersion: version
  }))];
}
