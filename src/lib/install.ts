// Installation de l'app sur l'écran d'accueil (PWA, voir vite.config.ts).
// - Android / Chrome / Edge : le navigateur émet `beforeinstallprompt`, qu'on
//   garde de côté pour déclencher l'invite native au clic sur notre bouton.
// - iPhone / iPad (Safari) : pas d'invite programmable, on affiche à la
//   place la marche à suivre (Partager → Sur l'écran d'accueil).
// Rien n'est proposé une fois l'app déjà lancée en mode installé.

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/** À appeler une fois au démarrage (main.ts), avant le premier rendu : le
 * navigateur peut émettre l'événement très tôt. */
export function initInstallPrompt(): void {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    notify();
  });
}

export function isStandalone(): boolean {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function isIos(): boolean {
  const ua = navigator.userAgent;
  // iPadOS se présente comme un Mac, mais tactile.
  return /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

export function canOfferInstall(): boolean {
  if (isStandalone()) return false;
  return deferredPrompt !== null || isIos();
}

/** Prévient quand la possibilité d'installer change (invite reçue, app
 * installée), pour réafficher/masquer le bouton. */
export function onInstallAvailabilityChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Lance l'installation : invite native si disponible, sinon `onManual`
 * (marche à suivre, iOS). */
export async function promptInstall(onManual: () => void): Promise<void> {
  if (!deferredPrompt) {
    onManual();
    return;
  }
  const prompt = deferredPrompt;
  // Une invite ne peut servir qu'une fois.
  deferredPrompt = null;
  await prompt.prompt();
  await prompt.userChoice.catch(() => undefined);
  notify();
}
