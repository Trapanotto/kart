import { createApp } from './game/app';
import { connectRumble } from './input';

// Keep downloaded game files on the device for the next visit (production only).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
}

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLElement;

createApp(canvas, ui).then((app) => {
  // Debug handle for the console and automated checks.
  (window as any).__kart = app;
  connectRumble(app);
});
