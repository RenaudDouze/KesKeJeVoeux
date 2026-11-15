// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prepareImage } from "./prepareImage";

const MAX = 5 * 1024 * 1024;
const UNREADABLE =
  "Ce navigateur ne sait pas lire ce format d'image (HEIC ?). Essaie une capture d'écran, ou une photo au format JPEG.";

function fileOf(type: string, size = 10): File {
  const file = new File(["x"], "photo", { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

function blobOf(size: number): Blob {
  const blob = new Blob(["x"], { type: "image/jpeg" });
  Object.defineProperty(blob, "size", { value: size });
  return blob;
}

describe("prepareImage", () => {
  const ctx = { fillStyle: "", fillRect: vi.fn(), drawImage: vi.fn() };
  let toBlob: ReturnType<typeof vi.fn>;
  let getContext: ReturnType<typeof vi.spyOn>;
  const canvas = () => getContext.mock.contexts[0] as HTMLCanvasElement;
  let bitmap: { width: number; height: number; close: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    ctx.fillStyle = "";
    ctx.fillRect.mockClear();
    ctx.drawImage.mockClear();
    toBlob = vi.fn((cb: BlobCallback) => cb(blobOf(100)));
    getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => ctx) as never);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(toBlob as never);
    bitmap = { width: 4000, height: 2000, close: vi.fn() };
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue(bitmap));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("garde tel quel un GIF assez léger (pour son animation), jusqu'à la limite incluse", async () => {
    const small = fileOf("image/gif", MAX);
    await expect(prepareImage(small)).resolves.toBe(small);
    expect(createImageBitmap).not.toHaveBeenCalled();
  });

  it("réencode un GIF trop lourd, comme toute autre image", async () => {
    const big = fileOf("image/gif", MAX + 1);
    const result = await prepareImage(big);
    expect(result).not.toBe(big);
    expect(createImageBitmap).toHaveBeenCalledOnce();
  });

  it("redimensionne (côté long 1600), fond blanc, dessine l'image et réencode en JPEG qualité 0,85", async () => {
    const result = await prepareImage(fileOf("image/png"));

    expect(createImageBitmap).toHaveBeenCalledWith(expect.any(File), { imageOrientation: "from-image" });
    expect(canvas().width).toBe(1600);
    expect(canvas().height).toBe(800);
    expect(getContext).toHaveBeenCalledWith("2d");
    expect(ctx.fillStyle).toBe("#fff");
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 1600, 800);
    expect(ctx.drawImage).toHaveBeenCalledWith(bitmap, 0, 0, 1600, 800);
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), "image/jpeg", 0.85);
    expect(result.size).toBe(100);
    expect(bitmap.close).toHaveBeenCalledOnce();
  });

  it("accepte un JPEG d'exactement la limite, et descend la qualité tant que c'est trop lourd", async () => {
    const sizes = [MAX + 1, MAX];
    toBlob.mockImplementation((cb: BlobCallback) => cb(blobOf(sizes.shift()!)));
    const result = await prepareImage(fileOf("image/png"));
    expect(result.size).toBe(MAX);
    expect(toBlob.mock.calls.map((c) => c[2])).toEqual([0.85, 0.7]);
  });

  it("essaie 0,5 en dernier, ignore un blob absent", async () => {
    const answers: Array<Blob | null> = [null, blobOf(MAX + 1), blobOf(10)];
    toBlob.mockImplementation((cb: BlobCallback) => cb(answers.shift()!));
    const result = await prepareImage(fileOf("image/png"));
    expect(result.size).toBe(10);
    expect(toBlob.mock.calls.map((c) => c[2])).toEqual([0.85, 0.7, 0.5]);
  });

  it("échoue si même la compression maximale reste trop lourde, en libérant l'image", async () => {
    toBlob.mockImplementation((cb: BlobCallback) => cb(blobOf(MAX + 1)));
    await expect(prepareImage(fileOf("image/png"))).rejects.toThrow("Image trop volumineuse, même compressée.");
    expect(bitmap.close).toHaveBeenCalledOnce();
  });

  it("échoue sur une image sans dimension, en libérant l'image", async () => {
    bitmap.width = 0;
    await expect(prepareImage(fileOf("image/png"))).rejects.toThrow();
    expect(toBlob).not.toHaveBeenCalled();
    expect(bitmap.close).toHaveBeenCalledOnce();
  });

  it("n'agrandit jamais une petite image", async () => {
    bitmap.width = 200;
    bitmap.height = 100;
    await prepareImage(fileOf("image/png"));
    expect([canvas().width, canvas().height]).toEqual([200, 100]);
  });

  describe("repli sur <img> (createImageBitmap absent ou en échec)", () => {
    let revoke: ReturnType<typeof vi.fn>;
    let decode: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      revoke = vi.fn();
      URL.createObjectURL = vi.fn(() => "blob:fake");
      URL.revokeObjectURL = revoke as never;
      decode = vi.fn().mockResolvedValue(undefined);
      (HTMLImageElement.prototype as unknown as { decode: unknown }).decode = decode;
      vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(3200);
      vi.spyOn(HTMLImageElement.prototype, "naturalHeight", "get").mockReturnValue(1600);
    });

    afterEach(() => {
      delete (URL as unknown as Record<string, unknown>).createObjectURL;
      delete (URL as unknown as Record<string, unknown>).revokeObjectURL;
      delete (HTMLImageElement.prototype as unknown as Record<string, unknown>).decode;
    });

    it("sans createImageBitmap : décode via <img>, dessine l'élément et révoque l'URL", async () => {
      vi.stubGlobal("createImageBitmap", undefined);
      delete (window as unknown as Record<string, unknown>).createImageBitmap;
      await prepareImage(fileOf("image/png"));
      expect(URL.createObjectURL).toHaveBeenCalledOnce();
      expect(ctx.drawImage).toHaveBeenCalledWith(expect.any(HTMLImageElement), 0, 0, 1600, 800);
      expect((ctx.drawImage.mock.calls[0][0] as HTMLImageElement).src).toBe("blob:fake");
      expect(revoke).toHaveBeenCalledWith("blob:fake");
    });

    it("si createImageBitmap échoue : bascule sur <img>", async () => {
      (createImageBitmap as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("HEIC"));
      await prepareImage(fileOf("image/png"));
      expect(ctx.drawImage).toHaveBeenCalledWith(expect.any(HTMLImageElement), 0, 0, 1600, 800);
      expect(revoke).toHaveBeenCalledOnce();
    });

    it("si <img> ne sait pas décoder : message dédié et URL révoquée", async () => {
      (createImageBitmap as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("HEIC"));
      decode.mockRejectedValue(new Error("EncodingError"));
      await expect(prepareImage(fileOf("image/heic"))).rejects.toThrow(UNREADABLE);
      expect(revoke).toHaveBeenCalledWith("blob:fake");
    });
  });
});
