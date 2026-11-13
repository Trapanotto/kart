import { createApp } from './game/app';
import { connectRumble } from './input';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLElement;

createApp(canvas, ui).then((app) => {
  // Debug handle for the console and automated checks.
  (window as any).__kart = app;
  connectRumble(app);
});
