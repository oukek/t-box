/** Normalize uploads to a small PNG; storage never needs the original image or its metadata. */
export async function categoryThumbnail(file: File): Promise<string> {
  if (
    !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
    !file.size ||
    file.size > 10 * 1024 * 1024
  )
    throw new Error("请选择 10 MB 以内的 PNG、JPEG 或 WebP 图片");
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 96;
    const context = canvas.getContext("2d");
    if (!context || !image.naturalWidth || !image.naturalHeight)
      throw new Error("图片无法读取，请选择其他图片");
    const scale = Math.min(96 / image.naturalWidth, 96 / image.naturalHeight);
    const width = image.naturalWidth * scale,
      height = image.naturalHeight * scale;
    context.drawImage(
      image,
      (96 - width) / 2,
      (96 - height) / 2,
      width,
      height,
    );
    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}
