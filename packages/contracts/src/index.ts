import { z } from 'zod';

export const versionStatusSchema = z.enum(['PROCESSING', 'READY', 'FAILED']);
export type VersionStatus = z.infer<typeof versionStatusSchema>;
export const materialCategorySchema = z.enum(['PRODUCT', 'DATA', 'BACKEND', 'FRONTEND', 'TEST', 'DESIGN', 'OTHER']);
export const materialStatusSchema = z.enum(['PROCESSING', 'READY', 'FAILED']);
export const materialPreviewKindSchema = z.enum(['IMAGE', 'PDF', 'TEXT']);
export type MaterialCategory = z.infer<typeof materialCategorySchema>;
export type MaterialStatus = z.infer<typeof materialStatusSchema>;
export type MaterialPreviewKind = z.infer<typeof materialPreviewKindSchema>;

export const projectInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2000).optional().default('')
});

export const assetInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2000).optional().default(''),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional().default([])
});

export const versionMetadataInputSchema = z.object({
  note: z.string().max(2000),
  changeContent: z.string().max(20000).optional()
});

export const materialMetadataInputSchema = z.object({
  displayName: z.string().trim().min(1).max(180).optional(),
  category: materialCategorySchema.optional(),
  tags: z.array(z.string().trim().min(1).max(30)).max(10).optional()
}).refine(value => Object.keys(value).length > 0, '至少提供一个修改字段');

export const loginSchema = z.object({ username: z.string().min(1), password: z.string().min(1) });

export type ProjectInput = z.infer<typeof projectInputSchema>;
export type AssetInput = z.infer<typeof assetInputSchema>;
export type VersionMetadataInput = z.infer<typeof versionMetadataInputSchema>;
export type MaterialMetadataInput = z.infer<typeof materialMetadataInputSchema>;

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
      MaterialCategory: { type: 'string', enum: materialCategorySchema.options },
      MaterialStatus: { type: 'string', enum: materialStatusSchema.options },
      ProjectInput: { type: 'object', required: ['name'], properties: { name: { type: 'string', maxLength: 120 }, description: { type: 'string', maxLength: 2000 } } },
      AssetInput: { type: 'object', required: ['name'], properties: { name: { type: 'string', maxLength: 120 }, description: { type: 'string', maxLength: 2000 }, tags: { type: 'array', maxItems: 20, items: { type: 'string' } } } },
      VersionMetadataInput: { type: 'object', required: ['note'], properties: { note: { type: 'string', maxLength: 2000 }, changeContent: { type: 'string', maxLength: 20000, description: '经过安全清洗的版本变更富文本' } } },
      MaterialMetadataInput: { type: 'object', properties: { displayName: { type: 'string', maxLength: 180 }, category: { $ref: '#/components/schemas/MaterialCategory' }, tags: { type: 'array', maxItems: 10, items: { type: 'string', maxLength: 30 } } } }
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
    '/api/v1/assets/{assetId}/icon': { get: secured('读取原型资产图标'), post: secured('上传原型资产图标'), delete: secured('删除原型资产图标') },
    '/api/v1/assets/{assetId}/versions': { get: secured('版本列表'), post: secured('上传 HTML/ZIP 版本') },
    '/api/v1/versions/{versionId}': { get: secured('版本详情'), patch: secured('更新版本备注'), delete: secured('删除未引用版本') },
    '/api/v1/versions/{versionId}/set-preview': { post: secured('设置当前预览版') },
    '/api/v1/versions/{versionId}/set-release': { post: secured('设置当前发布版') },
    '/api/v1/versions/{versionId}/preview-token': { get: secured('生成短期预览地址') },
    '/api/v1/versions/{versionId}/workspace': { get: secured('版本工作空间') },
    '/api/v1/versions/{versionId}/materials': { get: secured('版本材料列表'), post: secured('上传迭代材料') },
    '/api/v1/materials/{materialId}': { get: secured('材料详情'), patch: secured('更新材料元数据'), delete: secured('移入回收站') },
    '/api/v1/materials/{materialId}/restore': { post: secured('恢复材料') },
    '/api/v1/materials/{materialId}/permanent': { delete: secured('永久删除材料') },
    '/api/v1/materials/{materialId}/retry-preview': { post: secured('重试材料预览') },
    '/api/v1/materials/{materialId}/preview': { get: secured('预览材料') },
    '/api/v1/materials/{materialId}/download': { get: secured('下载材料原文件') },
    '/api/v1/materials/search': { get: secured('检索迭代材料') },
    '/api/v1/search': { get: secured('检索项目、资产、标签和 HTML 文本') }
  }
} as const;
