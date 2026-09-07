import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma, VersionStatus } from '@prototype-hub/db';
import { deletePrefix, ensureBucket } from '@prototype-hub/storage';
import type { app as apiApp } from './server.js';

// Run only against the explicitly configured isolated restore/test services.
describe.skipIf(process.env.PHASE1_INTEGRATION !== 'true')('phase 1 API + PostgreSQL + object storage', () => {
  let app: typeof apiApp;
  let cookie: string;
  let otherCookie: string;
  let projectId: string;
  const users: string[] = [];
  const source = '<!doctype html><html><body>原型原件测试</body></html>';
  const hash = (value: string | Buffer) => crypto.createHash('sha256').update(value).digest('hex');

  beforeAll(async () => {
    if (!process.env.DATABASE_URL?.includes('55433') || process.env.S3_BUCKET !== 'prototype-phase1-tests') {
      throw new Error('Integration tests require isolated port 55433 and prototype-phase1-tests bucket');
    }
    app = (await import('./server.js')).app;
    await app.ready();
    await ensureBucket();
    const makeUser = async () => {
      const user = await prisma.user.create({ data: { username: `phase1-test-${crypto.randomUUID()}`, passwordHash: 'integration-only' } });
      users.push(user.id);
      const token = crypto.randomUUID();
      await prisma.session.create({ data: { userId: user.id, tokenHash: hash(token), expiresAt: new Date(Date.now() + 3600000) } });
      return `session=${token}`;
    };
    cookie = await makeUser(); otherCookie = await makeUser();
    const project = await app.inject({ method: 'POST', url: '/api/v1/projects', headers: { cookie }, payload: { name: `phase1-fixture-${crypto.randomUUID()}` } });
    expect(project.statusCode).toBe(200);
    projectId = project.json().id;
  });

  afterAll(async () => {
    if (projectId) await Promise.all([deletePrefix(`sources/${projectId}/`), deletePrefix(`previews/${projectId}/`)]);
    if (users.length) await prisma.user.deleteMany({ where: { id: { in: users } } });
    if (app) await app.close();
    await prisma.$disconnect();
  });

  const asset = async (name = `asset-${crypto.randomUUID()}`) => {
    const response = await app.inject({ method: 'POST', url: `/api/v1/projects/${projectId}/assets`, headers: { cookie }, payload: { name } });
    expect(response.statusCode).toBe(201);
    return response.json().id as string;
  };
  const upload = async (assetId: string, fields: Record<string, string> = {}, filename = '原始订单.html') => {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) form.append(key, value);
    form.append('file', new Blob([source], { type: 'text/html' }), filename);
    const request = new Request('http://localhost/upload', { method: 'POST', body: form });
    return app.inject({ method: 'POST', url: `/api/v1/assets/${assetId}/versions`, headers: { cookie, 'content-type': request.headers.get('content-type')! }, payload: Buffer.from(await request.arrayBuffer()) });
  };
  const ready = (id: string) => prisma.prototypeVersion.update({ where: { id }, data: { status: VersionStatus.READY } });

  it('downloads exact originals, requires login and ownership, and does not need a successful preview', async () => {
    const id = await asset();
    const created = await upload(id);
    expect(created.statusCode).toBe(202);
    const version = created.json();
    expect(version.checksum).toBe(hash(source));
    await prisma.prototypeVersion.update({ where: { id: version.id }, data: { status: VersionStatus.FAILED } });
    const url = `/api/v1/versions/${version.id}/download`;
    expect((await app.inject({ url })).statusCode).toBe(401);
    expect((await app.inject({ url, headers: { cookie: otherCookie } })).statusCode).toBe(404);
    const response = await app.inject({ url, headers: { cookie } });
    expect(response.statusCode).toBe(200);
    expect(hash(response.rawPayload)).toBe(hash(source));
    expect(response.headers['content-type']).toBe('application/octet-stream');
    expect(response.headers['content-disposition']).toContain(encodeURIComponent('原始订单.html'));
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect((await app.inject({ url: '/api/v1/versions/does-not-exist/download', headers: { cookie } })).statusCode).toBe(404);
  });

  it('uses a version filename for legacy originals and reports a missing object', async () => {
    const version = (await upload(await asset())).json();
    await prisma.prototypeVersion.update({ where: { id: version.id }, data: { sourceFileName: null } });
    const url = `/api/v1/versions/${version.id}/download`;
    expect((await app.inject({ url, headers: { cookie } })).headers['content-disposition']).toContain('prototype-v1.html');
    await deletePrefix(version.sourceKey);
    expect((await app.inject({ url, headers: { cookie } })).statusCode).toBe(404);
  });

  it('never reuses a deleted highest number and serializes concurrent allocations', async () => {
    const id = await asset();
    expect((await upload(id)).json().versionNo).toBe(1);
    const second = (await upload(id)).json();
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/versions/${second.id}`, headers: { cookie } })).statusCode).toBe(200);
    const responses = await Promise.all(Array.from({ length: 6 }, () => upload(id)));
    expect(responses.map(response => response.statusCode)).toEqual(Array(6).fill(202));
    expect(responses.map(response => response.json().versionNo).sort((a, b) => a - b)).toEqual([3, 4, 5, 6, 7, 8]);
    expect((await prisma.prototypeAsset.findUniqueOrThrow({ where: { id } })).lastVersionNo).toBe(8);
  });

  it('records automatic, explicit older and explicitly absent baselines', async () => {
    const id = await asset();
    const first = (await upload(id)).json();
    expect(first).toMatchObject({ baselineRecorded: true, baseVersionId: null, baseVersionNo: null });
    await ready(first.id);
    const second = (await upload(id)).json();
    expect(second).toMatchObject({ baseVersionId: first.id, baseVersionNo: 1 });
    await ready(second.id);
    const third = (await upload(id, { baseVersionId: first.id })).json();
    expect(third).toMatchObject({ baseVersionId: first.id, baseVersionNo: 1, versionNo: 3 });
    const noBase = (await upload(id, { baseVersionId: '' })).json();
    expect(noBase).toMatchObject({ baselineRecorded: true, baseVersionId: null, baseVersionNo: null });
    const auto = (await upload(id)).json();
    expect(auto).toMatchObject({ baseVersionId: second.id, baseVersionNo: 2 });
  });

  it('rejects foreign, failed and missing baselines without advancing the counter', async () => {
    const id = await asset();
    const own = (await upload(id)).json();
    const foreign = (await upload(await asset())).json(); await ready(foreign.id);
    for (const baseVersionId of [own.id, foreign.id, 'does-not-exist']) {
      expect((await upload(id, { baseVersionId })).statusCode).toBe(409);
    }
    expect((await prisma.prototypeAsset.findUniqueOrThrow({ where: { id } })).lastVersionNo).toBe(1);
  });

  it('preserves a deleted baseline number and exposes it in the workspace', async () => {
    const id = await asset();
    const first = (await upload(id)).json(); await ready(first.id);
    const second = (await upload(id)).json();
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/versions/${first.id}`, headers: { cookie } })).statusCode).toBe(200);
    const workspace = await app.inject({ url: `/api/v1/versions/${second.id}/workspace`, headers: { cookie } });
    expect(workspace.json()).toMatchObject({ baseVersionId: null, baseVersionNo: 1, baselineRecorded: true });
  });

  it('returns the actual historical match and separates asset metadata matches', async () => {
    const needle = `历史词-${crypto.randomUUID()}`;
    const name = `资产名-${crypto.randomUUID()}`;
    const id = await asset(name);
    const first = (await upload(id, { note: needle })).json();
    const latest = (await upload(id)).json();
    const search = (q: string, session = cookie) => app.inject({ url: `/api/v1/search?q=${encodeURIComponent(q)}`, headers: { cookie: session } });
    const results = (await search(needle)).json();
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ matchType: 'VERSION', matchedVersion: { id: first.id, versionNo: 1 } });
    expect(results[0].versions[0].id).not.toBe(latest.id);
    expect((await search(name)).json()[0]).toMatchObject({ matchType: 'ASSET', matchedVersion: null, id });
    expect((await search(needle, otherCookie)).json()).toEqual([]);
    expect((await search('')).json().every((row: { matchType: string }) => row.matchType === 'ASSET')).toBe(true);
  });

  it('applies a status filter to the matching version, not a different sibling', async () => {
    const id = await asset();
    const needle = `失败独有-${crypto.randomUUID()}`;
    const failed = (await upload(id, { note: needle })).json();
    await prisma.prototypeVersion.update({ where: { id: failed.id }, data: { status: VersionStatus.FAILED } });
    await ready((await upload(id)).json().id);
    const search = (status: string) => app.inject({ url: `/api/v1/search?q=${encodeURIComponent(needle)}&status=${status}`, headers: { cookie } });
    expect((await search('READY')).json()).toEqual([]);
    expect((await search('FAILED')).json()[0].matchedVersion.id).toBe(failed.id);
  });
});
