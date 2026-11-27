(function () {
  'use strict';
  const NW = window.NW;

  function boot() {
    const scene = new NW.Scene(document.getElementById('sea'), document.getElementById('overlay'));
    const resize = () => scene.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1);
    resize();
    window.addEventListener('resize', resize);
    const app = new NW.App(scene);

    // Adaptive resolution for the sea shader: keep the frame rate smooth on slower GPUs.
    let last = performance.now();
    let ema = 16, judge = 0;
    function frame(now) {
      const raw = (now - last) / 1000;
      last = now;
      if (raw < 0.25) {
        ema = ema * 0.95 + raw * 1000 * 0.05;
        judge += raw;
        if (judge > 2) {
          judge = 0;
          if (ema > 24 && scene.glScale > 0.5) { scene.glScale *= 0.85; resize(); }
          else if (ema < 13 && scene.glScale < 1) { scene.glScale = Math.min(1, scene.glScale * 1.1); resize(); }
        }
      }
      const dt = Math.min(0.05, Math.max(0, raw));
      scene.update(dt);
      scene.render();
      app.tick(dt);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    window.__nightwatch = { scene, app };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
