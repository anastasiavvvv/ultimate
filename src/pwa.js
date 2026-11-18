// Регистрация service worker и обработка установки PWA.
// Экспортирует canInstall()/promptInstall() для кнопки «Установить» в настройках.
import { toast } from './ui.js';

let deferredPrompt = null;
const listeners = new Set();

export function canInstall() { return !!deferredPrompt; }
export function onInstallChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}
export async function promptInstall() {
  if (!deferredPrompt) return false;
  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  deferredPrompt = null;
  listeners.forEach((fn) => fn());
  return outcome === 'accepted';
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  listeners.forEach((fn) => fn());
});
window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  listeners.forEach((fn) => fn());
  toast('ULTIMATE установлен');
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('sw.js');
      // Новая версия скачана и ждёт — применяем и перезагружаем один раз.
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        nw?.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) {
            toast('Доступно обновление, перезагружаю…', 1800);
            nw.postMessage('skipWaiting');
          }
        });
      });
      let reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloaded) return; reloaded = true;
        if (navigator.serviceWorker.controller) location.reload();
      });
    } catch (err) {
      console.warn('Service worker не зарегистрирован:', err);
    }
  });
}
