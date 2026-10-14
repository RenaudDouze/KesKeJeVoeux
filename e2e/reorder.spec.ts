import { test, expect } from "@playwright/test";

test("la poignée de déplacement est à droite, avec modifier/supprimer, et réordonne les souhaits", async ({ page }) => {
  await page.goto("/");
  await page.click("#create-form button[type=submit]");
  await page.waitForURL(/\/l\//);
  await expect(page.locator("#conn-dot")).toHaveClass(/online/, { timeout: 10_000 });
  for (const name of ["Premier", "Deuxième", "Troisième"]) {
    await page.click("#btn-add");
    await page.fill("#item-name", name);
    await page.click("#item-form button[type=submit]");
    await expect(page.locator(".wish-name", { hasText: name })).toBeVisible();
  }

  // Poignée dans la colonne d'actions (à droite), plus rien à gauche de la photo.
  const first = page.locator(".wish").first();
  await expect(first.locator(".wish-actions .wish-handle")).toBeVisible();
  const card = (await first.boundingBox())!;
  const media = (await first.locator(".wish-media").boundingBox())!;
  const handle = (await first.locator(".wish-handle").boundingBox())!;
  expect(media.x - card.x).toBeLessThan(20);
  expect(handle.x).toBeGreaterThan(card.x + card.width / 2);

  // Glisser « Troisième » au-dessus de « Premier ».
  const from = (await page.locator(".wish").nth(2).locator(".wish-handle").boundingBox())!;
  const to = (await page.locator(".wish").first().boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + 10, { steps: 10 });
  await page.mouse.up();
  await expect(page.locator(".wish-name")).toHaveText(["Troisième", "Premier", "Deuxième"]);

  // L'ordre est bien enregistré côté serveur.
  await page.reload();
  await expect(page.locator(".wish-name")).toHaveText(["Troisième", "Premier", "Deuxième"]);
});
