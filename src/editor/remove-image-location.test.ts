import { describe, expect, it } from "vitest";
import { removeImageLocation, removeJpegLocation } from "./remove-image-location";

const ORIENTATION_TAG = 0x0112;
const GPS_IFD_TAG = 0x8825;

/** A JPEG with one Exif segment: IFD0 has Orientation and a GPS pointer; the GPS IFD has a latitude. */
function jpegWithGps(little: boolean) {
  const tiff = new DataView(new ArrayBuffer(92));
  const u16 = (at: number, value: number) => tiff.setUint16(at, value, little);
  const u32 = (at: number, value: number) => tiff.setUint32(at, value, little);
  tiff.setUint8(0, little ? 0x49 : 0x4d); tiff.setUint8(1, little ? 0x49 : 0x4d);
  u16(2, 42); u32(4, 8);
  u16(8, 2);
  u16(10, ORIENTATION_TAG); u16(12, 3); u32(14, 1); u16(18, 6);
  u16(22, GPS_IFD_TAG); u16(24, 4); u32(26, 1); u32(30, 38);
  u32(34, 0);
  u16(38, 2);
  u16(40, 1); u16(42, 2); u32(44, 2); tiff.setUint8(48, 0x4e);
  u16(52, 2); u16(54, 5); u32(56, 3); u32(60, 68);
  u32(64, 0);
  [63, 1, 31, 1, 5304, 100].forEach((value, index) => u32(68 + index * 4, value));
  const exif = [...new TextEncoder().encode("Exif"), 0, 0, ...new Uint8Array(tiff.buffer)];
  return { bytes: segmentJpeg(0xe1, exif), tiffStart: 2 + 4 + 6 };
}

function segmentJpeg(marker: number, payload: readonly number[]) {
  const length = payload.length + 2;
  return new Uint8Array([0xff, 0xd8, 0xff, marker, length >> 8, length & 0xff, ...payload, 0xff, 0xda, 0x00, 0x02, 0x12, 0x34, 0xff, 0xd9]);
}

describe("removeJpegLocation", () => {
  for (const little of [true, false]) {
    it(`clears the GPS IFD and keeps everything else (${little ? "little" : "big"} endian)`, () => {
      const { bytes, tiffStart } = jpegWithGps(little);
      const before = bytes.slice();
      expect(removeJpegLocation(bytes)).toBe(true);
      expect(bytes.length).toBe(before.length);
      const view = new DataView(bytes.buffer);
      expect(view.getUint16(tiffStart + 18, little)).toBe(6);
      expect(view.getUint16(tiffStart + 38, little)).toBe(0);
      const gpsStart = tiffStart + 38;
      const gpsEnd = tiffStart + 92;
      expect(bytes.slice(gpsStart, gpsEnd).every((value) => value === 0)).toBe(true);
      expect(bytes.slice(0, gpsStart)).toEqual(before.slice(0, gpsStart));
      expect(bytes.slice(gpsEnd)).toEqual(before.slice(gpsEnd));
    });
  }

  it("leaves photos without location, other formats and broken files unchanged", () => {
    const noGps = segmentJpeg(0xe1, [...new TextEncoder().encode("Exif"), 0, 0, 0x49, 0x49, 42, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const truncated = jpegWithGps(true).bytes.slice(0, 40);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    for (const bytes of [noGps, truncated, png]) {
      const before = bytes.slice();
      expect(removeJpegLocation(bytes)).toBe(false);
      expect(bytes).toEqual(before);
    }
  });

  it("blanks GPS properties in XMP without changing its length", () => {
    const xmp = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF><rdf:Description exif:GPSLatitude="63,31.88N" tiff:Make="Apple">`
      + `<exif:GPSLongitude>19,30.12W</exif:GPSLongitude><exif:GPSVersionID><rdf:Seq><rdf:li>2</rdf:li></rdf:Seq></exif:GPSVersionID>`
      + `</rdf:Description></rdf:RDF></x:xmpmeta>`;
    const bytes = segmentJpeg(0xe1, [...new TextEncoder().encode(`http://ns.adobe.com/xap/1.0/\0${xmp}`)]);
    const length = bytes.length;
    expect(removeJpegLocation(bytes)).toBe(true);
    const text = new TextDecoder().decode(bytes);
    expect(bytes.length).toBe(length);
    expect(text).not.toContain("GPS");
    expect(text).not.toContain("63,31");
    expect(text).toContain(`tiff:Make="Apple"`);
    expect(text).toContain("</rdf:Description>");
  });
});

describe("removeImageLocation", () => {
  it("returns a cleaned copy of a JPEG with the same name, type and size", async () => {
    const { bytes } = jpegWithGps(true);
    const file = new File([bytes], "photo.jpg", { type: "image/jpeg", lastModified: 1 });
    const cleaned = await removeImageLocation(file);
    expect(cleaned).not.toBe(file);
    expect(cleaned).toMatchObject({ name: "photo.jpg", type: "image/jpeg", size: file.size, lastModified: 1 });
  });

  it("returns other files as they are", async () => {
    const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "shot.png", { type: "image/png" });
    const pdf = new File([jpegWithGps(true).bytes], "photo.pdf", { type: "application/pdf" });
    expect(await removeImageLocation(png)).toBe(png);
    expect(await removeImageLocation(pdf)).toBe(pdf);
  });
});
