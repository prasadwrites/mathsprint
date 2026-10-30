/** Shrinking a picture the deck owner picks, before it's uploaded with a question (see EditQuestion). It's stored in
 * the question itself, so it has to stay small: the server refuses anything over 400 KB. */

const MAX_SIDE = 1200;
const TARGET_BYTES = 280_000;

export interface ShrunkPicture {
  src: string;
  width: number;
  height: number;
}

function load(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That file couldn't be opened as a picture. Try a PNG or JPEG."));
    };
    img.src = url;
  });
}

/** Bytes a base64 data URL holds. */
const bytes = (src: string) => Math.floor(((src.length - src.indexOf(",") - 1) * 3) / 4);

/** The picture on white, at most MAX_SIDE across, as a PNG when that's small enough (sharp lines for diagrams) and
 * otherwise as a JPEG, made smaller until it fits. */
export async function shrinkPicture(file: File): Promise<ShrunkPicture> {
  if (!file.type.startsWith("image/")) throw new Error("Pick a picture file, like a PNG or JPEG.");
  const img = await load(file);
  let scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  for (let attempt = 0; attempt < 6; attempt++) {
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser can't prepare the picture. Try another browser.");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    const png = canvas.toDataURL("image/png");
    if (bytes(png) <= TARGET_BYTES) return { src: png, width, height };
    for (const quality of [0.85, 0.7]) {
      const jpeg = canvas.toDataURL("image/jpeg", quality);
      if (bytes(jpeg) <= TARGET_BYTES) return { src: jpeg, width, height };
    }
    scale *= 0.75;
  }
  throw new Error("That picture is too detailed to upload. Try cropping it.");
}
