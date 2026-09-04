import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().default('postgresql://prototype:prototype@localhost:5432/prototype_hub?schema=public'),
  S3_ENDPOINT: z.string().default('http://localhost:9000'),
  S3_REGION: z.string().default('us-east-1'),
  S3_ACCESS_KEY: z.string().default('minioadmin'),
  S3_SECRET_KEY: z.string().default('minioadmin'),
  S3_BUCKET: z.string().default('prototype-assets'),
  SESSION_SECRET: z.string().min(16).default('local-development-session-secret'),
  PREVIEW_SECRET: z.string().min(16).default('local-development-preview-secret'),
  ADMIN_USERNAME: z.string().default('admin'),
  ADMIN_PASSWORD: z.string().min(8).default('admin123456'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  WEB_ORIGIN: z.string().default('http://localhost:3000'),
  PREVIEW_ORIGIN: z.string().url().default('http://localhost:4000'),
  COOKIE_SECURE: z.enum(['true', 'false']).default('false').transform(value => value === 'true'),
  UPLOAD_MAX_BYTES: z.coerce.number().int().positive().default(100 * 1024 * 1024),
  EXTRACTED_MAX_BYTES: z.coerce.number().int().positive().default(500 * 1024 * 1024),
  MAX_FILES: z.coerce.number().int().positive().default(5000)
});

export const config = envSchema.parse(process.env);
