/*
 * Quiz logic. The important trick: before asking "what is this vessel?", we check what
 * the observer can actually see from the chosen aspect, and make sure no wrong answer we
 * offer could also produce that exact picture from some other angle.
 */
(function () {
  'use strict';
  const NW = (window.NW = window.NW || {});
  const V = NW.Vessels;
  const DEG = Math.PI / 180;

  // Aspects we may show (relative bearing of the observer from the vessel's bow, degrees).
  // Kept away from the 112.5° arc edges so nothing flickers on the boundary.
  const DISPLAY_BETAS = [0, 20, -20, 35, -35, 50, -50, 65, -65, 80, -80, 95, -95, 150, -150, 165, -165, 180];

  const HEADING_OPTIONS = ['Toward you (head-on)', 'Crossing left → right', 'Crossing right → left', 'Away from you'];

  function token(l) {
    const c = V.lightColor(l);
    return V.lightHz(l) ? c.toLowerCase() : c;
  }

  // What an observer far away perceives: lights grouped into side-by-side clusters,
  // each cluster read top-to-bottom. Lights at the same height read together.
  function signature(cfg, beta) {
    const cb = Math.cos(beta * DEG), sb = Math.sin(beta * DEG);
    const items = [];
    for (const body of cfg.bodies) {
      for (const l of body.lights) {
        if (!V.arcHard(l, beta)) continue;
        const x = l.p[0], y = l.p[1], z = l.p[2] + body.z;
        items.push({ u: -x * cb + z * sb, y, t: token(l) });
      }
    }
    if (!items.length) return '';
    items.sort((a, b) => a.u - b.u);
    const clusters = [];
    let cur = [items[0]];
    for (let i = 1; i < items.length; i++) {
      if (items[i].u - items[i - 1].u > 1.0) { clusters.push(cur); cur = []; }
      cur.push(items[i]);
    }
    clusters.push(cur);
    return clusters.map((cl) => {
      cl.sort((a, b) => b.y - a.y);
      const groups = [];
      let g = [cl[0]];
      for (let i = 1; i < cl.length; i++) {
        if (g[g.length - 1].y - cl[i].y > 0.3) { groups.push(g); g = []; }
        g.push(cl[i]);
      }
      groups.push(g);
      return groups.map((gr) => gr.map((it) => it.t).sort().join('')).join('/');
    }).join(' ');
  }

  function visibleLights(cfg, beta) {
    const out = [];
    for (const body of cfg.bodies) for (const l of body.lights) if (V.arcHard(l, beta)) out.push(l);
    return out;
  }

  function headingIndex(beta) {
    const a = Math.abs(V.angDiff(beta, 0));
    if (a <= V.SPILL) return 0;
    if (a >= 112.5) return 3;
    return beta > 0 ? 1 : 2;
  }

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  class Quiz {
    constructor() {
      this.pool = [];
      this.labelSigs = new Map();
      this.seen = {};
      this.lastId = null;
    }

    setPool(level, rules) {
      this.pool = V.configsFor(level, rules);
      this.labels = [...new Set(this.pool.map((c) => c.answer))];
      // Every picture each answer can produce, sampled all the way around (with counts,
      // so we know whether a lookalike is common or a one-angle coincidence).
      this.labelSigs = new Map(this.labels.map((a) => [a, new Map()]));
      this.labelTotal = new Map(this.labels.map((a) => [a, 0]));
      const samples = [];
      for (let b = -180; b < 180; b += 2.5) samples.push(b);
      samples.push(0.5, -0.5, 1, -1, 1.5, -1.5, 112, -112, 113, -113);
      for (const cfg of this.pool) {
        const m = this.labelSigs.get(cfg.answer);
        for (const b of samples) {
          const s = signature(cfg, b);
          m.set(s, (m.get(s) || 0) + 1);
        }
        this.labelTotal.set(cfg.answer, this.labelTotal.get(cfg.answer) + samples.length);
      }
    }

    // Other answers that could produce this exact picture from some aspect.
    consistentWith(cfg, beta) {
      const sig = signature(cfg, beta);
      return this.labels.filter((a) => a !== cfg.answer && this.labelSigs.get(a).has(sig));
    }

    // Lookalikes worth warning about: the same picture shows up from a broad range of angles.
    commonLookalikes(cfg, beta) {
      const sig = signature(cfg, beta);
      return this.labels.filter((a) => a !== cfg.answer && (this.labelSigs.get(a).get(sig) || 0) / this.labelTotal.get(a) >= 0.08);
    }

    pickAspect(cfg) {
      const cands = DISPLAY_BETAS.filter((b) => visibleLights(cfg, b).length > 0)
        .map((b) => ({ beta: b, others: this.consistentWith(cfg, b) }));
      const unique = cands.filter((c) => c.others.length === 0);
      if (unique.length) return unique[Math.floor(Math.random() * unique.length)];
      const fewest = Math.min(...cands.map((c) => c.others.length));
      const best = cands.filter((c) => c.others.length === fewest);
      return best[Math.floor(Math.random() * best.length)];
    }

    pickConfig() {
      const pool = this.pool.filter((c) => c.id !== this.lastId);
      // Favor answers you've seen least.
      const weights = pool.map((c) => 1 / (1 + (this.seen[c.answer] || 0)));
      let r = Math.random() * weights.reduce((s, w) => s + w, 0);
      for (let i = 0; i < pool.length; i++) {
        r -= weights[i];
        if (r <= 0) return pool[i];
      }
      return pool[pool.length - 1];
    }

    newRound() {
      const cfg = this.pickConfig();
      this.lastId = cfg.id;
      this.seen[cfg.answer] = (this.seen[cfg.answer] || 0) + 1;
      const { beta: base, others } = this.pickAspect(cfg);
      // A little jitter so it never looks staged — but keep the same picture.
      let beta = base;
      if (base !== 0 && Math.abs(base) !== 180) {
        const j = base + (Math.random() * 2 - 1) * 4;
        if (signature(cfg, j) === signature(cfg, base)) beta = j;
      }
      const dist = cfg.dist[0] + Math.random() * (cfg.dist[1] - cfg.dist[0]);
      const questions = [this.idQuestion(cfg, beta, others)];
      if (cfg.making) questions.push(this.headingQuestion(cfg, beta));
      if (cfg.extra) questions.push(this.extraQuestion(cfg));
      return { cfg, beta, dist, questions, alsoLike: this.commonLookalikes(cfg, beta) };
    }

    idQuestion(cfg, beta, others) {
      const shown = new Set(visibleLights(cfg, beta).map(V.lightColor));
      const cands = this.labels.filter((a) => a !== cfg.answer && !others.includes(a));
      // Prefer distractors that share colors with what's on screen.
      const scored = cands.map((a) => {
        const cols = new Set();
        for (const c of this.pool) if (c.answer === a) for (const b of c.bodies) for (const l of b.lights) cols.add(V.lightColor(l));
        let s = 0;
        for (const c of shown) if (cols.has(c)) s++;
        return { a, w: 1 + s * 1.5 + Math.random() * 2 };
      }).sort((x, y) => y.w - x.w);
      const distract = scored.slice(0, 3).map((s) => s.a);
      const opts = shuffle([cfg.answer, ...distract]);
      return {
        kind: 'id',
        prompt: 'What are you looking at?',
        options: opts.map((a) => V.ANSWERS[a].name),
        correct: opts.indexOf(cfg.answer),
        explain: cfg.shows,
      };
    }

    headingQuestion(cfg, beta) {
      const idx = headingIndex(beta);
      const vis = visibleLights(cfg, beta);
      const has = (k) => vis.some((l) => l.k === k);
      let why;
      if (idx === 0) why = 'Both sidelights — red and green — show at once only within a degree or two of dead ahead. She’s pointed straight at you.';
      else if (idx === 1) why = 'Only her green (starboard) sidelight shows, so her starboard side faces you: she’s crossing from your left to your right.';
      else if (idx === 2) why = 'Only her red (port) sidelight shows, so her port side faces you: she’s crossing from your right to your left.';
      else why = `No sidelights — just her ${has('towing') ? 'yellow towing light and ' : ''}${has('stern') ? 'white sternlight' : 'stern lights'}. You’re behind her and she’s heading away.`;

      // Range-light hint for vessels with two masthead lights at different heights.
      const mhs = cfg.bodies[0].lights.filter((l) => l.k === 'masthead');
      if ((idx === 1 || idx === 2) && mhs.length === 2 && mhs[0].p[2] !== mhs[1].p[2]) {
        why += ` Her masthead lights agree: the lower, forward light is ${idx === 1 ? 'right' : 'left'} of the higher after light, pointing the way she’s going.`;
      }
      if (idx === 2) why += ' If she’s on your starboard side showing red, you’re the give-way vessel.';
      return { kind: 'heading', prompt: 'Which way is she heading?', options: HEADING_OPTIONS.slice(), correct: idx, explain: why };
    }

    extraQuestion(cfg) {
      const e = cfg.extra;
      const order = shuffle(e.options.map((_, i) => i));
      return {
        kind: 'extra',
        prompt: e.prompt,
        options: order.map((i) => e.options[i]),
        correct: order.indexOf(e.correct),
        explain: e.explain,
      };
    }
  }

  NW.Quiz = Quiz;
  NW.QuizUtil = { signature, visibleLights, headingIndex, DISPLAY_BETAS };
})();
