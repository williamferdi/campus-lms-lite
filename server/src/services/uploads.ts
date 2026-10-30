import path from "node:path";
import { unprocessable } from "../lib/errors.js";

/**
 * Extensions the platform accepts at all. HTML, SVG, scripts and executables are excluded
 * because they could run in the browser or on a user's machine.
 */
export const PLATFORM_EXTENSIONS: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  odp: "application/vnd.oasis.opendocument.presentation",
  rtf: "application/rtf",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  zip: "application/zip",
};

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp"]);

const startsWith = (buf: Buffer, bytes: number[], offset = 0) =>
  buf.length >= offset + bytes.length && bytes.every((b, i) => buf[offset + i] === b);

const ZIP = [0x50, 0x4b, 0x03, 0x04];
const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

/** Check that the content looks like what the extension claims (magic bytes). */
function contentMatches(ext: string, buf: Buffer): boolean {
  switch (ext) {
    case "pdf":
      return startsWith(buf, [0x25, 0x50, 0x44, 0x46]);
    case "png":
      return startsWith(buf, [0x89, 0x50, 0x4e, 0x47]);
    case "jpg":
    case "jpeg":
      return startsWith(buf, [0xff, 0xd8, 0xff]);
    case "gif":
      return startsWith(buf, [0x47, 0x49, 0x46, 0x38]);
    case "webp":
      return startsWith(buf, [0x52, 0x49, 0x46, 0x46]) && startsWith(buf, [0x57, 0x45, 0x42, 0x50], 8);
    case "docx":
    case "pptx":
    case "xlsx":
    case "odt":
    case "ods":
    case "odp":
    case "zip":
      return startsWith(buf, ZIP);
    case "doc":
    case "ppt":
    case "xls":
      return startsWith(buf, OLE);
    case "mp4":
      return startsWith(buf, [0x66, 0x74, 0x79, 0x70], 4);
    case "mp3":
      return startsWith(buf, [0x49, 0x44, 0x33]) || (buf[0] === 0xff && ((buf[1] ?? 0) & 0xe0) === 0xe0);
    case "rtf":
      return startsWith(buf, [0x7b, 0x5c, 0x72, 0x74, 0x66]);
    case "txt":
    case "md":
    case "csv":
      return !buf.subarray(0, 8192).includes(0);
    default:
      return false;
  }
}

export function safeFileName(name: string): string {
  // Strip control characters and path/reserved characters from user-supplied names.
  // eslint-disable-next-line no-control-regex
  const base = path.basename(name).replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, "_").trim();
  return (base || "file").slice(0, 200);
}

export function validateUpload(
  filename: string,
  data: Buffer,
  allowedExtensions: string[] = [],
  { imagesOnly = false } = {},
): { ext: string; mimeType: string; name: string } {
  const name = safeFileName(filename);
  const ext = path.extname(name).slice(1).toLowerCase();
  const mimeType = PLATFORM_EXTENSIONS[ext];
  if (!ext || !mimeType) {
    throw unprocessable(`Files of type ".${ext || "?"}" are not allowed.`);
  }
  if (imagesOnly && !IMAGE_EXTENSIONS.has(ext)) {
    throw unprocessable("Please upload a PNG, JPEG, GIF or WebP image.");
  }
  const allowed = allowedExtensions.map((e) => e.toLowerCase().replace(/^\./, ""));
  if (allowed.length > 0 && !allowed.includes(ext)) {
    throw unprocessable(`This assignment only accepts: ${allowed.map((e) => `.${e}`).join(", ")}.`);
  }
  if (data.length === 0) throw unprocessable("The file is empty.");
  if (!contentMatches(ext, data)) {
    throw unprocessable(`The file content does not match its ".${ext}" extension.`);
  }
  return { ext, mimeType, name };
}

export const isInlineSafe = (mimeType: string) =>
  mimeType === "application/pdf" || (mimeType.startsWith("image/") && mimeType !== "image/svg+xml") ||
  mimeType === "video/mp4" || mimeType === "audio/mpeg";
