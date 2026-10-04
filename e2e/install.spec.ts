import { test, expect, devices } from "@playwright/test";

// Le manifest et le service worker ne sont générés qu'au build (le plugin
// PWA ne les injecte pas en dev) : seules les icônes sont vérifiées ici.
test("les icônes de l'app installable sont servies", async ({ request }) => {
  for (const icon of ["icon-192.png", "icon-512.png", "icon-512-maskable.png", "apple-touch-icon.png"]) {
    const res = await request.get(`/${icon}`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("image/png");
  }
});

test("Android/Chrome : le bouton d'installation apparaît avec l'invite du navigateur et la déclenche", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".home-header h1")).toHaveText("KesKeJeVoeux");
  // Pas d'invite reçue (navigateur de test) : pas de bouton.
  await expect(page.locator("#btn-install")).toHaveCount(0);

  // Simule l'événement que Chrome émet quand l'app est installable.
  await page.evaluate(() => {
    const event = new Event("beforeinstallprompt") as Event & { prompt: () => Promise<void>; userChoice: Promise<unknown> };
    (window as unknown as { __prompted: number }).__prompted = 0;
    event.prompt = async () => {
      (window as unknown as { __prompted: number }).__prompted++;
    };
    event.userChoice = Promise.resolve({ outcome: "accepted" });
    window.dispatchEvent(event);
  });
  await expect(page.locator("#btn-install")).toBeVisible();
  await page.click("#btn-install");
  expect(await page.evaluate(() => (window as unknown as { __prompted: number }).__prompted)).toBe(1);
  // L'invite ne sert qu'une fois : le bouton disparaît.
  await expect(page.locator("#btn-install")).toHaveCount(0);
});

test.describe("iPhone", () => {
  test.use({ userAgent: devices["iPhone 15"].userAgent, viewport: { width: 393, height: 852 } });

  test("le bouton affiche la marche à suivre Safari, aussi depuis le menu d'une liste", async ({ page }) => {
    await page.goto("/");
    await page.click("#btn-install");
    await expect(page.locator(".install-modal")).toContainText("Sur l'écran d'accueil");
    await page.click("#install-ok");
    await expect(page.locator(".install-modal")).toHaveCount(0);

    await page.click("#create-form button[type=submit]");
    await page.waitForURL(/\/l\//);
    await page.click("#btn-menu");
    await page.click('[data-action="install"]');
    await expect(page.locator(".install-modal")).toBeVisible();
  });
});
