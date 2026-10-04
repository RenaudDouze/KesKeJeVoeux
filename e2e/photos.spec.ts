import { test, expect, type Page } from "@playwright/test";

async function createList(page: Page): Promise<void> {
  await page.goto("/");
  await page.click("#create-form button[type=submit]");
  await page.waitForURL(/\/l\//);
  await expect(page.locator("#conn-dot")).toHaveClass(/online/, { timeout: 10_000 });
}

/** Une « photo d'appareil » : grande et bruitée (incompressible), donc bien
 * au-delà de la limite de 5 Mo du serveur une fois en PNG. */
async function bigNoisyPng(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 3000;
    canvas.height = 2250;
    const ctx = canvas.getContext("2d")!;
    const data = ctx.createImageData(canvas.width, canvas.height);
    for (let i = 0; i < data.data.length; i++) data.data[i] = (i * 2654435761) >>> 24;
    ctx.putImageData(data, 0, 0);
    const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), "image/png"));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  });
  return Buffer.from(base64, "base64");
}

test("une photo trop lourde est redimensionnée puis enregistrée, avec confirmation", async ({ page }) => {
  await createList(page);
  const png = await bigNoisyPng(page);
  expect(png.length).toBeGreaterThan(5 * 1024 * 1024);

  await page.click("#btn-add");
  await page.fill("#item-name", "Appareil photo");
  await page.setInputFiles("#item-image-file", { name: "IMG_0001.png", mimeType: "image/png", buffer: png });
  await expect(page.locator("#image-preview img")).toBeVisible();
  await page.click("#item-form button[type=submit]");

  await expect(page.locator("#toast")).toHaveText("Photo enregistrée");
  const img = page.locator(".wish-image");
  await expect(img).toHaveAttribute("src", /\/image\?v=1$/);
  // Image stockée : JPEG, réduite à 1600 px de large.
  const size = await img.evaluate(async (el: HTMLImageElement) => {
    await el.decode();
    return { w: el.naturalWidth, h: el.naturalHeight };
  });
  expect(size).toEqual({ w: 1600, h: 1200 });
});

test("un format illisible affiche l'erreur à côté de la photo", async ({ page }) => {
  await createList(page);
  await page.click("#btn-add");
  await page.fill("#item-name", "Photo HEIC");
  await page.setInputFiles("#item-image-file", {
    name: "IMG_0002.HEIC",
    mimeType: "image/heic",
    buffer: Buffer.from("pas une vraie image"),
  });
  await expect(page.locator("#image-error")).toBeVisible();
  await expect(page.locator("#image-error")).toContainText("ne sait pas lire ce format");
  await expect(page.locator("#image-preview img")).toHaveCount(0);
});

test("un échec d'envoi côté serveur est signalé clairement", async ({ page }) => {
  await createList(page);
  await page.route("**/items/*/image", (route) =>
    route.request().method() === "PUT"
      ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Stockage indisponible." }) })
      : route.continue(),
  );
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    "base64",
  );
  await page.click("#btn-add");
  await page.fill("#item-name", "Lampe");
  await page.setInputFiles("#item-image-file", { name: "lampe.png", mimeType: "image/png", buffer: png });
  await expect(page.locator("#image-preview img")).toBeVisible();
  await page.click("#item-form button[type=submit]");
  const toast = page.locator("#toast.toast-error");
  await expect(toast).toHaveText("Photo non enregistrée : Stockage indisponible.");
  await toast.locator("#toast-close").click();
  await expect(toast).toHaveCount(0);
});
