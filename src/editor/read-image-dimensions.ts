export async function readImageDimensions(file: File): Promise<{
  readonly width?: number;
  readonly height?: number;
}> {
  if (!file.type.startsWith("image/")) return {};
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = objectUrl;
    await image.decode();
    return { width: image.naturalWidth, height: image.naturalHeight };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
