CREATE TYPE "MaterialCategory" AS ENUM ('PRODUCT', 'DATA', 'BACKEND', 'FRONTEND', 'TEST', 'DESIGN', 'OTHER');
CREATE TYPE "MaterialStatus" AS ENUM ('PROCESSING', 'READY', 'FAILED');
CREATE TYPE "MaterialPreviewKind" AS ENUM ('IMAGE', 'PDF', 'TEXT');

CREATE TABLE "VersionMaterial" (
  "id" TEXT NOT NULL,
  "version_id" TEXT NOT NULL,
  "category" "MaterialCategory" NOT NULL DEFAULT 'OTHER',
  "display_name" TEXT NOT NULL,
  "original_file_name" TEXT NOT NULL,
  "extension" TEXT NOT NULL,
  "mime_type" TEXT NOT NULL,
  "source_key" TEXT NOT NULL,
  "preview_key" TEXT,
  "preview_kind" "MaterialPreviewKind" NOT NULL,
  "status" "MaterialStatus" NOT NULL DEFAULT 'PROCESSING',
  "size_bytes" BIGINT NOT NULL,
  "checksum" TEXT NOT NULL,
  "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "extracted_text" TEXT NOT NULL DEFAULT '',
  "error_message" TEXT,
  "processing_started_at" TIMESTAMP(3),
  "deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VersionMaterial_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "VersionMaterial_version_id_deleted_at_created_at_idx" ON "VersionMaterial"("version_id", "deleted_at", "created_at");
CREATE INDEX "VersionMaterial_status_processing_started_at_idx" ON "VersionMaterial"("status", "processing_started_at");
CREATE UNIQUE INDEX "VersionMaterial_active_name_key" ON "VersionMaterial"("version_id", LOWER("display_name")) WHERE "deleted_at" IS NULL;
CREATE INDEX "VersionMaterial_display_name_trgm_idx" ON "VersionMaterial" USING GIN ("display_name" gin_trgm_ops);
CREATE INDEX "VersionMaterial_original_name_trgm_idx" ON "VersionMaterial" USING GIN ("original_file_name" gin_trgm_ops);
CREATE INDEX "VersionMaterial_extracted_text_trgm_idx" ON "VersionMaterial" USING GIN ("extracted_text" gin_trgm_ops);
CREATE INDEX "VersionMaterial_tags_idx" ON "VersionMaterial" USING GIN ("tags");

ALTER TABLE "VersionMaterial" ADD CONSTRAINT "VersionMaterial_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "PrototypeVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
