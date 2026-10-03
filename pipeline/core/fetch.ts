/**
 * Download + archive. Every file is stored untouched under data/archive/<adapter>/<sha256-prefix>-<name>
 * together with a .meta.json recording URL, retrieval time and headers. The import step only
 * ever reads the archived copy, so an import can be reproduced exactly.
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile, readFile, stat } from "node:fs/promises";
import path from "node:path";

export const ARCHIVE_ROOT = process.env.HM_ARCHIVE_DIR ? path.resolve(process.env.HM_ARCHIVE_DIR) : path.resolve(process.cwd(), "data", "archive");

export interface Archived {
  buffer: Buffer;
  sha256: string;
  bytes: number;
  archivePath: string;      // relative to project root
  retrievedAt: Date;
  lastModified?: string;
}

export class DownloadError extends Error {
  constructor(message: string, public url: string, public status?: number) {
    super(message);
    this.name = "DownloadError";
  }
}

const UA = "HertfordMoney/0.1 (+public-spending transparency; contact via repository)";

export async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "user-agent": UA, accept: "text/html,*/*" }, redirect: "follow" });
  if (!res.ok) throw new DownloadError(`HTTP ${res.status} fetching ${url}`, url, res.status);
  return await res.text();
}

export async function downloadAndArchive(adapterId: string, url: string, suggestedName?: string): Promise<Archived> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { "user-agent": UA }, redirect: "follow" });
  } catch (e) {
    throw new DownloadError(`Network error fetching ${url}: ${(e as Error).message}`, url);
  }
  if (!res.ok) throw new DownloadError(`HTTP ${res.status} fetching ${url}`, url, res.status);
  const buffer = Buffer.from(await res.arrayBuffer());
  const ct = res.headers.get("content-type") ?? "";
  if (/text\/html/i.test(ct) && !/\.html?$/i.test(url)) {
    // A CSV link that returns HTML usually means a moved page or a cookie wall: fail visibly.
    throw new DownloadError(`Expected a data file but got HTML (content-type ${ct}) from ${url}`, url, res.status);
  }
  return archiveBuffer(adapterId, url, buffer, suggestedName, res.headers.get("last-modified") ?? undefined);
}

/** Archive a file that was obtained outside the pipeline (e.g. downloaded by hand). */
export async function archiveLocalFile(adapterId: string, url: string, filePath: string): Promise<Archived> {
  const buffer = await readFile(filePath);
  return archiveBuffer(adapterId, url, buffer, path.basename(filePath));
}

export async function archiveBuffer(adapterId: string, url: string, buffer: Buffer, suggestedName?: string, lastModified?: string): Promise<Archived> {
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const name = (suggestedName ?? decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "file")).replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 120);
  const dir = path.join(ARCHIVE_ROOT, adapterId);
  await mkdir(dir, { recursive: true });
  const fileName = `${sha256.slice(0, 12)}-${name}`;
  const full = path.join(dir, fileName);
  const retrievedAt = new Date();
  try { await stat(full); } catch { await writeFile(full, buffer); }
  await writeFile(`${full}.meta.json`, JSON.stringify({ url, sha256, bytes: buffer.length, retrievedAt: retrievedAt.toISOString(), lastModified }, null, 2));
  return { buffer, sha256, bytes: buffer.length, archivePath: path.relative(process.cwd(), full), retrievedAt, lastModified };
}

export function sha256Of(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}
