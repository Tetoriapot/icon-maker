export const MAX_IMAGE_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_IMAGE_EDGE = 8_192;
export const MAX_IMAGE_PIXELS = 40_000_000;
const MAX_IMAGE_HEADER_BYTES = 2 * 1024 * 1024;

export type SupportedImageType = "image/png" | "image/jpeg" | "image/webp";

export type ImageFileValidation =
  | {
      ok: true;
      type: SupportedImageType;
      width: number;
      height: number;
    }
  | {
      ok: false;
      reason:
        | "too-large"
        | "dimensions-too-large"
        | "unsupported"
        | "unreadable";
    };

export type ImageDimensionValidation =
  | { ok: true }
  | { ok: false; reason: "invalid" | "too-large" };

export function detectSupportedImageType(
  bytes: Uint8Array,
): SupportedImageType | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }

  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }

  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }

  return null;
}

function readUint24LittleEndian(bytes: Uint8Array, offset: number) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

export function readEncodedImageDimensions(
  bytes: Uint8Array,
  type: SupportedImageType,
): { width: number; height: number } | null {
  if (type === "image/png") {
    const hasIhdr =
      bytes.length >= 24 &&
      bytes[8] === 0 &&
      bytes[9] === 0 &&
      bytes[10] === 0 &&
      bytes[11] === 13 &&
      bytes[12] === 0x49 &&
      bytes[13] === 0x48 &&
      bytes[14] === 0x44 &&
      bytes[15] === 0x52;
    if (!hasIhdr) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }

  if (type === "image/jpeg") {
    let offset = 2;
    while (offset + 3 < bytes.length) {
      while (offset < bytes.length && bytes[offset] !== 0xff) offset += 1;
      while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
      if (offset >= bytes.length) return null;
      const marker = bytes[offset++];
      if (marker === 0xd9 || marker === 0xda) return null;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
      if (offset + 1 >= bytes.length) return null;
      const segmentLength = (bytes[offset] << 8) | bytes[offset + 1];
      if (segmentLength < 2 || offset + segmentLength > bytes.length) return null;
      const isStartOfFrame =
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf);
      if (isStartOfFrame) {
        if (segmentLength < 7) return null;
        return {
          height: (bytes[offset + 3] << 8) | bytes[offset + 4],
          width: (bytes[offset + 5] << 8) | bytes[offset + 6],
        };
      }
      offset += segmentLength;
    }
    return null;
  }

  if (bytes.length < 20) return null;
  const chunkType = String.fromCharCode(
    bytes[12],
    bytes[13],
    bytes[14],
    bytes[15],
  );
  if (chunkType === "VP8X" && bytes.length >= 30) {
    return {
      width: readUint24LittleEndian(bytes, 24) + 1,
      height: readUint24LittleEndian(bytes, 27) + 1,
    };
  }
  if (chunkType === "VP8 " && bytes.length >= 30) {
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) {
      return null;
    }
    return {
      width: (bytes[26] | (bytes[27] << 8)) & 0x3fff,
      height: (bytes[28] | (bytes[29] << 8)) & 0x3fff,
    };
  }
  if (chunkType === "VP8L" && bytes.length >= 25 && bytes[20] === 0x2f) {
    return {
      width: 1 + (((bytes[22] & 0x3f) << 8) | bytes[21]),
      height:
        1 +
        (((bytes[24] & 0x0f) << 10) |
          (bytes[23] << 2) |
          ((bytes[22] & 0xc0) >> 6)),
    };
  }
  return null;
}

export async function validateImageFile(
  file: Blob,
): Promise<ImageFileValidation> {
  if (file.size > MAX_IMAGE_FILE_BYTES) {
    return { ok: false, reason: "too-large" };
  }
  if (file.size === 0) {
    return { ok: false, reason: "unsupported" };
  }

  try {
    const header = new Uint8Array(
      await file.slice(0, Math.min(file.size, MAX_IMAGE_HEADER_BYTES)).arrayBuffer(),
    );
    const type = detectSupportedImageType(header);
    if (!type) return { ok: false, reason: "unsupported" };
    const dimensions = readEncodedImageDimensions(header, type);
    if (!dimensions) return { ok: false, reason: "unreadable" };
    const dimensionValidation = validateImageDimensions(
      dimensions.width,
      dimensions.height,
    );
    if (!dimensionValidation.ok) {
      return {
        ok: false,
        reason:
          dimensionValidation.reason === "too-large"
            ? "dimensions-too-large"
            : "unreadable",
      };
    }
    return { ok: true, type, ...dimensions };
  } catch {
    return { ok: false, reason: "unreadable" };
  }
}

export function validateImageDimensions(
  width: number,
  height: number,
): ImageDimensionValidation {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return { ok: false, reason: "invalid" };
  }
  if (
    width > MAX_IMAGE_EDGE ||
    height > MAX_IMAGE_EDGE ||
    width * height > MAX_IMAGE_PIXELS
  ) {
    return { ok: false, reason: "too-large" };
  }
  return { ok: true };
}
