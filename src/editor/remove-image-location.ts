// Clears GPS data from JPEG metadata before a photo is stored, so project files
// do not carry where the photo was taken. Bytes are overwritten in place: the
// file keeps its length, image data, orientation and every other tag.

const EXIF_HEADER = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"
const XMP_HEADER = "http://ns.adobe.com/xap/1.0/\0";
const GPS_IFD_TAG = 0x8825;
const TYPE_SIZES: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };
const XMP_GPS_ATTRIBUTE = /\s[\w.-]+:GPS\w*\s*=\s*("[^"]*"|'[^']*')/g;
const XMP_GPS_ELEMENT = /<([\w.-]+:GPS\w*)\b[^>]*?(?:\/>|>[\s\S]*?<\/\1\s*>)/g;

export async function removeImageLocation(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  const signature = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  if (signature[0] !== 0xff || signature[1] !== 0xd8) return file;
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!removeJpegLocation(bytes)) return file;
  return new File([bytes], file.name, { type: file.type, lastModified: file.lastModified });
}

/** Returns true when GPS data was found and cleared. Malformed input is left as is. */
export function removeJpegLocation(bytes: Uint8Array): boolean {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return false;
  let changed = false;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return changed;
    const marker = bytes[offset + 1];
    if (marker === 0xff) { offset++; continue; }
    if (marker === 0xda || marker === 0xd9) return changed;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { offset += 2; continue; }
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    const start = offset + 4;
    const end = offset + 2 + length;
    if (length < 2 || end > bytes.length) return changed;
    if (marker === 0xe1) {
      if (startsWith(bytes, start, EXIF_HEADER)) changed = clearExifGps(bytes, start + EXIF_HEADER.length, end) || changed;
      else if (startsWithText(bytes, start, XMP_HEADER)) changed = clearXmpGps(bytes, start + XMP_HEADER.length, end) || changed;
    }
    offset = end;
  }
  return changed;
}

function clearExifGps(bytes: Uint8Array, tiff: number, end: number): boolean {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const order = String.fromCharCode(bytes[tiff], bytes[tiff + 1]);
  if (order !== "II" && order !== "MM") return false;
  const little = order === "II";
  const inside = (position: number, size: number) => position >= tiff && position + size <= end;
  if (!inside(tiff, 8) || view.getUint16(tiff + 2, little) !== 42) return false;

  const ifd0 = tiff + view.getUint32(tiff + 4, little);
  if (!inside(ifd0, 2)) return false;
  const count = view.getUint16(ifd0, little);
  for (let index = 0; index < count; index++) {
    const entry = ifd0 + 2 + index * 12;
    if (!inside(entry, 12)) return false;
    if (view.getUint16(entry, little) !== GPS_IFD_TAG) continue;
    const gps = tiff + view.getUint32(entry + 8, little);
    if (!inside(gps, 2)) return false;
    const gpsCount = view.getUint16(gps, little);
    if (gpsCount === 0 || !inside(gps + 2, gpsCount * 12)) return false;
    for (let gpsIndex = 0; gpsIndex < gpsCount; gpsIndex++) {
      const gpsEntry = gps + 2 + gpsIndex * 12;
      const size = (TYPE_SIZES[view.getUint16(gpsEntry + 2, little)] ?? 0) * view.getUint32(gpsEntry + 4, little);
      if (size <= 4) continue;
      const value = tiff + view.getUint32(gpsEntry + 8, little);
      if (inside(value, size)) bytes.fill(0, value, value + size);
    }
    // An empty IFD: zero entries, and the next-IFD pointer that now follows is zero too.
    bytes.fill(0, gps, gps + 2 + gpsCount * 12);
    return true;
  }
  return false;
}

/** Replaces GPS properties with spaces of the same length, which leaves valid XML. */
function clearXmpGps(bytes: Uint8Array, start: number, end: number): boolean {
  let text = "";
  for (let index = start; index < end; index++) text += String.fromCharCode(bytes[index]);
  let changed = false;
  for (const pattern of [XMP_GPS_ELEMENT, XMP_GPS_ATTRIBUTE]) {
    for (const match of text.matchAll(pattern)) {
      bytes.fill(0x20, start + match.index, start + match.index + match[0].length);
      changed = true;
    }
  }
  return changed;
}

function startsWith(bytes: Uint8Array, offset: number, expected: readonly number[]) {
  return expected.every((value, index) => bytes[offset + index] === value);
}

function startsWithText(bytes: Uint8Array, offset: number, expected: string) {
  return [...expected].every((character, index) => bytes[offset + index] === character.charCodeAt(0));
}
