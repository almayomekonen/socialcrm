import { S3Client } from '@aws-sdk/client-s3'

if (typeof process !== 'undefined' && process.env) {
  console.info(
    '[upload] s3.boot',
    JSON.stringify({
      region: process.env.AWS_DEFAULT_REGION ?? null,
      accessKeyId: Boolean(process.env.AWS_ACCESS_KEY_ID),
      secretAccessKey: Boolean(process.env.AWS_SECRET_ACCESS_KEY),
      bucket: process.env.S3_BUCKET_NAME ?? null,
    }),
  )
}

export const s3 = new S3Client({
  region: process.env.AWS_DEFAULT_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
})

export const s3PublicUrl = 'https://socialcrm-storage.s3.eu-north-1.amazonaws.com/'
