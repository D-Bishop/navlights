/*
 * The scene: an observer on a small boat (eye 3 m above the water) watching a distant
 * vessel through binoculars. Owns the camera, vessel motion, silhouettes and light glows.
 */
(function () {
  'use strict';
  const NW = (window.NW = window.NW || {});
  const V = NW.Vessels;
  const DEG = Math.PI / 180;
  const REFF = 6371000 / (1 - 0.13); // effective earth radius incl. standard refraction
  const CAM_H = 3.0;
  const DH = Math.sqrt(2 * REFF * CAM_H); // distance to your sea horizon (~6.6 km)
  const MAXL = NW.SEA_LIMITS.NLIGHTS;

  const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const lerp = (a, b, t) => a + (b - a) * t;

  function convexHull(pts) {
    if (pts.length < 3) return pts;
    const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [], upper = [];
    for (const q of p) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
      lower.push(q);
    }
    for (let i = p.length - 1; i >= 0; i--) {
      const q = p[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
      upper.push(q);
    }
    upper.pop(); lower.pop();
    return lower.concat(upper);
  }

  // Pre-rendered glow sprites (one per light color): crisp core, soft bloom, wide faint halo.
  function makeSprite(rgb, whiten) {
    const S = 128;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');
    const img = g.createImageData(S, S);
    const core = rgb.map((v) => lerp(v, 1, whiten));
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const r = Math.hypot(x + 0.5 - S / 2, y + 0.5 - S / 2) / (S / 2);
        const k = Math.exp(-Math.pow(r / 0.05, 2)) * 1.4;
        const gl = Math.exp(-Math.pow(r / 0.15, 2)) * 0.5;
        const halo = r < 1 ? Math.exp(-r * 4.5) * 0.22 * (1 - r) * (1 - r) : 0;
        const col = [0, 1, 2].map((i) => rgb[i] * (gl + halo) + core[i] * k);
        const a = clamp(Math.max(col[0], col[1], col[2]), 0, 1);
        const i4 = (y * S + x) * 4;
        img.data[i4] = a > 0 ? clamp((col[0] / a) * 255, 0, 255) : 0;
        img.data[i4 + 1] = a > 0 ? clamp((col[1] / a) * 255, 0, 255) : 0;
        img.data[i4 + 2] = a > 0 ? clamp((col[2] / a) * 255, 0, 255) : 0;
        img.data[i4 + 3] = a * 255;
      }
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  class Spring {
    constructor(v, w) { this.v = v; this.vel = 0; this.w = w; }
    step(target, dt, w = this.w) {
      if (!Number.isFinite(target)) return this.v;
      if (!Number.isFinite(this.v) || !Number.isFinite(this.vel)) { this.v = target; this.vel = 0; }
      const n = Math.max(1, Math.ceil(dt / 0.008));
      const h = dt / n;
      for (let i = 0; i < n; i++) {
        this.vel += (w * w * (target - this.v) - 2 * w * this.vel) * h;
        this.v += this.vel * h;
      }
      return this.v;
    }
  }

  class Scene {
    constructor(seaCanvas, overlayCanvas) {
      this.seaCanvas = seaCanvas;
      this.ov = overlayCanvas;
      this.ctx = overlayCanvas.getContext('2d');
      this.waves = NW.createWaves(20251125);
      this.sea = null;
      try {
        this.sea = new NW.Sea(seaCanvas, this.waves);
      } catch (e) {
        console.warn(e);
        document.body.classList.add('no-webgl');
      }
      this.time = 0;
      this.zoom = 1;
      this.moon = 0.3;
      this.reveal = 0;
      this.revealTarget = 0;
      this.targetFracY = 0.36;
      this.fogK = 0; // 1 / visibility (m⁻¹); 0 = clear
      this.glScale = 1;
      this.W = 1; this.H = 1;

      this.yaw = new Spring(0, 1.9);
      this.pitch = new Spring(-0.01, 2.4);
      this.logTan = new Spring(Math.log(Math.tan(5 * DEG)), 1.8);
      this.cam = { pos: [0, CAM_H, 0], F: [0, 0, 1], R: [1, 0, 0], U: [0, 1, 0], tanX: 0.1, tanY: 0.06 };

      this.vessel = null;
      this.old = null;
      this.lightPos = new Float32Array(MAXL * 3);
      this.lightCol = new Float32Array(MAXL * 3);
      this.sprites = {};
      for (const [k, c] of Object.entries(V.COLORS)) this.sprites[k] = makeSprite(c.rgb, k === 'W' || k === 'Y' ? 0.75 : 0.45);
    }

    resize(cssW, cssH, dpr) {
      cssW = Math.max(1, cssW || 1);
      cssH = Math.max(1, cssH || 1);
      this.W = cssW; this.H = cssH;
      this.dpr = Math.min(dpr, 2);
      this.ov.width = Math.round(cssW * this.dpr);
      this.ov.height = Math.round(cssH * this.dpr);
      if (this.sea) {
        const s = Math.min(dpr, 1.5) * this.glScale;
        this.sea.resize(Math.max(1, Math.round(cssW * s)), Math.max(1, Math.round(cssH * s)));
      }
    }

    // ------------------------------------------------------------ vessels
    show(round) {
      if (this.vessel) {
        this.old = this.vessel;
        this.old.fadeDir = -1;
      }
      // Pick a new direction to look, away from the last one.
      const cur = this.vessel ? this.vessel.az : 0;
      let az = 0;
      for (let i = 0; i < 12; i++) {
        az = (Math.random() * 2 - 1) * 0.65;
        if (!this.vessel || Math.abs(az - cur) > 0.3) break;
      }
      if (!this.vessel) this.snap = true;
      this.vessel = this.makeVessel(round.cfg, round.beta, round.dist, az);
      this.vessel.delay = this.old ? 1.3 : 0.4;
      this.revealTarget = 0;
    }

    makeVessel(cfg, beta, dist, az) {
      const bodies = cfg.bodies.map((def, i) => {
        const parts = V.MODELS[def.model]();
        let zmin = Infinity, zmax = -Infinity;
        for (const p of parts) for (const q of p.pts) { zmin = Math.min(zmin, q[2]); zmax = Math.max(zmax, q[2]); }
        const len = zmax - zmin;
        return {
          def, parts, len,
          heave: 0, pitch: 0, roll: 0, yawOff: 0,
          ph: Math.random() * 10 + i * 3.1,
          rollT: 4 + Math.min(len, 120) * 0.06 + Math.random(),
          rollAmp: clamp(0.3 / Math.sqrt(len), 0.008, 0.075),
          cx: 0, cz: 0, psi: 0,
        };
      });
      // Extents in the group frame, as seen from this aspect.
      const cb = Math.cos(beta * DEG), sb = Math.sin(beta * DEG);
      let umin = Infinity, umax = -Infinity, zmin = Infinity, zmax = -Infinity, ymax = 0;
      for (const b of bodies) {
        for (const p of b.parts) for (const q of p.pts) {
          const z = q[2] + b.def.z;
          const u = -q[0] * cb + z * sb;
          umin = Math.min(umin, u); umax = Math.max(umax, u);
          zmin = Math.min(zmin, z); zmax = Math.max(zmax, z);
          ymax = Math.max(ymax, q[1]);
        }
        for (const l of b.def.lights) ymax = Math.max(ymax, l.p[1]);
      }
      // Closest pair of lights you can see from here: we must zoom enough to split them.
      const seen = [];
      let lx = 0, lz = 0, lu0 = Infinity, lu1 = -Infinity;
      for (const b of bodies) for (const l of b.def.lights) {
        if (!V.arcHard(l, beta)) continue;
        const u = -l.p[0] * cb + (l.p[2] + b.def.z) * sb;
        seen.push([u, l.p[1]]);
        lx += l.p[0]; lz += l.p[2] + b.def.z;
        lu0 = Math.min(lu0, u); lu1 = Math.max(lu1, u);
      }
      if (seen.length) { lx /= seen.length; lz /= seen.length; } else { lu0 = umin; lu1 = umax; }
      let minSep = Infinity;
      for (let i = 0; i < seen.length; i++) for (let j = i + 1; j < seen.length; j++) {
        const d = Math.hypot(seen[i][0] - seen[j][0], seen[i][1] - seen[j][1]);
        if (d >= 0.5) minSep = Math.min(minSep, d); // tricolor sectors share one lantern
      }
      const centerZ = (zmin + zmax) / 2;
      const psi = az + Math.PI - beta * DEG;
      const F = [Math.sin(psi), Math.cos(psi)];
      return {
        cfg, beta, dist, az, psi, bodies, centerZ,
        // Look at her lights — they're what you're judging.
        aimX: seen.length ? lx : 0, aimZ: seen.length ? lz : centerZ,
        ox: Math.sin(az) * dist - F[0] * centerZ,
        oz: Math.cos(az) * dist - F[1] * centerZ,
        speed: cfg.making ? cfg.speed : 0,
        spanU: umax - umin, lightSpanU: lu1 - lu0 + 6, ymax, minSep,
        fade: 0, fadeDir: 1, delay: 0,
      };
    }

    updateVessel(v, dt, t) {
      const F = [Math.sin(v.psi), Math.cos(v.psi)];
      if (v.speed) {
        // Stop drifting once the range gets silly (if someone leaves it running for ages).
        const d = Math.hypot(v.ox + F[0] * v.centerZ, v.oz + F[1] * v.centerZ);
        const toward = (v.ox * F[0] + v.oz * F[1]) < 0;
        const ok = toward ? d > 320 : d < 3600;
        if (ok) { v.ox += F[0] * v.speed * dt; v.oz += F[1] * v.speed * dt; }
      }
      const k = 1 - Math.exp(-dt / 0.5);
      // Big ships far off barely move against the horizon. Exaggerate the swell a little
      // (relative to how zoomed in we are) so every vessel visibly rises and falls.
      const pxPerM = this.H / (2 * Math.max(this.cam.tanY || 0.05, 1e-3) * v.dist);
      // (Less exaggeration out past the horizon, where the swell decides what you see.)
      const boost = clamp(5 / (pxPerM * 0.45), 1, v.dist > DH * 0.9 ? 1.5 : 3.5);
      for (const b of v.bodies) {
        b.cx = v.ox + F[0] * b.def.z;
        b.cz = v.oz + F[1] * b.def.z;
        b.yawOff = 0.25 * DEG * Math.sin(t * 0.13 + b.ph);
        b.psi = v.psi + b.yawOff;
        const Fx = Math.sin(b.psi), Fz = Math.cos(b.psi);
        const heave = this.waves.height(b.cx, b.cz, t, Math.max(3, b.len * 0.45)) * (1.15 - Math.min(b.len, 150) / 300);
        const g = this.waves.grad(b.cx, b.cz, t, Math.max(5, b.len * 0.7));
        const gF = g[0] * Fx + g[1] * Fz;
        const gS = g[0] * Fz - g[1] * Fx;
        const pitch = Math.atan(gF) * 0.7 * Math.sqrt(boost);
        const roll = Math.atan(gS) * 0.9 + b.rollAmp * this.waves.scale * Math.sin((t * Math.PI * 2) / b.rollT + b.ph);
        b.heave += (heave * boost - b.heave) * k;
        b.pitch += (pitch - b.pitch) * k;
        b.roll += (roll - b.roll) * k;
      }
      if (v.delay > 0) v.delay -= dt;
      else v.fade = clamp(v.fade + (v.fadeDir > 0 ? dt / 1.8 : -dt / 0.7), 0, 1);
    }

    toWorld(b, p) {
      const Fx = Math.sin(b.psi), Fz = Math.cos(b.psi);
      const Sx = Fz, Sz = -Fx;
      const cr = Math.cos(b.roll), sr = Math.sin(b.roll);
      const x1 = p[0] * cr + p[1] * sr, y1 = -p[0] * sr + p[1] * cr;
      const cp = Math.cos(b.pitch), sp = Math.sin(b.pitch);
      const y2 = y1 * cp + p[2] * sp, z2 = p[2] * cp - y1 * sp;
      const wx = b.cx + Sx * x1 + Fx * z2;
      const wz = b.cz + Sz * x1 + Fz * z2;
      const r2 = wx * wx + wz * wz;
      return [wx, y2 + b.heave - r2 / (2 * REFF), wz];
    }

    // Bearing of the observer from body b, clockwise from its bow (degrees).
    betaOf(b) {
      const dx = -b.cx, dz = -b.cz;
      const Fx = Math.sin(b.psi), Fz = Math.cos(b.psi);
      return Math.atan2(dx * Fz - dz * Fx, dx * Fx + dz * Fz) / DEG;
    }

    // ------------------------------------------------------------ camera
    framingTan(v) {
      const aspect = this.W / this.H;
      const h = (v.ymax * 1.15) / v.dist;
      const w = v.spanU / v.dist;
      // Preferred: small in the frame, a vessel far off on a dark sea...
      const pref = Math.max(w / 0.2 / 2, (h / 0.17 / 2) * aspect);
      // ...zoomed in only as far as needed to split her closest pair of lights (~14 px)...
      const sepLimit = Number.isFinite(v.minSep) ? ((v.minSep / v.dist) * this.W) / 28 : Infinity;
      // ...and never so far that her lights (and her tow's) won't fit.
      const fitMax = Math.max(v.lightSpanU / v.dist / 0.8 / 2, (h / 0.6 / 2) * aspect);
      let tanX = Math.max(fitMax, Math.min(pref, sepLimit));
      tanX = clamp(tanX, Math.tan(0.12 * DEG), Math.tan(16 * DEG));
      return tanX / this.zoom;
    }

    updateCamera(dt, t) {
      const v = this.vessel;
      let aimYaw = this.yaw.v, aimPitch = this.pitch.v, aimTan = Math.exp(this.logTan.v);
      if (v) {
        const F = [Math.sin(v.psi), Math.cos(v.psi)];
        const S = [F[1], -F[0]];
        const tx = v.ox + F[0] * v.aimZ + S[0] * v.aimX, tz = v.oz + F[1] * v.aimZ + S[1] * v.aimX;
        const hd = Math.hypot(tx, tz);
        const ty = v.ymax * 0.45 - (hd * hd) / (2 * REFF);
        aimTan = this.framingTan(v);
        const tanY = aimTan * (this.H / this.W);
        aimYaw = this.yaw.v + wrapPi(Math.atan2(tx, tz) - this.yaw.v);
        aimPitch = Math.atan2(ty - CAM_H, hd) - Math.atan((1 - 2 * this.targetFracY) * tanY);
        if (this.snap) {
          this.snap = false;
          Object.assign(this.yaw, { v: aimYaw, vel: 0 });
          Object.assign(this.pitch, { v: aimPitch, vel: 0 });
          Object.assign(this.logTan, { v: Math.log(aimTan), vel: 0 });
        }
      }
      const yaw = this.yaw.step(aimYaw, dt);
      const tanX = Math.exp(this.logTan.step(Math.log(aimTan), dt));
      const pitch0 = this.pitch.step(aimPitch, dt);
      const tanY = tanX * (this.H / this.W);

      // Our own boat moves too: heave, a little pitch & roll, binocular wobble.
      const camY = CAM_H + 0.55 * this.waves.height(0, 0, t, 10);
      const g = this.waves.grad(0, 0, t, 12);
      const gF = g[0] * Math.sin(yaw) + g[1] * Math.cos(yaw);
      const gS = g[0] * Math.cos(yaw) - g[1] * Math.sin(yaw);
      const vfov = Math.atan(tanY) * 2;
      const ss = this.waves.scale;
      const pitch = pitch0 + vfov * (0.5 * gF + ss * (0.018 * Math.sin(t * 0.83) + 0.008 * Math.sin(t * 2.3)));
      const roll = 0.08 * gS + ss * 0.0045 * Math.sin((t * Math.PI * 2) / 7.3);
      const yawJ = yaw + vfov * (0.012 * Math.sin(t * 0.61) + 0.005 * Math.sin(t * 1.9));

      const cp = Math.cos(pitch), sp = Math.sin(pitch);
      const F = [Math.sin(yawJ) * cp, sp, Math.cos(yawJ) * cp];
      const R0 = [Math.cos(yawJ), 0, -Math.sin(yawJ)];
      const U0 = [F[1] * R0[2] - F[2] * R0[1], F[2] * R0[0] - F[0] * R0[2], F[0] * R0[1] - F[1] * R0[0]];
      const cr = Math.cos(roll), sr = Math.sin(roll);
      const R = [0, 1, 2].map((i) => R0[i] * cr + U0[i] * sr);
      const U = [0, 1, 2].map((i) => U0[i] * cr - R0[i] * sr);
      Object.assign(this.cam, { pos: [0, camY, 0], F, R, U, tanX, tanY });
    }

    project(p) {
      const c = this.cam;
      const rx = p[0] - c.pos[0], ry = p[1] - c.pos[1], rz = p[2] - c.pos[2];
      const z = rx * c.F[0] + ry * c.F[1] + rz * c.F[2];
      if (z <= 1) return null;
      const sx = (rx * c.R[0] + ry * c.R[1] + rz * c.R[2]) / z / c.tanX;
      const sy = (rx * c.U[0] + ry * c.U[1] + rz * c.U[2]) / z / c.tanY;
      return [(sx + 1) * 0.5 * this.W, (1 - sy) * 0.5 * this.H];
    }

    // ------------------------------------------------------------ frame
    update(dt) {
      this.time += dt;
      const t = this.time;
      this.reveal += (this.revealTarget - this.reveal) * (1 - Math.exp(-dt / 0.6));
      if (this.vessel) this.updateVessel(this.vessel, dt, t);
      if (this.old) {
        this.updateVessel(this.old, dt, t);
        if (this.old.fade <= 0) this.old = null;
      }
      this.updateCamera(dt, t);
    }

    // 0..1: can the eye see a point at world position w (horizontal range d) over the curved,
    // wavy sea? Checks the sight line near the horizon tangent point and just in front of
    // the vessel, where swell crests can hide low lights.
    horizonVis(w, d) {
      if (d < DH * 0.75) return 1;
      const H = this.cam.pos[1];
      const hl = w[1] + (d * d) / (2 * REFF); // height above her local sea level
      const ux = w[0] / d, uz = w[2] / d;
      let minC = Infinity;
      for (const x of [DH * 0.85, DH, DH * 1.12, d - 350, d - 120, d - 40]) {
        if (x <= 0 || x >= d) continue;
        const lineH = H * (1 - x / d) + hl * (x / d) - (x * (d - x)) / (2 * REFF);
        minC = Math.min(minC, lineH - this.waves.height(ux * x, uz * x, this.time, 2));
      }
      if (minC === Infinity) return 1;
      const s = clamp((minC + 0.15) / 0.3, 0, 1);
      return s * s * (3 - 2 * s);
    }

    collectLights() {
      const out = [];
      const t = this.time;
      for (const v of [this.old, this.vessel]) {
        if (!v || v.fade <= 0) continue;
        const fade = v.fade * v.fade * (3 - 2 * v.fade);
        v.bodies.forEach((b, bi) => {
          const beta = this.betaOf(b);
          b.def.lights.forEach((l, li) => {
            let I = V.arcVis(l, beta, 0.8);
            if (I <= 0) return;
            const hz = V.lightHz(l);
            if (hz) I *= clamp(Math.sin(t * Math.PI * 2 * hz) * 4 + 1.5, 0, 1);
            const seed = bi * 13.7 + li * 3.1;
            I *= 1 + 0.1 * Math.sin(t * 13 + seed) * Math.sin(t * 7.3 + seed * 2);
            const w = this.toWorld(b, l.p);
            const d = Math.hypot(w[0], w[2]);
            // Air extinction, fog, and whether the horizon/swell is in the way.
            I *= fade * V.rangeFactor(d, l, b.len) * Math.exp(-1.2 * d * this.fogK) * this.horizonVis(w, d);
            if (I > 0.003) out.push({ w, I, c: V.lightColor(l), f: 1 - Math.exp(-d * this.fogK) });
          });
        });
      }
      return out;
    }

    render() {
      const lights = this.collectLights();
      const moon = clamp(this.moon + this.reveal * 0.45, 0, 1);
      if (this.sea) {
        const n = Math.min(lights.length, MAXL);
        const sorted = lights.slice().sort((a, b) => b.I - a.I);
        for (let i = 0; i < n; i++) {
          const L = sorted[i];
          const rgb = V.COLORS[L.c].rgb;
          // The light sprites keep the same apparent brightness at any range, so scale the
          // reflection the same way (glitter ∝ 1/r² from the light, sprite would be too).
          const k = L.I * Math.min(2, (L.w[0] * L.w[0] + L.w[2] * L.w[2]) / (650 * 650));
          this.lightPos.set(L.w, i * 3);
          this.lightCol.set([rgb[0] * k, rgb[1] * k, rgb[2] * k], i * 3);
        }
        this.sea.render({
          cam: this.cam, tanX: this.cam.tanX, tanY: this.cam.tanY, time: this.time,
          moon, dip: Math.sqrt((2 * this.cam.pos[1]) / REFF),
          lightPos: this.lightPos, lightCol: this.lightCol, lightCount: n,
          glint: 5 * clamp(1.25 - 0.9 * this.waves.scale, 0.08, 1), exposure: 1.0, fog: this.fogK,
        });
      }

      const ctx = this.ctx;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, this.W, this.H);
      for (const v of [this.old, this.vessel]) if (v && v.fade > 0) this.drawSilhouette(v, moon);

      ctx.globalCompositeOperation = 'lighter';
      const size = 44;
      for (const L of lights) {
        const s = this.project(L.w);
        if (!s) continue;
        const sz = size * (0.55 + 0.45 * clamp(L.I, 0, 1));
        ctx.globalAlpha = clamp(L.I, 0, 1);
        ctx.drawImage(this.sprites[L.c], s[0] - sz / 2, s[1] - sz / 2, sz, sz);
        if (L.f > 0.02) {
          // Fog scatters the light into a wide soft glow.
          const big = sz * (1 + 7 * L.f);
          ctx.globalAlpha = clamp(L.I * 1.1 * L.f, 0, 1);
          ctx.drawImage(this.sprites[L.c], s[0] - big / 2, s[1] - big / 2, big, big);
        }
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    drawSilhouette(v, moon) {
      const ctx = this.ctx;
      const lit = clamp(moon * 0.35 + this.reveal * 0.5, 0, 1);
      const haze = Math.exp(-v.dist / 30000) * Math.exp(-3.2 * v.dist * this.fogK);
      // Moonless nights: hulls vanish into the dark, and sooner the farther away they are.
      const dark = clamp(0.1 + 2.2 * moon, 0, 1) * Math.exp(-v.dist / (1500 + 12000 * moon));
      const a = v.fade * 0.96 * haze * dark;
      const hullC = [lerp(3, 30, lit), lerp(5, 37, lit), lerp(8, 48, lit)];
      const sailC = [lerp(7, 95, lit), lerp(9, 104, lit), lerp(13, 118, lit)];
      const fill = (c) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

      // Beyond the horizon: hide whatever of her is below it (hull-down).
      ctx.save();
      if (v.dist > DH * 0.9) {
        const az = Math.atan2(v.ox, v.oz);
        const p1 = this.project([Math.sin(az - 0.02) * DH, -CAM_H, Math.cos(az - 0.02) * DH]);
        const p2 = this.project([Math.sin(az + 0.02) * DH, -CAM_H, Math.cos(az + 0.02) * DH]);
        if (p1 && p2 && Math.abs(p2[0] - p1[0]) > 1e-3) {
          const m = (p2[1] - p1[1]) / (p2[0] - p1[0]);
          const yL = p1[1] - m * p1[0], yR = p1[1] + m * (this.W - p1[0]);
          ctx.beginPath();
          ctx.moveTo(-10, -10); ctx.lineTo(this.W + 10, -10); ctx.lineTo(this.W + 10, yR); ctx.lineTo(-10, yL);
          ctx.closePath();
          ctx.clip();
        }
      }

      for (const tone of ['hull', 'sail']) {
        ctx.fillStyle = fill(tone === 'hull' ? hullC : sailC);
        for (const b of v.bodies) {
          for (const part of b.parts) {
            if (part.tone !== tone) continue;
            const pts = [];
            for (const q of part.pts) {
              const s = this.project(this.toWorld(b, q));
              if (!s) { pts.length = 0; break; }
              pts.push(s);
            }
            if (pts.length < 3) continue;
            const h = convexHull(pts);
            ctx.beginPath();
            ctx.moveTo(h[0][0], h[0][1]);
            for (let i = 1; i < h.length; i++) ctx.lineTo(h[i][0], h[i][1]);
            ctx.closePath();
            ctx.fill();
          }
        }
      }

      // Towline (all but invisible at night — it shows up when the moon comes out).
      if (v.cfg.towLine && v.bodies.length > 1) {
        const tug = v.bodies[0], tow = v.bodies[1];
        const p0 = this.toWorld(tug, [0, 1.6, -tug.len / 2]);
        const p1 = this.toWorld(tow, [0, 1.6, tow.len / 2]);
        ctx.strokeStyle = fill(hullC);
        ctx.globalAlpha = 0.25 + this.reveal * 0.6;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 0; i <= 16; i++) {
          const s = i / 16;
          const q = this.project([lerp(p0[0], p1[0], s), lerp(p0[1], p1[1], s) - Math.sin(Math.PI * s) * 1.6, lerp(p0[2], p1[2], s)]);
          if (!q) continue;
          if (i === 0) ctx.moveTo(q[0], q[1]); else ctx.lineTo(q[0], q[1]);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    }

    rangeNm() {
      const v = this.vessel;
      if (!v) return 0;
      const F = [Math.sin(v.psi), Math.cos(v.psi)];
      return Math.hypot(v.ox + F[0] * v.centerZ, v.oz + F[1] * v.centerZ) / 1852;
    }

    bearingDeg() {
      const v = this.vessel;
      if (!v) return 0;
      const F = [Math.sin(v.psi), Math.cos(v.psi)];
      const b = Math.atan2(v.ox + F[0] * v.centerZ, v.oz + F[1] * v.centerZ) / DEG;
      return (b + 360 + 35) % 360; // our boat's heading is 035° — purely cosmetic
    }
  }

  NW.Scene = Scene;
  NW.HORIZON = { REFF, CAM_H, DH };
})();
