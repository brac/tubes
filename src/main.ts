import { Application } from 'pixi.js';

// Bootstrap the Pixi v8 application onto the #app container.
// Real rendering (tubes, nodes, particles) begins in Phase 5.
async function init(): Promise<void> {
  const container = document.getElementById('app');
  if (!container) {
    throw new Error('Mount target #app not found');
  }

  const app = new Application();

  await app.init({
    resizeTo: window,
    background: '#0a0a0f',
    antialias: true,
    // Cap at 2x so high-DPI phones don't thrash the GPU.
    resolution: Math.min(window.devicePixelRatio, 2),
    autoDensity: true,
  });

  // Pixi v8 exposes app.canvas (HTMLCanvasElement), not the legacy app.view.
  container.appendChild(app.canvas);
}

init().catch((err: unknown) => {
  console.error('[Tubes] Pixi init failed:', err);
});
