import { test, expect, type Page } from "@playwright/test";

const names = (page: Page) => page.locator(".wish-name");

test("tout le monde peut trier par prix ou selon l'ordre défini, chacun sur son appareil", async ({ browser }) => {
  const owner = await (await browser.newContext()).newPage();
  await owner.goto("/");
  await owner.click("#create-form button[type=submit]");
  await owner.waitForURL(/\/l\//);
  await expect(owner.locator("#conn-dot")).toHaveClass(/online/, { timeout: 10_000 });
  for (const [name, price] of [["Moyen", "30"], ["Sans prix", ""], ["Cher", "80"], ["Pas cher", "5"]]) {
    await owner.click("#btn-add");
    await owner.fill("#item-name", name);
    if (price) await owner.fill("#item-price", price);
    await owner.click("#item-form button[type=submit]");
    await expect(owner.locator(".wish-name", { hasText: name })).toBeVisible();
  }
  const defined = ["Moyen", "Sans prix", "Cher", "Pas cher"];
  await expect(names(owner)).toHaveText(defined);
  await expect(owner.locator('.sort-btn[data-sort="order"]')).toHaveAttribute("aria-pressed", "true");

  // Propriétaire : prix croissant, sans prix à la fin, sans poignée de déplacement.
  await owner.click('.sort-btn[data-sort="price-asc"]');
  await expect(names(owner)).toHaveText(["Pas cher", "Moyen", "Cher", "Sans prix"]);
  await expect(owner.locator(".wish-handle")).toHaveCount(0);
  await expect(owner.locator(".wish-edit")).toHaveCount(4);

  // Invité : son tri est indépendant de celui du propriétaire.
  const code = owner.url().split("/l/")[1];
  const guest = await (await browser.newContext()).newPage();
  await guest.goto(`/l/${code}`);
  await expect(names(guest)).toHaveText(defined);
  await guest.click('.sort-btn[data-sort="price-desc"]');
  await expect(names(guest)).toHaveText(["Cher", "Moyen", "Pas cher", "Sans prix"]);
  await expect(names(owner)).toHaveText(["Pas cher", "Moyen", "Cher", "Sans prix"]);

  // Le tri est mémorisé sur l'appareil, et un nouveau souhait s'y range.
  await guest.reload();
  await expect(names(guest)).toHaveText(["Cher", "Moyen", "Pas cher", "Sans prix"]);
  await owner.click("#btn-add");
  await owner.fill("#item-name", "Luxe");
  await owner.fill("#item-price", "200");
  await owner.click("#item-form button[type=submit]");
  await expect(names(guest)).toHaveText(["Luxe", "Cher", "Moyen", "Pas cher", "Sans prix"]);

  // Retour à l'ordre défini : poignées revenues, ordre intact.
  await owner.click('.sort-btn[data-sort="order"]');
  await expect(names(owner)).toHaveText([...defined, "Luxe"]);
  await expect(owner.locator(".wish-handle")).toHaveCount(5);
});
