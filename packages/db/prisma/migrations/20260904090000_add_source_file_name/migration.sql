ALTER TABLE "PrototypeVersion" ADD COLUMN "source_file_name" TEXT;

CREATE INDEX "PrototypeVersion_source_file_name_trgm_idx"
ON "PrototypeVersion" USING GIN ("source_file_name" gin_trgm_ops);
