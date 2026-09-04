ALTER TABLE "PrototypeVersion"
ADD COLUMN "change_content" TEXT NOT NULL DEFAULT '';

CREATE INDEX "PrototypeVersion_change_content_trgm_idx"
ON "PrototypeVersion" USING GIN ("change_content" gin_trgm_ops);
