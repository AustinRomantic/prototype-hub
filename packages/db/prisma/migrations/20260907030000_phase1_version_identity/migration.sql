-- Preserve existing version numbers. Previously deleted numbers cannot be inferred
-- from the current rows; review backup/log evidence before applying this migration.
ALTER TABLE "PrototypeAsset" ADD COLUMN "last_version_no" INTEGER NOT NULL DEFAULT 0;
UPDATE "PrototypeAsset" a SET "last_version_no" = COALESCE(
  (SELECT MAX(v."version_no") FROM "PrototypeVersion" v WHERE v."asset_id" = a."id"), 0
);
ALTER TABLE "PrototypeVersion"
  ADD COLUMN "base_version_id" TEXT,
  ADD COLUMN "base_version_no" INTEGER,
  ADD COLUMN "baseline_recorded" BOOLEAN NOT NULL DEFAULT false;
-- A snapshot of the baseline number survives deletion of the baseline file.
ALTER TABLE "PrototypeVersion" ADD CONSTRAINT "PrototypeVersion_base_version_id_fkey"
  FOREIGN KEY ("base_version_id") REFERENCES "PrototypeVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "PrototypeVersion_base_version_id_idx" ON "PrototypeVersion"("base_version_id");
