import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'

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

// User-uploaded chat attachments (images/PDFs) — see supabase attachments table.
export async function putUpload(key: string, body: Buffer, contentType: string): Promise<void> {
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

// Fetches an uploaded attachment's bytes — used server-side to inline the
// file as base64 into the LLM request (never proxied/presigned to the client).
export async function getUpload(key: string): Promise<Buffer> {
  const c = useRuntimeConfig()
  const res = await client().send(new GetObjectCommand({ Bucket: c.s3Bucket as string, Key: key }))
  return Buffer.from(await res.Body!.transformToByteArray())
}
