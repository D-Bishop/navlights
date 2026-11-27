/*
 * Night sea + sky, rendered as one full-screen WebGL fragment shader.
 *
 *  - The sea is a sum of directional waves. Each pixel only keeps the waves it can resolve
 *    (anisotropic footprint filter); what it drops becomes surface roughness.
 *  - Navigation lights reflect as glitter paths using a slope-space (Cox–Munk style) glint
 *    model, so the shimmer is sharp up close and smooths out toward the horizon.
 *  - The sea surface curves away (effective earth radius with refraction), so there is a real
 *    horizon dip and distant vessels sit a little "hull down".
 */
(function () {
  'use strict';
  const NW = (window.NW = window.NW || {});
  const NWAVES = 16;
  const NLIGHTS = 16;
  const TAU = Math.PI * 2;

  // ---------------------------------------------------------------- waves (shared with JS for bobbing)
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function createWaves(seed) {
    const rnd = mulberry32(seed);
    const travel = (195 + rnd() * 30) * (Math.PI / 180); // swell rolls roughly toward the observer
    const waves = [];
    for (let i = 0; i < NWAVES; i++) {
      const f = i / (NWAVES - 1);
      const lambda = 90 * Math.pow(0.32 / 90, f);
      const k = TAU / lambda;
      const dir = travel + (0.3 + 0.75 * f) * (rnd() * 2 - 1);
      const slope = 0.026 + 0.036 * f; // amplitude * k (steepness)
      waves.push({
        dx: Math.sin(dir), dz: Math.cos(dir), k, lambda, slope,
        amp: slope / k, omega: Math.sqrt(9.81 * k), phi: rnd() * TAU,
      });
    }
    const api = {
      list: waves,
      scale: 1, // sea state: 0.1 = glassy calm, 1 = moderate, 2 = rough
      height(x, z, t, minLambda = 0) {
        let h = 0;
        for (const w of waves) if (w.lambda >= minLambda) h += w.amp * Math.sin(w.k * (w.dx * x + w.dz * z) + w.phi - w.omega * t);
        return h * api.scale;
      },
      grad(x, z, t, minLambda = 0) {
        let gx = 0, gz = 0;
        for (const w of waves) {
          if (w.lambda < minLambda) continue;
          const c = w.slope * Math.cos(w.k * (w.dx * x + w.dz * z) + w.phi - w.omega * t);
          gx += c * w.dx; gz += c * w.dz;
        }
        return [gx * api.scale, gz * api.scale];
      },
      phases(t, out) {
        for (let i = 0; i < waves.length; i++) {
          let p = (waves[i].phi - waves[i].omega * t) % TAU;
          if (p < 0) p += TAU;
          out[i] = p;
        }
        return out;
      },
    };
    return api;
  }

  // ---------------------------------------------------------------- shaders
  const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

  const FRAG = `
precision highp float;
#define NWAVES ${NWAVES}
#define NLIGHTS ${NLIGHTS}
uniform vec2 uRes;
uniform vec3 uCamPos;
uniform vec3 uCamF;
uniform vec3 uCamR;
uniform vec3 uCamU;
uniform vec2 uTan;
uniform float uPixAng;
uniform float uTime;
uniform float uMoon;
uniform float uDip;
uniform vec4 uWave[NWAVES];
uniform float uPhase[NWAVES];
uniform vec3 uLPos[NLIGHTS];
uniform vec3 uLCol[NLIGHTS];
uniform int uNL;
uniform float uGlint;
uniform float uExposure;
uniform float uSea;
uniform float uFog;   // 1 / visibility in meters (0 = clear)

vec3 fogColor(float e) {
  vec3 f = vec3(0.0098, 0.0112, 0.0132) * (0.05 + 2.8 * uMoon);
  return f * (1.0 + 0.35 * exp(-max(e, 0.0) * 25.0));
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(17.1, 9.7); a *= 0.5; }
  return s;
}

vec3 stars(vec3 d, float az, float e) {
  float el = asin(clamp(d.y, -1.0, 1.0));
  float cs = 0.0042;
  vec2 cell = floor(vec2(az, el) / cs);
  float pres = step(0.64, hash12(cell * 1.37 + 4.1));
  vec2 h = hash22(cell);
  vec2 sp = (cell + 0.2 + 0.6 * h) * cs;
  vec2 dd = vec2((az - sp.x) * cos(el), el - sp.y);
  float r = length(dd) / (uPixAng * 0.85);
  float mag = pow(hash12(cell + 7.7), 7.0);
  float tw = 0.6 + 0.4 * sin(uTime * (1.5 + 4.0 * h.x) + h.y * 40.0);
  float b = pres * exp(-r * r) * (0.004 + 0.32 * mag) * tw;
  vec3 sc = mix(vec3(0.72, 0.82, 1.0), vec3(1.0, 0.88, 0.72), hash12(cell + 2.3));
  return sc * b * smoothstep(0.0, 0.04, e) * (1.0 - 0.6 * uMoon);
}

vec3 sky(vec3 d, float az, bool detail) {
  float e = d.y + uDip;            // elevation above the sea horizon (radians, approx.)
  float ep = max(e, 0.0);
  float m = uMoon;
  vec3 zen = vec3(0.0004, 0.0007, 0.0016) * (0.05 + 2.5 * m);
  vec3 hor = vec3(0.0021, 0.0033, 0.0060) * (0.04 + 3.2 * m);
  float band = vnoise(vec2(az * 7.0, 1.7)) * 0.6 + vnoise(vec2(az * 23.0, 4.2)) * 0.4;
  hor *= 0.7 + 0.6 * band;
  float town = exp(-pow((az - 1.15) / 0.22, 2.0));          // faint glow of a distant town
  hor += vec3(0.0040, 0.0023, 0.0011) * town * (0.05 + 2.2 * m) * (1.0 - 0.5 * m);
  vec3 c = mix(hor, zen, smoothstep(0.0, 0.12, ep));
  c += hor * 0.9 * exp(-ep * 60.0);
  if (detail) {
    float cl = 0.0;
    if (e > 0.0) {
      float t = 1800.0 / max(e, 0.0015);
      vec2 p = normalize(d.xz + 1e-6) * t;
      vec2 uv = p / 6000.0 + vec2(uTime * 0.0035, uTime * 0.0012);
      cl = smoothstep(0.5, 0.82, fbm(uv)) * smoothstep(0.004, 0.06, e);
    }
    c += stars(d, az, e) * (1.0 - cl);
    vec3 ccol = mix(zen * 0.6, hor * 1.25, 0.35 + 0.65 * m);
    c = mix(c, ccol, cl * 0.85);
  }
  return c;
}

void main() {
  vec2 ndc = gl_FragCoord.xy / uRes * 2.0 - 1.0;
  vec3 d = normalize(uCamF + ndc.x * uTan.x * uCamR + ndc.y * uTan.y * uCamU);
  float az = atan(d.x, d.z);
  vec3 col;

  // Curved sea: camera height h over a sphere of effective radius R.
  float h = uCamPos.y;
  float disc = d.y * d.y - uDip * uDip;
  if (d.y >= 0.0 || disc <= 0.0) {
    col = sky(d, az, true);
    col = mix(col, fogColor(d.y + uDip), 1.0 - exp(-uFog * 6000.0));
  } else {
    float t = 2.0 * h / (-d.y + sqrt(disc));
    vec3 P = uCamPos + d * t;
    vec3 V = -d;
    vec2 fh = normalize(d.xz);
    vec2 rh = vec2(fh.y, -fh.x);
    float vy = max(-d.y, 1e-4);
    float fl = t * uPixAng;          // footprint across the line of sight
    float fd = fl / vy;              // footprint along it (grazing stretch)

    vec2 g = vec2(0.0);
    float varF = 0.0012, varL = 0.0012;   // capillary roughness
    for (int i = 0; i < NWAVES; i++) {
      vec4 w = uWave[i];
      float kf = dot(w.xy, fh), kl = dot(w.xy, rh);
      float foot = sqrt(kf * kf * fd * fd + kl * kl * fl * fl);
      float lam = 6.2831853 / w.z;
      float keep = 1.0 - smoothstep(0.16, 0.5, foot / lam);
      float sa = w.w * uSea;
      float lost = 0.5 * sa * sa * (1.0 - keep * keep);
      varF += lost * kf * kf;
      varL += lost * kl * kl;
      if (keep > 0.0) {
        float ph = dot(w.xy, P.xz) * w.z + uPhase[i];
        g += w.xy * (sa * keep * cos(ph));
      }
    }

    vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
    float ndv = clamp(dot(n, V), 0.0, 1.0);
    float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
    vec3 R = reflect(d, n);
    R.y = abs(R.y) + sqrt(varF) * 0.6;   // unresolved slopes see a little higher up the sky
    R = normalize(R);
    vec3 skyR = sky(R, atan(R.x, R.z), false);
    vec3 deep = vec3(0.0005, 0.0010, 0.0014) * (0.2 + uMoon);
    col = mix(deep, skyR, fres);

    // Glitter from each navigation light.
    vec3 glit = vec3(0.0);
    float sF = sqrt(varF), sL = sqrt(varL);
    for (int i = 0; i < NLIGHTS; i++) {
      if (i >= uNL) break;
      vec3 Lv = uLPos[i] - P;
      float r2 = dot(Lv, Lv);
      Lv *= inversesqrt(r2);
      vec3 H = normalize(V + Lv);
      vec2 dl = -H.xz / H.y - g;
      float a = dot(dl, fh), b = dot(dl, rh);
      float p = exp(-0.5 * (a * a / varF + b * b / varL)) / (6.2831853 * sF * sL);
      float F = 0.02 + 0.98 * pow(1.0 - clamp(dot(V, H), 0.0, 1.0), 5.0);
      float hy2 = H.y * H.y;
      glit += uLCol[i] * (p * F / (4.0 * vy * hy2 * hy2 * r2));
    }
    // Soft-clip so the glitter keeps its color and never outshines the lights themselves.
    vec3 gg = glit * uGlint;
    float gm = max(gg.r, max(gg.g, gg.b));
    col += gg / (1.0 + gm / 0.3);

    float fog = 1.0 - exp(-t / 5200.0);
    vec3 hz = sky(vec3(d.x, -uDip + 0.0004, d.z), az, false);
    col = mix(col, hz, fog * 0.85);
    col = mix(col, fogColor(0.0), 1.0 - exp(-t * uFog * 1.3));
  }

  vec2 q = gl_FragCoord.xy / uRes;
  float vig = 1.0 - 0.5 * pow(length((q - 0.5) * vec2(1.0, 0.85)) * 1.35, 2.4);
  col *= clamp(vig, 0.0, 1.0);
  col = 1.0 - exp(-col * uExposure);
  col = pow(col, vec3(1.0 / 2.2));
  col += (hash12(gl_FragCoord.xy + fract(uTime * 7.0) * 91.0) - 0.5) / 255.0;
  gl_FragColor = vec4(col, 1.0);
}
`;

  function compile(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s);
      gl.deleteShader(s);
      throw new Error('Shader compile failed: ' + log);
    }
    return s;
  }

  class Sea {
    constructor(canvas, waves) {
      const gl = canvas.getContext('webgl', {
        antialias: false, alpha: false, depth: false, stencil: false,
        premultipliedAlpha: false, powerPreference: 'high-performance',
      });
      if (!gl) throw new Error('WebGL is not available');
      this.gl = gl;
      this.canvas = canvas;
      const prog = gl.createProgram();
      gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('Shader link failed: ' + gl.getProgramInfoLog(prog));
      this.prog = prog;
      gl.useProgram(prog);

      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, 'aPos');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

      const names = ['uRes', 'uCamPos', 'uCamF', 'uCamR', 'uCamU', 'uTan', 'uPixAng', 'uTime', 'uMoon', 'uDip',
        'uWave[0]', 'uPhase[0]', 'uLPos[0]', 'uLCol[0]', 'uNL', 'uGlint', 'uExposure', 'uSea', 'uFog'];
      this.u = {};
      for (const n of names) this.u[n] = gl.getUniformLocation(prog, n);

      const wv = new Float32Array(NWAVES * 4);
      waves.list.forEach((w, i) => wv.set([w.dx, w.dz, w.k, w.slope], i * 4));
      gl.uniform4fv(this.u['uWave[0]'], wv);
      this.phase = new Float32Array(NWAVES);
      this.waves = waves;
    }

    resize(w, h) {
      if (this.canvas.width !== w || this.canvas.height !== h) {
        this.canvas.width = w;
        this.canvas.height = h;
      }
      this.gl.viewport(0, 0, w, h);
    }

    render(p) {
      const gl = this.gl, u = this.u;
      gl.useProgram(this.prog);
      gl.uniform2f(u.uRes, this.canvas.width, this.canvas.height);
      gl.uniform3fv(u.uCamPos, p.cam.pos);
      gl.uniform3fv(u.uCamF, p.cam.F);
      gl.uniform3fv(u.uCamR, p.cam.R);
      gl.uniform3fv(u.uCamU, p.cam.U);
      gl.uniform2f(u.uTan, p.tanX, p.tanY);
      gl.uniform1f(u.uPixAng, (2 * p.tanX) / this.canvas.width);
      gl.uniform1f(u.uTime, p.time % 3600);
      gl.uniform1f(u.uMoon, p.moon);
      gl.uniform1f(u.uDip, p.dip);
      gl.uniform1fv(u['uPhase[0]'], this.waves.phases(p.time, this.phase));
      gl.uniform3fv(u['uLPos[0]'], p.lightPos);
      gl.uniform3fv(u['uLCol[0]'], p.lightCol);
      gl.uniform1i(u.uNL, p.lightCount);
      gl.uniform1f(u.uGlint, p.glint);
      gl.uniform1f(u.uExposure, p.exposure);
      gl.uniform1f(u.uSea, this.waves.scale);
      gl.uniform1f(u.uFog, p.fog || 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
  }

  NW.Sea = Sea;
  NW.createWaves = createWaves;
  NW.SEA_LIMITS = { NWAVES, NLIGHTS };
})();
