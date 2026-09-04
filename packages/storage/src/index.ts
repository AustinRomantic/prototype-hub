import {
  CreateBucketCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type BucketLocationConstraint
} from '@aws-sdk/client-s3';
import { config } from '@prototype-hub/config';

export const s3 = new S3Client({
  endpoint: config.S3_ENDPOINT,
  region: config.S3_REGION,
  forcePathStyle: true,
  credentials: { accessKeyId: config.S3_ACCESS_KEY, secretAccessKey: config.S3_SECRET_KEY }
});

export async function ensureBucket() {
  try { await s3.send(new HeadBucketCommand({ Bucket: config.S3_BUCKET })); }
  catch {
    await s3.send(new CreateBucketCommand({
      Bucket: config.S3_BUCKET,
      ...(config.S3_REGION === 'us-east-1' ? {} : { CreateBucketConfiguration: { LocationConstraint: config.S3_REGION as BucketLocationConstraint } })
    }));
  }
}

export async function putObject(key: string, body: Uint8Array | Buffer | string, contentType = 'application/octet-stream') {
  await s3.send(new PutObjectCommand({ Bucket: config.S3_BUCKET, Key: key, Body: body, ContentType: contentType }));
}

export async function getObject(key: string) {
  return s3.send(new GetObjectCommand({ Bucket: config.S3_BUCKET, Key: key }));
}

export async function deleteObject(key: string) {
  await s3.send(new DeleteObjectCommand({ Bucket: config.S3_BUCKET, Key: key }));
}

export async function deletePrefix(prefix: string) {
  let continuationToken: string | undefined;
  do {
    const page = await s3.send(new ListObjectsV2Command({ Bucket: config.S3_BUCKET, Prefix: prefix, ContinuationToken: continuationToken }));
    const objects = (page.Contents ?? []).flatMap(item => item.Key ? [{ Key: item.Key }] : []);
    if (objects.length) await s3.send(new DeleteObjectsCommand({ Bucket: config.S3_BUCKET, Delete: { Objects: objects, Quiet: true } }));
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);
}
