import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'

// S3 writer for behavior logs + optional HTML/screenshot snapshots. SERVER ONLY.
let _s3: S3Client | null = null

function client(): S3Client {
  const c = useRuntimeConfig()
  if (!_s3) {
    _s3 = new S3Client({
      region: c.awsRegion as string,
      credentials: {
        accessKeyId: c.awsAccessKeyId as string,
        secretAccessKey: c.awsSecretAccessKey as string,
      },
    })
  }
  return _s3
}

export async function putLogBatch(key: string, ndjson: string): Promise<void> {
  const c = useRuntimeConfig()
  await client().send(
    new PutObjectCommand({
      Bucket: c.s3Bucket as string,
      Key: key,
      Body: ndjson,
      ContentType: 'application/x-ndjson',
    }),
  )
}

export async function putSnapshot(
  key: string,
  body: Uint8Array | string,
  contentType: string,
): Promise<void> {
  const c = useRuntimeConfig()
  await client().send(
    new PutObjectCommand({
      Bucket: c.s3Bucket as string,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  )
}
