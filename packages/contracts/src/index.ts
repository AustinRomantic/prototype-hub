import { z } from 'zod';

export const versionStatusSchema = z.enum(['PROCESSING', 'READY', 'FAILED']);
export type VersionStatus = z.infer<typeof versionStatusSchema>;
export const versionUploadMetadataSchema = z.object({
  note: z.string().max(2000).default(''),
  changeContent: z.string().max(20000).default(''),
  // Omitted: latest READY at creation time. Null: deliberately no baseline.
  baseVersionId: z.string().trim().min(1).max(128).nullable().optional()
});
export type VersionBaseline = { baselineRecorded: boolean; baseVersionId: string | null; baseVersionNo: number | null };
export function versionBaselineLabel(version: VersionBaseline) {
  if (!version.baselineRecorded) return '比较基线：未记录';
  if (version.baseVersionNo === null) return '比较基线：无';
  return `比较基线：v${version.baseVersionNo}${version.baseVersionId ? '' : '（原版本已删除）'}`;
}
export const versionStatusLabel = (status: string) => status === 'READY' ? '可预览' : status === 'PROCESSING' ? '原件已保存 · 预览处理中' : status === 'FAILED' ? '原件已保存 · 预览失败' : '状态未知';
export type SearchVersion = { id: string; versionNo: number; status: VersionStatus; sourceFileName: string | null; createdAt: Date | string };
export type PrototypeSearchResult = {
  id: string; name: string; description: string; project: { id: string; name: string };
  tags: { tag: { name: string } }[]; versions: SearchVersion[];
} & ({ matchType: 'ASSET'; matchedVersion: null } | { matchType: 'VERSION'; matchedVersion: SearchVersion });
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
      VersionUploadMetadata: { type: 'object', properties: { note: { type: 'string', maxLength: 2000 }, changeContent: { type: 'string', maxLength: 20000 }, baseVersionId: { type: 'string', nullable: true, description: '同原型 READY 版本 ID；省略为最近成功版本，multipart 空字符串为无基线' } } },
      VersionBaseline: { type: 'object', properties: { baselineRecorded: { type: 'boolean' }, baseVersionId: { type: 'string', nullable: true }, baseVersionNo: { type: 'integer', nullable: true, description: '基线编号快照，删除基线后保留' } } },
      SearchVersion: { type: 'object', properties: { id: { type: 'string' }, versionNo: { type: 'integer' }, status: { $ref: '#/components/schemas/VersionStatus' }, sourceFileName: { type: 'string', nullable: true }, createdAt: { type: 'string', format: 'date-time' } } },
      PrototypeSearchResult: { type: 'object', required: ['id', 'matchType', 'matchedVersion'], properties: { id: { type: 'string', description: '原型资产 ID' }, matchType: { type: 'string', enum: ['ASSET', 'VERSION'] }, matchedVersion: { allOf: [{ $ref: '#/components/schemas/SearchVersion' }], nullable: true }, versions: { type: 'array', items: { $ref: '#/components/schemas/SearchVersion' } } } },
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
    '/api/v1/assets/{assetId}/versions': { get: secured('版本列表（包含基线记录）'), post: {
      ...secured('上传 HTML/ZIP 版本并记录比较基线'),
      parameters: [{ name: 'assetId', in: 'path', required: true, schema: { type: 'string' } }],
      requestBody: { required: true, content: { 'multipart/form-data': { schema: {
        type: 'object', required: ['file'], properties: {
          file: { type: 'string', format: 'binary' }, entryPath: { type: 'string', default: 'index.html' },
          note: { type: 'string', maxLength: 2000 }, changeContent: { type: 'string', maxLength: 20000 },
          baseVersionId: { type: 'string', description: '省略时选择最近 READY 版本；空字符串表示无基线；非空必须是同原型 READY 版本 ID。字段在 file 前提交。' }
        }
      } } } },
      responses: { '202': { description: '原件已保存，预览待处理；返回版本 ID、versionNo、checksum 和基线记录' }, '400': { description: '输入无效' }, '401': { description: '未登录' }, '404': { description: '原型不存在或无权访问' }, '409': { description: '基线不存在、不属于该原型或不是 READY' }, '413': { description: '文件超过限制' } }
    } },
    '/api/v1/versions/{versionId}': { get: secured('版本详情'), patch: secured('更新版本备注'), delete: secured('删除未引用版本') },
    '/api/v1/versions/{versionId}/set-preview': { post: secured('设置当前预览版') },
    '/api/v1/versions/{versionId}/set-release': { post: secured('设置当前发布原型，不固定工作材料') },
    '/api/v1/versions/{versionId}/preview-token': { get: secured('生成短期预览地址') },
    '/api/v1/versions/{versionId}/download': { get: { ...secured('下载最初上传的 HTML/ZIP，预览失败也可下载'), parameters: [{ name: 'versionId', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: '原件附件', content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } } }, '401': { description: '未登录' }, '404': { description: '版本或原件不存在/无权访问' }, '503': { description: '存储暂不可用' } } } },
    '/api/v1/versions/{versionId}/workspace': { get: secured('版本工作空间') },
    '/api/v1/versions/{versionId}/materials': { get: secured('版本材料列表'), post: secured('上传迭代材料') },
    '/api/v1/materials/{materialId}': { get: secured('材料详情'), patch: secured('更新材料元数据'), delete: secured('移入回收站') },
    '/api/v1/materials/{materialId}/restore': { post: secured('恢复材料') },
    '/api/v1/materials/{materialId}/permanent': { delete: secured('永久删除材料') },
    '/api/v1/materials/{materialId}/retry-preview': { post: secured('重试材料预览') },
    '/api/v1/materials/{materialId}/preview': { get: secured('预览材料') },
    '/api/v1/materials/{materialId}/download': { get: secured('下载材料原文件') },
    '/api/v1/materials/search': { get: secured('检索迭代材料') },
    '/api/v1/search': { get: { ...secured('分别返回资产信息命中和实际版本内容命中；最多 100 项'), responses: { '200': { description: '按 matchType 导航：ASSET 进入资产，VERSION 进入 matchedVersion', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/PrototypeSearchResult' } } } } }, '401': { description: '未登录' } } } }
  }
} as const;
