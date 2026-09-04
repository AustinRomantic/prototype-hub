# Prototype Hub 架构说明

## 组件

- `apps/web`：Next.js 管理端，负责登录、项目/资产管理、上传、版本时间线、搜索和 iframe 预览容器。
- `apps/api`：Fastify REST API，负责认证、业务权限、元数据、上传入口、签名 Token 和静态预览代理。
- `apps/worker`：轮询 PostgreSQL 中待处理版本，安全解析 HTML/ZIP，上传预览资源并生成文本索引与 manifest。
- `packages/db`：Prisma 数据模型和显式 SQL migration。
- `packages/storage`：MinIO、S3、OSS、COS 可复用的 S3 适配层。
- `packages/contracts`：前后端共享的 Zod 输入与状态类型。

登录后可通过 `/api/v1/openapi.json` 获取核心 REST 接口的 OpenAPI 3.0 文档。

原型资产元数据可编辑，图标通过独立的受认证接口上传和读取。数据库只保存 `icon_key`，图片内容存储在对象存储的 `asset-icons/{projectId}/{assetId}/` 前缀下；替换、移除或删除资产时同步清理旧对象。

## 上传数据流

1. API 校验扩展名、文件签名和 100MB 上限，将原文件写入对象存储。
2. API 在 Serializable 事务中创建递增版本号，状态为 `PROCESSING`。
3. Worker 原子设置 `processing_started_at` 领取任务；15 分钟未完成的任务允许恢复处理。
4. Worker 校验 ZIP 路径、符号链接、文件数与解压体积，然后逐文件写入版本专属前缀。
5. Worker 生成 `manifest.json`，提取 HTML 可见文本，将版本设为 `READY`；首个成功版本自动成为预览版。
6. 处理失败时版本设为 `FAILED`，保留原始上传以便追查，并删除可能已写入的半成品预览文件。

## 不可变与一致性

- 版本内容、入口路径和版本号创建后不提供修改接口；上传备注属于管理元数据，允许修订但不影响版本工件。
- `preview_version_id` 和 `release_version_id` 是资产上的可变指针，回滚只是重新指向历史 `READY` 版本。预览指针用于内部验收候选，发布指针用于稳定共享入口。
- 时间线排序和状态筛选只改变前端展示，不持久化顺序，也不会改变递增版本号。
- 当前预览版或发布版不能删除；删除普通版本、资产或项目时同步清理对象存储。
- 项目资产列表的“查看发布版”只使用 `release_version_id`，不会用最新版本或预览版本代替。
- PostgreSQL 是元数据事实来源，对象存储 Key 始终带 project、asset、version 三层 ID。

## 预览隔离

- 管理端 `localhost:8080` 与预览内容 `preview.localhost:8080` 使用不同来源，Caddy 不允许预览来源访问管理端页面。
- API 使用 HMAC-SHA256 生成一小时有效的版本 Token，Token 与 version ID 绑定。
- iframe 不包含 `allow-same-origin`，原型脚本不能读取平台 DOM、Cookie 或 localStorage。
- 静态响应带 CSP、`nosniff`、无 referrer 和私有短缓存；对象存储 bucket 不公开。

## 检索

PostgreSQL migration 启用 `pg_trgm`，为项目、资产、版本文字/备注和标签建立 GIN 索引。API 支持关键词、项目、标签、版本状态和创建时间筛选；当前限制返回 100 条，未来可在保持接口语义的情况下替换为 OpenSearch。
