import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getConfig } from "../config";

const config = getConfig();

// Initialize the S3Client using the environment variables
const s3Client = new S3Client({
  region: config.awsRegion,
  credentials: {
    accessKeyId: config.awsS3AccessKey,
    secretAccessKey: config.awsS3SecretAccessKey,
  },
});

/**
 * Uploads a file buffer directly to the private S3 bucket.
 * 
 * @param fileBuffer - The binary content of the file
 * @param s3Key - The destination key (path) in S3 (e.g., 'avatars/user-123.jpg' or 'recordings/room-456.webm')
 * @param mimeType - The content type of the file (e.g., 'image/jpeg' or 'video/webm')
 * @returns The S3 key that was uploaded
 */
export async function uploadFileBuffer(fileBuffer: Buffer, s3Key: string, mimeType: string): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: config.awsS3BucketName,
    Key: s3Key,
    Body: fileBuffer,
    ContentType: mimeType,
  });

  try {
    await s3Client.send(command);
    return s3Key;
  } catch (error) {
    console.error(`[S3 Service] Failed to upload file to ${s3Key}:`, error);
    throw new Error("File upload failed.");
  }
}

/**
 * Generates a temporary Presigned URL for viewing/downloading a private file.
 * 
 * @param s3Key - The key of the object in S3
 * @param expiresInSeconds - How long the URL is valid. 
 *                           Defaults to 86400 (24h) for avatars, 900 (15m) for recordings.
 * @returns A temporary presigned URL string
 */
export async function getPresignedViewUrl(s3Key: string, expiresInSeconds?: number): Promise<string> {
  // Determine default expiration based on path prefix if not explicitly provided
  let expiration = expiresInSeconds;
  if (!expiration) {
    if (s3Key.startsWith("avatars/")) {
      expiration = 86400; // 24 hours
    } else if (s3Key.startsWith("recordings/")) {
      expiration = 900; // 15 minutes
    } else {
      expiration = 3600; // 1 hour generic fallback
    }
  }

  const command = new GetObjectCommand({
    Bucket: config.awsS3BucketName,
    Key: s3Key,
  });

  try {
    const url = await getSignedUrl(s3Client, command, { expiresIn: expiration });
    return url;
  } catch (error) {
    console.error(`[S3 Service] Failed to generate presigned URL for ${s3Key}:`, error);
    throw new Error("Failed to generate file access URL.");
  }
}
