# Prototype Hub 架构说明

## 组件

- `apps/web`：Next.js 管理端，负责登录、项目/资产管理、版本工作空间、材料管理、搜索和 iframe 预览容器。
- `apps/api`：Fastify REST API，负责认证、业务权限、元数据、上传/下载入口、签名 Token 和预览代理。
- `apps/worker`：轮询 PostgreSQL 中待处理的原型版本和迭代材料，处理 HTML/ZIP、Office/PDF/文本预览并生成搜索索引。
- `packages/db`：Prisma 数据模型和显式 SQL migration。
- `packages/storage`：MinIO、S3、OSS、COS 可复用的 S3 适配层。
- `packages/contracts`：前后端共享的 Zod 输入与状态类型。

登录后可通过 `/api/v1/openapi.json` 获取核心 REST 接口的 OpenAPI 3.0 文档。

原型资产元数据可编辑，图标通过独立的受认证接口上传和读取。数据库只保存 `icon_key`，图片内容存储在对象存储的 `asset-icons/{projectId}/{assetId}/` 前缀下；替换、移除或删除资产时同步清理旧对象。

## 上传数据流

1. API 校验扩展名、文件签名和 100MB 上限，将原文件写入对象存储。
2. API 计算并保存原件 SHA-256；事务内先原子递增资产的 `last_version_no`（行锁串行分配），再选择并保存实际比较基线，创建 `PROCESSING` 版本。失败则回滚计数。删除版本不降低计数。
3. Worker 原子设置 `processing_started_at` 领取任务；15 分钟未完成的任务允许恢复处理。
4. Worker 校验 ZIP 路径、符号链接、文件数与解压体积，然后逐文件写入版本专属前缀。
5. Worker 生成 `manifest.json`，提取 HTML 可见文本，将版本设为 `READY`；首个成功版本自动成为预览版。
6. 处理失败时版本设为 `FAILED`，保留原始上传以便追查，并删除可能已写入的半成品预览文件。

## 版本工作空间与材料数据流

1. 时间线整行进入 `/versions/{versionId}`；版本操作按钮阻止行跳转，分别负责变更抽屉、原型预览和版本管理。
2. Web 将批量选择的文件拆成单文件请求，以固定并发数 3 上传。每个文件有独立队列状态，失败不会中断其他文件。
3. API 校验所有权、100MB 上限、扩展名、浏览器 MIME、文件签名与 UTF-8 文本编码，并拦截 OOXML/OLE 宏内容；随后在 Serializable 事务中检查每版本 100 个材料和 1GB 总容量。
4. API 把原件写入 `materials/{projectId}/{assetId}/{versionId}/{materialId}/original.{ext}`，创建 `PROCESSING` 记录并返回 `202`。
5. Worker 领取任务：图片直接使用原件预览，PDF 提取文本，Markdown 生成白名单清洗后的 HTML，TXT 安全返回纯文本，Office 由 LibreOffice Headless 转为 PDF 后提取文字。
6. 预览衍生物写入同一材料前缀，成功状态为 `READY`；转换失败为 `FAILED`，保留原件以便下载和重试。

材料容器以非 root 用户运行，根文件系统只读，只有独立 `/tmp` 可写，并移除 Linux capabilities。转换有超时和容器内存/CPU限制，不依赖第三方在线预览服务。

材料内容不可覆盖，只允许修改显示名称、分类和标签。活动名称通过数据库部分唯一索引实现不区分大小写唯一；并发重名上传遇到事务冲突时重新计算 `(2)/(3)` 名称。普通删除只设置 `deleted_at`，30 天内可恢复；Worker 定期永久删除到期对象与记录。删除上层版本、资产或项目时直接级联清理全部材料和预览衍生物。

## 不可变与一致性

- 版本内容、入口路径和版本号创建后不提供修改接口；上传备注和版本变更富文本属于管理元数据，允许修订但不影响版本工件。富文本写入前由 API 按标签白名单清洗，管理端只渲染清洗后的内容。
- `preview_version_id` 和 `release_version_id` 是资产上的可变指针，回滚只是重新指向历史 `READY` 版本。预览指针用于内部验收候选，发布指针用于稳定共享入口。
- `base_version_id` 关联同一原型的成功版本，`base_version_no` 保存当时编号，`baseline_recorded` 区分历史未知与明确无基线。删除基线时关联设空、编号保留；读取时不再以版本号减一推断。
- 当前发布原型只固定原型版本，不固定工作资料；发布快照与整套回滚在第四期实现。
- `GET /api/v1/versions/{versionId}/download` 校验登录和所有权后流式返回原件，不依赖预览成功。使用 UTF-8 附件文件名，旧文件名缺失时回退为 `prototype-v{版本号}.{原扩展名}`。
- 时间线排序和状态筛选只改变前端展示，不持久化顺序，也不会改变递增版本号。
- 当前预览版或发布版不能删除；删除普通版本、资产或项目时同步清理原型和材料对象存储。
- 项目资产列表的“查看发布原型”只使用 `release_version_id`，不会用最新版本或预览版本代替。
- PostgreSQL 是元数据事实来源，对象存储 Key 始终带 project、asset、version 三层 ID。

## 预览隔离

- 管理端 `localhost:8080` 与预览内容 `preview.localhost:8080` 使用不同来源，Caddy 不允许预览来源访问管理端页面。
- API 使用 HMAC-SHA256 生成一小时有效的版本 Token，Token 与 version ID 绑定。
- iframe 不包含 `allow-same-origin`，原型脚本不能读取平台 DOM、Cookie 或 localStorage。
- 静态响应带 CSP、`nosniff`、无 referrer 和私有短缓存；对象存储 bucket 不公开。

## 检索

PostgreSQL migration 启用 `pg_trgm`，为项目、资产、版本文字/备注、材料名称、材料正文和标签建立 GIN 索引。全局搜索并行查询原型资产和迭代材料，并按两组展示；材料可按项目、资产、版本、分类和标签筛选。原型结果以 `matchType=ASSET|VERSION` 区分资产信息命中与版本内容命中：`ASSET` 进入资产详情，`VERSION` 携带真实 `matchedVersion` 并进入该版本工作空间。状态过滤作用于实际命中的版本。无关键词时只返回资产；有关键词时资产信息结果排在版本结果前，两者合计最多 100 条。材料组也最多 100 条，分页在第五期实现。前端分别显示两组检索错误并防止旧请求覆盖新结果。
