import { test, expect, type Page, type Browser } from "@playwright/test";

async function ownerWithList(browser: Browser): Promise<{ owner: Page; code: string; frames: string[] }> {
  const owner = await (await browser.newContext()).newPage();
  // Tout ce que le propriétaire reçoit sur le WebSocket, pour vérifier
  // qu'aucune réservation n'y passe jamais.
  const frames: string[] = [];
  owner.on("websocket", (ws) => ws.on("framereceived", (f) => frames.push(String(f.payload))));
  await owner.goto("/");
  await owner.fill("#create-name", "Noël");
  await owner.click("#create-form button[type=submit]");
  await owner.waitForURL(/\/l\//);
  await expect(owner.locator("#conn-dot")).toHaveClass(/online/, { timeout: 10_000 });
  for (const name of ["Écharpe", "Livre"]) {
    await owner.click("#btn-add");
    await owner.fill("#item-name", name);
    await owner.click("#item-form button[type=submit]");
    await expect(owner.locator(".wish-name", { hasText: name })).toBeVisible();
  }
  return { owner, code: owner.url().split("/l/")[1], frames };
}

async function guest(browser: Browser, code: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto(`/l/${code}`);
  await expect(page.locator("#conn-dot")).toHaveClass(/online/, { timeout: 10_000 });
  return page;
}

const wish = (page: Page, name: string) => page.locator(".wish", { has: page.locator(".wish-name", { hasText: name }) });

test("un invité réserve un souhait : les autres invités le voient, le propriétaire jamais", async ({ browser }) => {
  const { owner, code, frames } = await ownerWithList(browser);
  const alice = await guest(browser, code);
  const bob = await guest(browser, code);

  await expect(alice.locator(".mode-banner-hint")).toContainText("ne voit pas les réservations");
  await wish(alice, "Écharpe").locator(".reserve-btn").click();
  await expect(wish(alice, "Écharpe").locator(".reservation-badge")).toHaveText("Réservé par toi");
  await expect(alice.locator("#toast")).toContainText("Réservé !");

  // Bob voit que c'est pris, sans pouvoir réserver.
  await expect(wish(bob, "Écharpe").locator(".reservation-badge")).toHaveText("Déjà réservé");
  await expect(wish(bob, "Écharpe")).toHaveClass(/wish-reserved/);
  await expect(wish(bob, "Écharpe").locator(".reserve-btn, .unreserve-btn")).toHaveCount(0);
  await expect(wish(bob, "Livre").locator(".reserve-btn")).toBeVisible();

  // Le propriétaire ne voit rien, et ne reçoit rien.
  await owner.reload();
  await expect(owner.locator(".wish")).toHaveCount(2);
  await expect(owner.locator(".reservation, .reservation-badge, .reserve-btn, .wish-reserved")).toHaveCount(0);
  expect(frames.length).toBeGreaterThan(0);
  expect(frames.some((f) => f.includes("reserved"))).toBe(false);

  // Ni dans son aperçu invité.
  const previewFrames: string[] = [];
  owner.on("websocket", (ws) => ws.on("framereceived", (f) => previewFrames.push(String(f.payload))));
  await owner.click("#btn-menu");
  await owner.click('[data-action="preview"]');
  await expect(owner.locator("#mode-banner")).toContainText("Mode lecture");
  await expect(owner.locator(".mode-banner-hint")).toContainText("restent cachées");
  await expect(owner.locator(".wish")).toHaveCount(2);
  await expect(owner.locator(".reservation, .reserve-btn")).toHaveCount(0);
  // La liste s'affiche d'abord depuis le cache : on attend l'état envoyé
  // par le serveur à cette connexion d'aperçu avant de l'inspecter.
  await expect.poll(() => previewFrames.some((f) => f.includes('"type":"state"'))).toBe(true);
  expect(previewFrames.some((f) => f.includes("reserved"))).toBe(false);

  // La réservation survit au rechargement, chez Alice comme chez Bob.
  await alice.reload();
  await expect(wish(alice, "Écharpe").locator(".reservation-badge")).toHaveText("Réservé par toi");

  // Alice annule : Bob peut de nouveau réserver.
  await wish(alice, "Écharpe").locator(".unreserve-btn").click();
  await expect(wish(alice, "Écharpe").locator(".reserve-btn")).toBeVisible();
  await expect(wish(bob, "Écharpe").locator(".reserve-btn")).toBeVisible();
  await wish(bob, "Écharpe").locator(".reserve-btn").click();
  await expect(wish(bob, "Écharpe").locator(".reservation-badge")).toHaveText("Réservé par toi");
  await expect(wish(alice, "Écharpe").locator(".reservation-badge")).toHaveText("Déjà réservé");
});

test("on ne peut ni voler ni annuler la réservation d'un autre, et le propriétaire ne peut pas réserver", async ({ browser }) => {
  const { owner, code } = await ownerWithList(browser);
  const alice = await guest(browser, code);
  await wish(alice, "Livre").locator(".reserve-btn").click();
  await expect(wish(alice, "Livre").locator(".reservation-badge")).toHaveText("Réservé par toi");
  const itemId = await wish(alice, "Livre").getAttribute("data-id");

  const send = (page: Page, query: string, msg: object) =>
    page.evaluate(
      async ({ code, query, msg }) => {
        const proto = location.protocol === "https:" ? "wss:" : "ws:";
        const ws = new WebSocket(`${proto}//${location.host}/api/lists/${code}/ws${query}`);
        const errors: string[] = [];
        ws.onmessage = (e) => {
          const data = JSON.parse(e.data);
          if (data.type === "error") errors.push(data.message);
        };
        await new Promise((r) => ws.addEventListener("open", r));
        ws.send(JSON.stringify(msg));
        await new Promise((r) => setTimeout(r, 500));
        ws.close();
        return errors;
      },
      { code, query, msg },
    );

  const mallory = await guest(browser, code);
  const otherToken = "f".repeat(32);
  expect(await send(mallory, "", { type: "unreserveItem", id: itemId, token: otherToken })).toEqual([
    "Seule la personne qui a réservé peut annuler.",
  ]);
  expect(await send(mallory, "", { type: "reserveItem", id: itemId, token: otherToken })).toEqual([
    "Ce souhait est déjà réservé par quelqu'un d'autre.",
  ]);
  await expect(wish(alice, "Livre").locator(".reservation-badge")).toHaveText("Réservé par toi");

  const editKey = await owner.evaluate((c) => JSON.parse(localStorage.getItem("kkjv:editKeys")!)[c], code);
  expect(await send(owner, `?key=${editKey}`, { type: "reserveItem", id: itemId, token: otherToken })).toEqual([
    "Cette liste est en lecture seule.",
  ]);
});
