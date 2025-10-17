import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import config from "./config";
import { sanitizeMediaPath } from "./utils";

export interface SignedMedia {
  signed_url: string;
  ttl: number;
  etag: string;
}

export async function signMediaPath(requestPath: string): Promise<SignedMedia> {
  const normalized = sanitizeMediaPath(requestPath);
  const absolute = path.join(config.mediaRoot, normalized);
  const stats = await fs.stat(absolute);
  if (!stats.isFile()) {
    throw new Error("NOT_FILE");
  }

  const relativePath = normalized.startsWith("/") ? normalized : `/${normalized}`;
  const hash = crypto
    .createHash("md5")
    .update(`${stats.size}-${Math.floor(stats.mtimeMs)}`)
    .digest("hex");
  const etag = `"${hash}"`;
  const ttl = config.signedUrlTtlSeconds;
  const signedUrl = `http://localhost:${config.port}${relativePath}?sig=dev&ttl=${ttl}`;

  return { signed_url: signedUrl, ttl, etag };
}
