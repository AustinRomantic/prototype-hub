# Prototype Hub

本地优先的 HTML/ZIP 原型资产平台，将产品原型按“项目 → 资产 → 不可变版本 → 迭代材料”管理，并提供隔离预览、发布/预览版本指针和全文检索。

原型资产支持名称、描述、标签和独立图标维护；项目页可直接打开资产当前选定的发布版本。每个原型版本都有独立工作空间，可归档并预览产品、数据、后端、前端、测试和设计材料。

## 产品规划

现状评估、目标资产模型、功能需求与验收标准见 [产品规划 PRD](docs/PRODUCT_PRD.md)；建议交付顺序与待办清单见 [迭代路线](docs/PRODUCT_ROADMAP.md)。两份文档均为规划建议，新增能力尚未实施。

## 一键启动

前置条件：Mac 上安装 Docker Desktop，并确保 8080、55432、9000、9001 端口未被占用。PostgreSQL 映射到宿主机 55432，容器内部仍使用标准 5432。

```bash
cp .env.example .env
docker compose -f infra/docker-compose.yml up --build
```

Worker 镜像包含 LibreOffice、PDF 工具和中文字体，首次构建下载量较大，后续会复用 Docker 缓存。
Dockerfile 默认使用国内镜像安装 Node 依赖、Prisma 引擎和 Alpine 转换工具；如需改用其他源，可传入 `NPM_REGISTRY`、`PRISMA_ENGINES_MIRROR` 或 `APK_MIRROR` build arg。

启动完成后：

- 管理端：`http://localhost:8080`
- 隔离预览域：`http://preview.localhost:8080`
- MinIO 控制台：`http://localhost:9001`
- 默认管理账号：`.env` 中的 `ADMIN_USERNAME` / `ADMIN_PASSWORD`

首次启动前请修改 `.env` 中的管理员密码、`SESSION_SECRET` 和 `PREVIEW_SECRET`。停止服务使用：

```bash
docker compose -f infra/docker-compose.yml down
```

不要使用 `down -v`，除非确认要同时删除 PostgreSQL 与 MinIO 的持久化数据。

## 本地开发

先启动基础设施：

```bash
docker compose -f infra/docker-compose.yml up -d postgres minio
env 'DATABASE_URL=postgresql://prototype:prototype@localhost:55432/prototype_hub?schema=public' pnpm db:migrate
pnpm db:generate
pnpm dev
```

开发入口为 `http://localhost:3000`；Next.js 会将 `/api` 转发到 `http://localhost:4000`，预览也由 4000 端口提供。

## 常用检查

```bash
pnpm typecheck
pnpm test
pnpm build
```

## 数据与安全边界

- 原始上传和解压后的预览内容保存在 S3 兼容对象存储，不依赖宿主机业务路径。
- HTML/ZIP 上传后生成不可变版本：文件内容、版本号和入口路径不能修改，管理备注可以修订。版本列表支持状态筛选和正/倒序查看，但不会改写历史顺序。
- 预览版用于内部验收和测试，可以频繁切换；发布版是已确认的稳定版本，也是项目页“查看发布版”的固定入口。
- 只有未被预览版或发布版指针引用的版本才能删除，删除时同步清理原始包和预览文件。
- 上传版本时可选填受限富文本格式的“版本变更内容”，用于记录相较上一版本的变化；时间线可通过整行或“查看变更”在右侧抽屉阅读，并支持后续修订。
- 点击版本时间线整行进入版本工作空间；“查看变更”“打开此版本”“管理”仍保持各自独立操作，不会误触页面跳转。
- 版本材料支持 PDF、DOC/DOCX、XLS/XLSX、PPT/PPTX、PNG/JPEG/WebP、Markdown 和 UTF-8 TXT。Office 文件由隔离 Worker 转为 PDF，下载始终返回未经转换的原文件。
- Office 上传会拒绝宏扩展名，并检查 OOXML 的 `vbaProject` 内容与旧版 OLE 宏目录，防止仅改扩展名绕过限制。
- 材料原文件不可覆盖，可修改显示名称、分类和标签。同版本活动材料名称不区分大小写唯一，重复上传会自动追加 `(2)`。
- 单个材料最大 100MB，每个版本最多 100 个材料、原文件总量最大 1GB；回收站仍计入限额。软删除文件保留 30 天，可恢复或提前永久删除。
- 图片不做 OCR；可搜索材料名称、标签及 PDF/Office/Markdown/TXT 中提取出的文字。
- 资产图标支持 PNG、JPEG、WebP，默认最大 2MB，保存在同一套 S3 兼容对象存储中。
- ZIP 拒绝目录穿越、绝对路径、符号链接、服务端可执行文件、超量文件和解压炸弹。
- 预览使用短期签名 URL，并运行在独立来源和 sandbox iframe 中。
- 上传内容只按静态资源返回，不执行 PHP、Shell 等服务端代码。
- 当前 CSP 禁止原型主动发起网络请求；如未来需要真实 API 联调，应通过白名单配置扩展，不能直接放开。

## 备份与恢复

数据库备份：

```bash
docker compose -f infra/docker-compose.yml exec -T postgres pg_dump -U prototype -d prototype_hub -Fc > prototype-hub-db.dump
```

MinIO 数据保存在 Docker volume `minio_data`，其中包括原型源文件、预览文件、资产图标以及 `materials/` 下的材料原件和预览衍生物。生产迁云时应使用对象存储自带的版本控制和生命周期策略；本地可通过 MinIO Client 将 `prototype-assets` bucket 镜像到备份目录。数据库和对象存储必须使用同一备份时间点恢复，避免版本记录与文件不一致。

## 云迁移

应用只依赖 PostgreSQL 和 S3 协议。迁移云服务器时替换 `DATABASE_URL`、`S3_*`、域名与 HTTPS 配置即可；将 `COOKIE_SECURE=true`，并把 `WEB_ORIGIN`、`PREVIEW_ORIGIN` 配成两个不同的 HTTPS 来源。

更完整的模块、数据流和安全说明见 [架构文档](docs/ARCHITECTURE.md)。
