import { describe, expect, it } from 'vitest';
import { assetInputSchema, openApiDocument, projectInputSchema } from './index.js';

describe('shared contracts', () => {
  it('normalizes optional project fields', () => expect(projectInputSchema.parse({ name: '商城' }).description).toBe(''));
  it('rejects excessive asset tags', () => expect(assetInputSchema.safeParse({ name: '原型', tags: Array(21).fill('tag') }).success).toBe(false));
  it('publishes an OpenAPI document for the core routes', () => {
    expect(openApiDocument.openapi).toBe('3.0.3');
    expect(openApiDocument.paths['/api/v1/assets/{assetId}/versions'].post.summary).toContain('上传');
  });
});
