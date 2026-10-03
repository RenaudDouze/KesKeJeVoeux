import { test, expect, type Page } from "@playwright/test";

async function createList(page: Page, name: string): Promise<{ code: string; editKey: string }> {
  await page.goto("/");
  await expect(page.locator(".home-header h1")).toHaveText("KesKeJeVoeux");
  await page.fill("#create-name", name);
  await page.click("#create-form button[type=submit]");
  await page.waitForURL(/\/l\/[A-Z0-9]{6}$/);
  await expect(page.locator("#conn-dot")).toHaveClass(/online/, { timeout: 10_000 });
  const code = page.url().split("/l/")[1];
  const editKey = await page.evaluate((c) => JSON.parse(localStorage.getItem("kkjv:editKeys") ?? "{}")[c], code);
  return { code, editKey };
}

async function addWish(page: Page, fields: { name: string; description?: string; price?: string; link?: string; imageUrl?: string }) {
  await page.click("#btn-add");
  await page.fill("#item-name", fields.name);
  if (fields.description) await page.fill("#item-description", fields.description);
  if (fields.price) await page.fill("#item-price", fields.price);
  if (fields.link) await page.fill("#item-link", fields.link);
  if (fields.imageUrl) await page.fill("#item-image-url", fields.imageUrl);
  await page.click("#item-form button[type=submit]");
}

const wish = (page: Page, name: string) => page.locator(".wish", { has: page.locator(".wish-name", { hasText: name }) });

test("créer une liste, ajouter, modifier, supprimer (et annuler) des souhaits", async ({ page }) => {
  await createList(page, "Anniversaire");
  await expect(page.locator("#list-title")).toHaveText("Anniversaire");
  await expect(page.locator("#mode-banner")).toBeHidden();

  await addWish(page, {
    name: "Casque audio",
    description: "Sans fil\nCouleur noire",
    price: "79,90",
    link: "exemple.fr/casque",
  });
  const casque = wish(page, "Casque audio");
  await expect(casque.locator(".wish-price")).toHaveText("79,90 €");
  await expect(casque.locator(".wish-description")).toHaveText("Sans fil\nCouleur noire");
  await expect(casque.locator(".wish-link")).toHaveAttribute("href", "https://exemple.fr/casque");
  await expect(casque.locator(".wish-link")).toHaveText("exemple.fr");

  await addWish(page, { name: "Livre" });
  await expect(page.locator(".wish")).toHaveCount(2);
  await expect(page.locator("#total")).toHaveText("Total : 79,90 €");

  // Un prix invalide est refusé dans le formulaire.
  await page.click("#btn-add");
  await page.fill("#item-name", "Plante");
  await page.fill("#item-price", "abc");
  await page.click("#item-form button[type=submit]");
  await expect(page.locator("#item-error")).toHaveText("Prix invalide (ex : 49,90).");
  await page.click("#item-cancel");

  // Modification
  await wish(page, "Livre").locator(".wish-edit").click();
  await expect(page.locator("#item-name")).toHaveValue("Livre");
  await page.fill("#item-name", "Roman policier");
  await page.fill("#item-price", "12.5");
  await page.click("#item-form button[type=submit]");
  await expect(wish(page, "Roman policier").locator(".wish-price")).toHaveText("12,50 €");
  await expect(page.locator("#total")).toHaveText("Total : 92,40 €");

  // Suppression en deux clics, puis annulation
  const del = wish(page, "Roman policier").locator(".wish-delete");
  await del.click();
  await del.click();
  await expect(page.locator(".wish")).toHaveCount(1);
  await page.click("#toast-undo");
  await expect(page.locator(".wish")).toHaveCount(2);
  await expect(wish(page, "Roman policier").locator(".wish-price")).toHaveText("12,50 €");

  // Renommer la liste
  await page.click("#list-title");
  await page.fill(".list-title-input", "Mes 30 ans");
  await page.keyboard.press("Enter");
  await expect(page.locator("#list-title")).toHaveText("Mes 30 ans");

  // Persistance après rechargement
  await page.reload();
  await expect(page.locator(".wish")).toHaveCount(2);
  await expect(page.locator("#list-title")).toHaveText("Mes 30 ans");
  await expect(page.locator("#btn-add")).toBeVisible();
});

test("image envoyée depuis le formulaire, puis retirée", async ({ page }) => {
  await createList(page, "Photos");
  await page.click("#btn-add");
  await page.fill("#item-name", "Lampe");
  // PNG 1×1 transparent
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    "base64",
  );
  await page.setInputFiles("#item-image-file", { name: "lampe.png", mimeType: "image/png", buffer: png });
  await expect(page.locator("#image-preview img")).toBeVisible();
  await page.click("#item-form button[type=submit]");

  const lampe = wish(page, "Lampe");
  await expect(lampe.locator(".wish-image")).toHaveAttribute("src", /\/items\/.+\/image\?v=1$/);

  await lampe.locator(".wish-edit").click();
  await page.click("#remove-image");
  await page.click("#item-form button[type=submit]");
  await expect(lampe.locator(".wish-placeholder")).toBeVisible();
});

test("image par URL", async ({ page }) => {
  await createList(page, "URL");
  await addWish(page, { name: "Vélo", imageUrl: "https://exemple.fr/velo.jpg" });
  await expect(wish(page, "Vélo").locator(".wish-image")).toHaveAttribute("src", "https://exemple.fr/velo.jpg");
});

test("partage en lecture seule : pas de modification possible, mise à jour en direct, compteur de connectés", async ({ browser }) => {
  const owner = await (await browser.newContext()).newPage();
  const { code } = await createList(owner, "Noël");
  await addWish(owner, { name: "Écharpe", price: "25" });
  await expect(owner.locator("#presence-count")).toHaveText("1");

  // Le lien de lecture affiché dans la modale de partage ne contient pas la clé.
  await owner.click("#btn-share");
  const readLink = await owner.locator("#share-read-url").textContent();
  expect(readLink).toMatch(new RegExp(`/l/${code}$`));
  await owner.click(".modal-close");

  const guestCtx = await browser.newContext();
  const guest = await guestCtx.newPage();
  await guest.goto(new URL(readLink!).pathname);
  await expect(guest.locator(".wish-name")).toHaveText(["Écharpe"]);

  // Mode lecture : bannière, aucun contrôle d'édition.
  await expect(guest.locator("#mode-banner")).toContainText("Mode lecture");
  await expect(guest.locator("#btn-add")).toBeHidden();
  await expect(guest.locator(".wish-edit, .wish-delete, .wish-handle")).toHaveCount(0);
  await guest.click("#list-title");
  await expect(guest.locator(".list-title-input")).toHaveCount(0);
  await guest.click("#btn-share");
  await expect(guest.locator(".edit-link-box")).toHaveCount(0);
  await guest.click(".modal-close");

  // Compteur de connectés, des deux côtés.
  await expect(guest.locator("#presence-count")).toHaveText("2");
  await expect(guest.locator("#banner-presence")).toHaveText("2 personnes connectées");
  await expect(owner.locator("#presence-count")).toHaveText("2");

  const guest2 = await (await browser.newContext()).newPage();
  await guest2.goto(`/l/${code}`);
  await expect(guest.locator("#banner-presence")).toHaveText("3 personnes connectées");
  await guest2.close();
  await expect(guest.locator("#banner-presence")).toHaveText("2 personnes connectées");
  await expect(owner.locator("#presence-count")).toHaveText("2");

  // Les modifications du propriétaire arrivent en direct chez l'invité.
  await addWish(owner, { name: "Gants" });
  await expect(guest.locator(".wish-name")).toHaveText(["Écharpe", "Gants"]);

  // Même un message forgé à la main sur le WebSocket est refusé par le serveur.
  const result = await guest.evaluate(async (listCode) => {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${location.host}/api/lists/${listCode}/ws?key=0123456789abcdef0123456789abcdef`);
    const messages: { type: string; canEdit?: boolean; message?: string }[] = [];
    ws.onmessage = (e) => messages.push(JSON.parse(e.data));
    await new Promise((r) => ws.addEventListener("open", r));
    ws.send(JSON.stringify({ type: "addItem", id: "pirate", name: "Piratage" }));
    ws.send(JSON.stringify({ type: "deleteItem", id: "x" }));
    await new Promise((r) => setTimeout(r, 500));
    ws.close();
    return messages;
  }, code);
  expect(result.find((m) => m.type === "welcome")?.canEdit).toBe(false);
  expect(result.filter((m) => m.type === "error").map((m) => m.message)).toEqual([
    "Cette liste est en lecture seule.",
    "Cette liste est en lecture seule.",
  ]);
  await expect(owner.locator(".wish-name")).toHaveText(["Écharpe", "Gants"]);

  // Écrire une image sans la clé est refusé aussi.
  const status = await guest.evaluate(async (listCode) => {
    const res = await fetch(`/api/lists/${listCode}/items/abc/image`, {
      method: "PUT",
      headers: { "content-type": "image/png" },
      body: new Uint8Array([1, 2, 3]),
    });
    return res.status;
  }, code);
  expect(status).toBe(403);

  // L'invité ne garde aucune clé d'édition, et sa liste apparaît en "Lecture".
  expect(await guest.evaluate(() => localStorage.getItem("kkjv:editKeys"))).toBeNull();
  await guest.click("#btn-back");
  await expect(guest.locator(".recent-item .mode-tag")).toHaveText("Lecture");
});

test("lien d'édition : ouvre la liste en édition sur un autre appareil, et la clé disparaît de l'URL", async ({ browser }) => {
  const owner = await (await browser.newContext()).newPage();
  const { code, editKey } = await createList(owner, "Multi-appareils");
  await owner.click("#btn-share");
  await owner.click(".edit-link-box summary");
  const editLink = await owner.locator("#share-edit-url").textContent();
  expect(editLink).toContain(`#cle=${editKey}`);

  const other = await (await browser.newContext()).newPage();
  const url = new URL(editLink!);
  await other.goto(url.pathname + url.hash);
  await expect(other.locator("#btn-add")).toBeVisible();
  expect(other.url()).not.toContain("cle=");
  await addWish(other, { name: "Ajouté ailleurs" });
  await expect(owner.locator(".wish-name")).toHaveText(["Ajouté ailleurs"]);

  // Une clé invalide retombe en lecture seule.
  const intruder = await (await browser.newContext()).newPage();
  await intruder.goto(`/l/${code}#cle=0123456789abcdef0123456789abcdef`);
  await expect(intruder.locator("#mode-banner")).toContainText("Mode lecture");
  await expect(intruder.locator("#btn-add")).toBeHidden();
});

test("aperçu invité depuis sa propre liste", async ({ page }) => {
  const { code } = await createList(page, "Aperçu");
  await addWish(page, { name: "Montre" });
  await page.click("#btn-menu");
  await page.click('[data-action="preview"]');
  await expect(page).toHaveURL(new RegExp(`/l/${code}\\?lecture$`));
  await expect(page.locator("#mode-banner")).toContainText("Mode lecture");
  await expect(page.locator(".wish-edit")).toHaveCount(0);
  await page.click("#btn-exit-preview");
  await expect(page.locator("#btn-add")).toBeVisible();
  await expect(page.locator(".wish-edit")).toHaveCount(1);
});

test("code inconnu", async ({ page }) => {
  await page.goto("/");
  await page.fill("#join-code", "ZZZZZZ");
  await page.click("#join-form button[type=submit]");
  await expect(page.locator("#join-error")).toHaveText("Aucune liste ne correspond à ce code.");
  await page.goto("/l/ZZZZZZ");
  await expect(page.locator("#state-message")).toHaveText("Aucune liste ne correspond à ce code.");
});
