import { z } from 'zod';

export const versionStatusSchema = z.enum(['PROCESSING', 'READY', 'FAILED']);
export type VersionStatus = z.infer<typeof versionStatusSchema>;

export const projectInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2000).optional().default('')
});

export const assetInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2000).optional().default(''),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional().default([])
});

export const loginSchema = z.object({ username: z.string().min(1), password: z.string().min(1) });

export type ProjectInput = z.infer<typeof projectInputSchema>;
export type AssetInput = z.infer<typeof assetInputSchema>;

export type ApiError = { error: string; details?: unknown };

const secured = (summary: string) => ({ summary, security: [{ cookieAuth: [] }], responses: { '200': { description: 'Success' }, '400': { description: 'Invalid request' }, '401': { description: 'Unauthorized' } } });

export const openApiDocument = {
  openapi: '3.0.3',
  info: { title: 'Prototype Hub API', version: '0.1.0', description: '原型资产、不可变版本、检索与安全预览 API' },
  components: {
    securitySchemes: { cookieAuth: { type: 'apiKey', in: 'cookie', name: 'session' } },
    schemas: {
      Error: { type: 'object', required: ['error'], properties: { error: { type: 'string' } } },
      VersionStatus: { type: 'string', enum: versionStatusSchema.options },
      ProjectInput: { type: 'object', required: ['name'], properties: { name: { type: 'string', maxLength: 120 }, description: { type: 'string', maxLength: 2000 } } },
      AssetInput: { type: 'object', required: ['name'], properties: { name: { type: 'string', maxLength: 120 }, description: { type: 'string', maxLength: 2000 }, tags: { type: 'array', maxItems: 20, items: { type: 'string' } } } }
    }
  },
  paths: {
    '/api/v1/auth/login': { post: { summary: '管理员登录', responses: { '200': { description: 'Authenticated' }, '401': { description: 'Invalid credentials' } } } },
    '/api/v1/auth/logout': { post: secured('退出登录') },
    '/api/v1/auth/me': { get: secured('当前用户') },
    '/api/v1/projects': { get: secured('项目列表'), post: secured('创建项目') },
    '/api/v1/projects/{projectId}': { get: secured('项目详情'), patch: secured('更新项目'), delete: secured('删除项目') },
    '/api/v1/projects/{projectId}/assets': { get: secured('项目原型列表'), post: secured('创建原型资产') },
    '/api/v1/assets/{assetId}': { get: secured('原型资产详情'), patch: secured('更新原型资产'), delete: secured('删除原型资产') },
    '/api/v1/assets/{assetId}/versions': { get: secured('版本列表'), post: secured('上传 HTML/ZIP 版本') },
    '/api/v1/versions/{versionId}': { get: secured('版本详情'), delete: secured('删除未引用版本') },
    '/api/v1/versions/{versionId}/set-preview': { post: secured('设置当前预览版') },
    '/api/v1/versions/{versionId}/set-release': { post: secured('设置当前发布版') },
    '/api/v1/versions/{versionId}/preview-token': { get: secured('生成短期预览地址') },
    '/api/v1/search': { get: secured('检索项目、资产、标签和 HTML 文本') }
  }
} as const;
