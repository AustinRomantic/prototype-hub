CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TYPE "VersionStatus" AS ENUM ('PROCESSING', 'READY', 'FAILED');

CREATE TABLE "User" (
  "id" TEXT NOT NULL,
  "username" TEXT NOT NULL,
  "password_hash" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

CREATE TABLE "Session" (
  "id" TEXT NOT NULL,
  "token_hash" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Session_token_hash_key" ON "Session"("token_hash");
CREATE INDEX "Session_expires_at_idx" ON "Session"("expires_at");

CREATE TABLE "Project" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "owner_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Project_slug_key" ON "Project"("slug");
CREATE INDEX "Project_owner_id_updated_at_idx" ON "Project"("owner_id", "updated_at");

CREATE TABLE "PrototypeAsset" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "preview_version_id" TEXT,
  "release_version_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PrototypeAsset_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PrototypeAsset_preview_version_id_key" ON "PrototypeAsset"("preview_version_id");
CREATE UNIQUE INDEX "PrototypeAsset_release_version_id_key" ON "PrototypeAsset"("release_version_id");
CREATE UNIQUE INDEX "PrototypeAsset_project_id_slug_key" ON "PrototypeAsset"("project_id", "slug");
CREATE INDEX "PrototypeAsset_project_id_updated_at_idx" ON "PrototypeAsset"("project_id", "updated_at");

CREATE TABLE "PrototypeVersion" (
  "id" TEXT NOT NULL,
  "asset_id" TEXT NOT NULL,
  "version_no" INTEGER NOT NULL,
  "status" "VersionStatus" NOT NULL DEFAULT 'PROCESSING',
  "entry_path" TEXT NOT NULL DEFAULT 'index.html',
  "source_key" TEXT NOT NULL,
  "preview_prefix" TEXT NOT NULL,
  "checksum" TEXT NOT NULL DEFAULT '',
  "size_bytes" BIGINT NOT NULL DEFAULT 0,
  "file_count" INTEGER NOT NULL DEFAULT 0,
  "extracted_text" TEXT NOT NULL DEFAULT '',
  "note" TEXT NOT NULL DEFAULT '',
  "error_message" TEXT,
  "processing_started_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PrototypeVersion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PrototypeVersion_asset_id_version_no_key" ON "PrototypeVersion"("asset_id", "version_no");
CREATE INDEX "PrototypeVersion_status_created_at_idx" ON "PrototypeVersion"("status", "created_at");
CREATE INDEX "Project_name_trgm_idx" ON "Project" USING GIN ("name" gin_trgm_ops);
CREATE INDEX "Project_description_trgm_idx" ON "Project" USING GIN ("description" gin_trgm_ops);
CREATE INDEX "PrototypeAsset_name_trgm_idx" ON "PrototypeAsset" USING GIN ("name" gin_trgm_ops);
CREATE INDEX "PrototypeAsset_description_trgm_idx" ON "PrototypeAsset" USING GIN ("description" gin_trgm_ops);
CREATE INDEX "PrototypeVersion_text_trgm_idx" ON "PrototypeVersion" USING GIN ("extracted_text" gin_trgm_ops);
CREATE INDEX "PrototypeVersion_note_trgm_idx" ON "PrototypeVersion" USING GIN ("note" gin_trgm_ops);

CREATE TABLE "Tag" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Tag_name_key" ON "Tag"("name");
CREATE INDEX "Tag_name_trgm_idx" ON "Tag" USING GIN ("name" gin_trgm_ops);

CREATE TABLE "AssetTag" (
  "asset_id" TEXT NOT NULL,
  "tag_id" TEXT NOT NULL,
  CONSTRAINT "AssetTag_pkey" PRIMARY KEY ("asset_id", "tag_id")
);

ALTER TABLE "Session" ADD CONSTRAINT "Session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Project" ADD CONSTRAINT "Project_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PrototypeAsset" ADD CONSTRAINT "PrototypeAsset_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PrototypeVersion" ADD CONSTRAINT "PrototypeVersion_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "PrototypeAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PrototypeAsset" ADD CONSTRAINT "PrototypeAsset_preview_version_id_fkey" FOREIGN KEY ("preview_version_id") REFERENCES "PrototypeVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PrototypeAsset" ADD CONSTRAINT "PrototypeAsset_release_version_id_fkey" FOREIGN KEY ("release_version_id") REFERENCES "PrototypeVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AssetTag" ADD CONSTRAINT "AssetTag_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "PrototypeAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AssetTag" ADD CONSTRAINT "AssetTag_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
