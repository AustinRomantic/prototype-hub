import { describe, expect, it } from 'vitest';
import { versionBaselineLabel, versionUploadMetadataSchema, versionStatusLabel, assetInputSchema, materialMetadataInputSchema, openApiDocument, projectInputSchema, versionMetadataInputSchema } from './index.js';

describe('shared contracts', () => {
  it('normalizes optional project fields', () => expect(projectInputSchema.parse({ name: '商城' }).description).toBe(''));
  it('rejects excessive asset tags', () => expect(assetInputSchema.safeParse({ name: '原型', tags: Array(21).fill('tag') }).success).toBe(false));
  it('allows an empty version note but rejects notes longer than 2000 characters', () => {
    expect(versionMetadataInputSchema.safeParse({ note: '' }).success).toBe(true);
    expect(versionMetadataInputSchema.safeParse({ note: 'a'.repeat(2001) }).success).toBe(false);
    expect(versionMetadataInputSchema.safeParse({ note: '', changeContent: 'a'.repeat(20001) }).success).toBe(false);
  });
  it('publishes an OpenAPI document for the core routes', () => {
    expect(openApiDocument.openapi).toBe('3.0.3');
    expect(openApiDocument.paths['/api/v1/assets/{assetId}/versions'].post.summary).toContain('上传');
    expect(openApiDocument.paths['/api/v1/versions/{versionId}'].patch.summary).toContain('备注');
    expect(openApiDocument.paths['/api/v1/versions/{versionId}/materials'].post.summary).toContain('材料');
  });
  it('validates editable material metadata', () => {
    expect(materialMetadataInputSchema.safeParse({ category: 'BACKEND', tags: ['API'] }).success).toBe(true);
    expect(materialMetadataInputSchema.safeParse({}).success).toBe(false);
    expect(materialMetadataInputSchema.safeParse({ tags: Array(11).fill('tag') }).success).toBe(false);
  });
});


describe('version provenance and status', () => {
  it('distinguishes omitted automatic baseline from deliberately absent baseline', () => {
    expect(versionUploadMetadataSchema.parse({}).baseVersionId).toBeUndefined();
    expect(versionUploadMetadataSchema.parse({ baseVersionId: null }).baseVersionId).toBeNull();
    expect(versionUploadMetadataSchema.safeParse({ baseVersionId: '' }).success).toBe(false);
  });
  it('does not infer a baseline for legacy records and preserves deleted provenance', () => {
    expect(versionBaselineLabel({ baselineRecorded: false, baseVersionId: null, baseVersionNo: null })).toBe('比较基线：未记录');
    expect(versionBaselineLabel({ baselineRecorded: true, baseVersionId: null, baseVersionNo: null })).toBe('比较基线：无');
    expect(versionBaselineLabel({ baselineRecorded: true, baseVersionId: 'v2', baseVersionNo: 2 })).toBe('比较基线：v2');
    expect(versionBaselineLabel({ baselineRecorded: true, baseVersionId: null, baseVersionNo: 2 })).toBe('比较基线：v2（原版本已删除）');
  });
  it('distinguishes saved originals from preview failures', () => {
    expect(versionStatusLabel('FAILED')).toBe('原件已保存 · 预览失败');
    expect(versionStatusLabel('PROCESSING')).toBe('原件已保存 · 预览处理中');
  });
});
