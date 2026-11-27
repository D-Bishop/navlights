/*
 * Quiz flow, card UI, settings, guide, and the top-down arc diagram.
 */
(function () {
  'use strict';
  const NW = (window.NW = window.NW || {});
  const V = NW.Vessels;
  const DEG = Math.PI / 180;
  const LS_KEY = 'nightwatch.v1';
  const LEVELS = ['Basics', 'Working', 'Everything'];

  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  function load() {
    try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch (e) { return {}; }
  }
  function save(data) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(data)); } catch (e) { /* private mode etc. */ }
  }
  const rgba = (rgb, a) => `rgba(${Math.round(rgb[0] * 255)},${Math.round(rgb[1] * 255)},${Math.round(rgb[2] * 255)},${a})`;

  function lightDot(l) {
    const c = V.lightColor(l);
    const d = el('span', 'dot' + (l.k === 'allround' ? ' ring' : '') + (V.lightHz(l) ? ' flash' : ''));
    d.style.setProperty('--c', V.COLORS[c].css);
    return d;
  }

  // ---------------------------------------------------------------- top-down diagram
  function drawDiagram(canvas, cfg, beta) {
    const css = canvas.clientWidth || 200;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(css * dpr);
    canvas.height = Math.round(css * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, css, css);
    const cx = css / 2, cy = css / 2;
    const R = css * 0.36;

    ctx.strokeStyle = 'rgba(170,190,220,0.12)';
    ctx.setLineDash([2, 4]);
    ctx.beginPath(); ctx.arc(cx, cy, R * 1.22, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);

    const kinds = new Set();
    const rings = [];
    for (const b of cfg.bodies) for (const l of b.lights) {
      if (l.k === 'allround') { if (!rings.includes(V.lightColor(l))) rings.push(V.lightColor(l)); } else kinds.add(l.k);
    }
    const radius = { masthead: R, stern: R * 0.8, stbd: R * 0.8, port: R * 0.8, towing: R * 0.6, special: R * 0.62 };
    for (const k of ['masthead', 'stern', 'towing', 'special', 'stbd', 'port']) {
      if (!kinds.has(k)) continue;
      const K = V.KINDS[k];
      const rgb = V.COLORS[K.c].rgb;
      const on = V.arcHard({ k }, beta);
      const a0 = (K.center - K.half - 90) * DEG, a1 = (K.center + K.half - 90) * DEG;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, radius[k], a0, a1);
      ctx.closePath();
      ctx.fillStyle = rgba(rgb, on ? 0.24 : 0.07);
      ctx.fill();
      ctx.strokeStyle = rgba(rgb, on ? 0.75 : 0.22);
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    rings.forEach((c, i) => {
      ctx.beginPath();
      ctx.arc(cx, cy, R * 1.06 + i * 4, 0, Math.PI * 2);
      ctx.strokeStyle = rgba(V.COLORS[c].rgb, 0.7);
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    });

    // Vessel (bow up).
    ctx.save();
    ctx.translate(cx, cy);
    ctx.beginPath();
    ctx.moveTo(0, -17); ctx.quadraticCurveTo(7, -8, 6, 4); ctx.lineTo(5, 14); ctx.lineTo(-5, 14); ctx.lineTo(-6, 4); ctx.quadraticCurveTo(-7, -8, 0, -17);
    ctx.fillStyle = '#d9e1ec';
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = 'rgba(200,210,225,0.55)';
    ctx.font = '600 8.5px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('BOW', cx, cy - 25);

    // You: a dot on the outer ring, labeled along the ring so it never leaves the canvas.
    const sb = Math.sin(beta * DEG), cb = Math.cos(beta * DEG);
    const ro = R * 1.22;
    const ox = cx + sb * ro, oy = cy - cb * ro;
    ctx.strokeStyle = 'rgba(255,210,138,0.55)';
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(cx + sb * 22, cy - cb * 22); ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(ox, oy, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#ffd28a';
    ctx.fill();
    ctx.font = '600 11px -apple-system, system-ui, sans-serif';
    ctx.fillText('you', ox + cb * 17, oy + sb * 17);
  }

  // Sea slider 0–100 → wave scale: 0 glassy (0.1), 50 moderate (1.0), 100 rough (2.0).
  const seaScale = (v) => (v <= 50 ? 0.1 + 0.9 * (v / 50) : 1 + (v - 50) / 50);
  const seaName = (v) => (v < 15 ? 'glassy calm' : v < 38 ? 'light swell' : v < 63 ? 'moderate' : v < 85 ? 'rough' : 'heavy');

  // Points: each question has a base value, multiplied by how far off she is.
  const BASE_POINTS = { id: 100, heading: 50, extra: 50 };
  const rangeMult = (nm) => 1 + Math.min(nm, 6); // capped so a 12 nm hull-down ship isn't worth a whole session

  // Meteorological visibility for each fog setting (meters).
  const FOG_VIS = { clear: Infinity, haze: 9000, fog: 2500, thick: 900 };
  const pointsFor = (kind, nm) => Math.max(5, Math.round((BASE_POINTS[kind] * rangeMult(nm)) / 5) * 5);

  // ---------------------------------------------------------------- app
  class App {
    constructor(scene) {
      this.scene = scene;
      const saved = load();
      this.settings = Object.assign({ rules: 'inland', level: 1, moon: 30, sea: 50, range: 'mixed', fog: 'clear', traffic: 'real' }, saved.settings);
      this.stats = Object.assign({ answered: 0, correct: 0, streak: 0, best: 0, points: 0 }, saved.stats);
      this.shownPoints = this.stats.points;
      this.quiz = new NW.Quiz();
      this.quiz.setPool(this.settings.level, this.settings.rules);
      this.quiz.setTraffic(this.settings.traffic);
      this.vesselCount = 0;
      this.metaTimer = 0;

      this.$ = {
        card: $('card'), qCount: $('qCount'), qStep: $('qStep'), qRange: $('qRange'), prompt: $('prompt'),
        options: $('options'), feedback: $('feedback'), verdict: $('verdict'), why: $('why'),
        reveal: $('reveal'), rvTitle: $('rvTitle'), rvRule: $('rvRule'), rvShows: $('rvShows'), rvTip: $('rvTip'),
        rvAlso: $('rvAlso'), rvLights: $('rvLights'), diagram: $('diagram'), next: $('nextBtn'), hint: $('hint'),
        score: $('statScore'), streak: $('statStreak'), settings: $('settings'), modeBtn: $('modeBtn'),
        modeLabel: $('modeLabel'), guide: $('guide'), guideList: $('guideList'), moonRange: $('moonRange'),
        moonHint: $('moonHint'), bestHint: $('bestHint'),
        points: $('statPoints'), ptsPop: $('ptsPop'), seaRange: $('seaRange'), seaHint: $('seaHint'),
      };
      scene.moon = this.settings.moon / 100;
      scene.waves.scale = seaScale(this.settings.sea);
      scene.fogK = 1 / FOG_VIS[this.settings.fog];
      this.bind();
      this.applySettingsUI();
      this.renderStats(false);
      this.buildGuide();
      this.nextRound();
    }

    persist() { save({ settings: this.settings, stats: this.stats }); }

    // ------------------------------------------------------------ rounds
    nextRound() {
      this.round = this.quiz.newRound();
      this.placeRound(this.round);
      this.qi = 0;
      this.vesselCount++;
      this.scene.show(this.round);
      this.$.reveal.hidden = true;
      this.renderQuestion();
    }

    // Decide how far off she is: normal range, or out past your horizon (hull-down), and
    // never farther than the fog lets you see her.
    placeRound(round) {
      const vis = FOG_VIS[this.settings.fog];
      const mode = this.settings.range;
      const canHorizon = vis > 5000;
      round.horizon = false;
      if (canHorizon && (mode === 'horizon' || (mode === 'mixed' && Math.random() < 0.6))) {
        // Sink her until her lowest visible light sits just over the horizon, so the swell
        // hides it now and then.
        const { REFF, DH } = NW.HORIZON;
        const lows = NW.QuizUtil.visibleLights(round.cfg, round.beta).map((l) => l.p[1]);
        const hLow = Math.min(...lows);
        const margin = 0.45 + 0.35 * this.scene.waves.scale;
        const d = DH + Math.sqrt(2 * REFF * Math.max(0.25, hLow - margin));
        // In haze, only if her lights would still shine through at that range.
        // ...and only out to where her weakest light is still faintly visible (rated range).
        const dmax = 1.7 * NW.Vessels.weakestRangeM(round.cfg, round.beta) * NW.Vessels.RANGE_REACH;
        const dh = mode === 'horizon' ? Math.min(d, dmax) : d;
        if (dh <= vis * 1.4 && dh <= dmax && dh >= DH * 0.9) { round.dist = dh; round.horizon = true; }
      }
      if (mode === 'near' && !round.horizon) round.dist = Math.min(round.dist, 2200);
      if (!round.horizon && Number.isFinite(vis)) round.dist = Math.min(round.dist, Math.max(350, vis * 0.85));
    }

    renderQuestion() {
      const q = this.round.questions[this.qi];
      const n = this.round.questions.length;
      this.answered = false;
      this.$.qCount.textContent = `Vessel ${this.vesselCount}`;
      this.$.qStep.textContent = `Question ${this.qi + 1} of ${n}`;
      this.$.prompt.textContent = q.prompt;
      this.$.options.replaceChildren(...q.options.map((text, i) => {
        const b = el('button', 'opt');
        b.type = 'button';
        b.append(el('kbd', null, String(i + 1)), el('span', null, text));
        b.addEventListener('click', () => this.answer(i));
        return b;
      }));
      this.$.feedback.hidden = true;
      this.$.next.hidden = true;
      this.$.hint.hidden = false;
      this.$.card.scrollTop = 0;
      this.updateMeta();
    }

    answer(i) {
      if (this.answered) return;
      const q = this.round.questions[this.qi];
      if (i < 0 || i >= q.options.length) return;
      this.answered = true;
      const ok = i === q.correct;
      const s = this.stats;
      const nm = this.scene.rangeNm();
      const pts = ok ? pointsFor(q.kind, nm) : 0;
      s.answered++;
      if (ok) { s.correct++; s.streak++; s.best = Math.max(s.best, s.streak); s.points += pts; } else s.streak = 0;
      this.persist();
      this.renderStats(true);
      if (pts) {
        this.$.ptsPop.textContent = `+${pts}`;
        this.bump(this.$.ptsPop, 'go');
      }

      [...this.$.options.children].forEach((b, j) => {
        b.disabled = true;
        if (j === q.correct) b.classList.add('right');
        else if (j === i) b.classList.add('wrong');
        else b.classList.add('dim');
      });

      const last = this.qi === this.round.questions.length - 1;
      this.$.verdict.className = 'verdict ' + (ok ? 'ok' : 'bad');
      this.$.verdict.textContent = ok ? 'Correct.' : `Not quite — the answer is “${q.options[q.correct]}.”`;
      if (ok) this.$.verdict.append(el('span', 'pts', `+${pts} · ${BASE_POINTS[q.kind]} × ${rangeMult(nm).toFixed(2)} for ${nm.toFixed(2)} nm`));
      const why = q.kind === 'id' && last ? '' : q.explain;
      this.$.why.textContent = why;
      this.$.why.hidden = !why;
      this.$.feedback.hidden = false;
      this.$.hint.hidden = true;

      if (last) this.showReveal();
      this.$.next.textContent = last ? 'Next vessel →' : 'Next question →';
      this.$.next.hidden = false;
      this.$.next.focus({ preventScroll: true });
      // Bring the verdict (and the reveal under it) into view inside the card.
      if (last) requestAnimationFrame(() => this.$.card.scrollTo({ top: Math.max(0, this.$.feedback.offsetTop - 14), behavior: 'smooth' }));
    }

    next() {
      if (!this.answered) return;
      if (this.qi < this.round.questions.length - 1) {
        this.qi++;
        this.renderQuestion();
      } else {
        this.nextRound();
      }
    }

    showReveal() {
      const { cfg, beta, alsoLike } = this.round;
      this.scene.revealTarget = 1;
      this.$.rvTitle.textContent = cfg.title;
      this.$.rvRule.textContent = cfg.rule;
      this.$.rvShows.textContent = cfg.shows;
      const tips = [];
      if (cfg.mnemonic) tips.push(`“${cfg.mnemonic}”`);
      if (cfg.tip) tips.push(cfg.tip);
      if (cfg.note) tips.push(cfg.note);
      if (this.round.horizon) tips.push('She was hull-down — past your horizon, so the earth’s curve hid her hull and the swell kept swallowing her lowest lights. Keep watching: a light that blinks out may just be behind a wave.');
      this.$.rvTip.textContent = tips.join(' ');
      this.$.rvTip.hidden = !tips.length;
      if (alsoLike && alsoLike.length) {
        const names = alsoLike.map((a) => V.ANSWERS[a].name.toLowerCase());
        this.$.rvAlso.textContent = `Heads-up: from the right angle, these same lights could also be a ${names.join(', or a ')}. Only one of your choices fit — at sea, keep watching until she shows more.`;
        this.$.rvAlso.hidden = false;
      } else this.$.rvAlso.hidden = true;

      const items = [];
      for (const b of cfg.bodies) {
        for (const l of b.lights) {
          const seen = V.arcHard(l, beta);
          const li = el('li', seen ? '' : 'off');
          const name = (b.tow ? 'Tow: ' : '') + V.lightName(l);
          li.title = `${name} — ${seen ? 'visible from where you are' : 'hidden from where you are'}`;
          li.append(lightDot(l), el('span', null, name));
          items.push(li);
        }
      }
      this.$.rvLights.replaceChildren(...items);
      this.$.reveal.hidden = false;
      drawDiagram(this.$.diagram, cfg, beta);
    }

    updateMeta() {
      const nm = this.scene.rangeNm();
      this.$.qRange.textContent = nm ? `${nm.toFixed(2)} nm · ×${rangeMult(nm).toFixed(2)} points` : '';
    }

    tick(dt) {
      this.metaTimer += dt;
      if (this.metaTimer > 0.5) { this.metaTimer = 0; this.updateMeta(); }
      // Count the points display up toward the real total.
      const target = this.stats.points;
      if (this.shownPoints !== target) {
        const step = Math.max(1, Math.abs(target - this.shownPoints) * Math.min(1, dt * 6));
        this.shownPoints = target > this.shownPoints ? Math.min(target, this.shownPoints + step) : Math.max(target, this.shownPoints - step);
        this.$.points.textContent = Math.round(this.shownPoints).toLocaleString();
      }
    }

    renderStats(bump) {
      const s = this.stats;
      const score = `${s.correct}/${s.answered}`;
      if (bump && this.$.score.textContent !== score) this.bump(this.$.score);
      if (bump && this.$.streak.textContent !== String(s.streak) && s.streak > 0) this.bump(this.$.streak);
      this.$.score.textContent = score;
      this.$.streak.textContent = String(s.streak);
      if (bump && Math.round(this.shownPoints) !== s.points) this.bump(this.$.points);
      if (!bump) { this.shownPoints = s.points; this.$.points.textContent = s.points.toLocaleString(); }
      this.$.bestHint.textContent = s.best ? `Best streak ${s.best}` : '';
    }

    bump(node, cls = 'bump') {
      node.classList.remove(cls);
      void node.offsetWidth;
      node.classList.add(cls);
    }

    // ------------------------------------------------------------ settings & guide
    applySettingsUI() {
      const st = this.settings;
      document.querySelectorAll('.seg').forEach((seg) => {
        const key = seg.dataset.setting;
        seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === String(st[key])));
      });
      this.$.modeLabel.replaceChildren(
        el('span', 'long', `${st.rules === 'inland' ? 'Inland' : 'International'} · ${LEVELS[st.level - 1]}`),
        el('span', 'short', `${st.rules === 'inland' ? 'Inland' : 'Intl'} · ${['Basic', 'Work', 'All'][st.level - 1]}`),
      );
      this.$.moonRange.value = st.moon;
      this.$.moonHint.textContent = st.moon < 12 ? 'new moon' : st.moon < 45 ? 'dim' : st.moon < 75 ? 'half moon' : 'full moon';
      this.$.seaRange.value = st.sea;
      this.$.seaHint.textContent = seaName(st.sea);
    }

    changeSetting(key, value) {
      if (key === 'level') value = Number(value);
      if (this.settings[key] === value) return;
      this.settings[key] = value;
      this.persist();
      this.applySettingsUI();
      this.scene.fogK = 1 / FOG_VIS[this.settings.fog];
      if (key === 'traffic') this.quiz.setTraffic(value);
      if (key === 'rules' || key === 'level') {
        this.quiz.setPool(this.settings.level, this.settings.rules);
        this.buildGuide();
      }
      this.nextRound();
    }

    buildGuide() {
      const all = V.configsFor(3, this.settings.rules);
      const order = [];
      for (const c of all) if (!order.includes(c.answer)) order.push(c.answer);
      const cards = [];
      for (const a of order) {
        for (const c of all.filter((x) => x.answer === a)) {
          const card = el('div', 'g-item');
          card.append(el('h4', null, c.title));
          const chip = el('span', 'rule-chip', c.rule + (c.level > this.settings.level ? ' · not in your deck' : ''));
          card.append(chip);
          card.append(el('p', null, c.shows));
          if (c.mnemonic) { const p = el('p'); p.append(el('em', null, `“${c.mnemonic}”`)); card.append(p); }
          const dots = el('div', 'dots');
          for (const b of c.bodies) for (const l of b.lights) {
            const d = lightDot(l);
            d.title = (b.tow ? 'Tow: ' : '') + V.lightName(l);
            dots.append(d);
          }
          card.append(dots);
          cards.push(card);
        }
      }
      this.$.guideList.replaceChildren(...cards);
    }

    toggleSettings(force) {
      const open = force != null ? force : this.$.settings.hidden;
      this.$.settings.hidden = !open;
      this.$.modeBtn.setAttribute('aria-expanded', String(open));
    }

    toggleGuide(force) {
      const open = force != null ? force : this.$.guide.hidden;
      this.$.guide.hidden = !open;
      if (open) { this.toggleSettings(false); $('guideClose').focus(); }
    }

    zoomBy(f) {
      this.scene.zoom = Math.max(0.5, Math.min(4, this.scene.zoom * f));
    }

    bind() {
      this.$.next.addEventListener('click', () => this.next());
      this.$.modeBtn.addEventListener('click', (e) => { e.stopPropagation(); this.toggleSettings(); });
      document.addEventListener('click', (e) => {
        if (!this.$.settings.hidden && !this.$.settings.contains(e.target)) this.toggleSettings(false);
      });
      document.querySelectorAll('.seg').forEach((seg) => {
        seg.addEventListener('click', (e) => {
          const b = e.target.closest('button');
          if (b) this.changeSetting(seg.dataset.setting, b.dataset.v);
        });
      });
      this.$.moonRange.addEventListener('input', () => {
        this.settings.moon = Number(this.$.moonRange.value);
        this.scene.moon = this.settings.moon / 100;
        this.applySettingsUI();
      });
      this.$.moonRange.addEventListener('change', () => this.persist());
      this.$.seaRange.addEventListener('input', () => {
        this.settings.sea = Number(this.$.seaRange.value);
        this.scene.waves.scale = seaScale(this.settings.sea);
        this.applySettingsUI();
      });
      this.$.seaRange.addEventListener('change', () => this.persist());
      $('resetBtn').addEventListener('click', () => {
        this.stats = { answered: 0, correct: 0, streak: 0, best: 0, points: 0 };
        this.persist();
        this.renderStats(false);
      });
      $('guideBtn').addEventListener('click', () => this.toggleGuide(true));
      $('guideClose').addEventListener('click', () => this.toggleGuide(false));
      this.$.guide.addEventListener('click', (e) => { if (e.target === this.$.guide) this.toggleGuide(false); });
      $('zoomIn').addEventListener('click', () => this.zoomBy(1.3));
      $('zoomOut').addEventListener('click', () => this.zoomBy(1 / 1.3));
      window.addEventListener('wheel', (e) => {
        if (e.target.closest('.card, .modal, .popover')) return;
        this.zoomBy(Math.exp(-e.deltaY * 0.0015));
      }, { passive: true });

      new ResizeObserver(() => this.updateFrame()).observe(this.$.card);
      window.addEventListener('resize', () => this.updateFrame());
      this.updateFrame();

      window.addEventListener('keydown', (e) => {
        if (e.metaKey || e.ctrlKey || e.altKey) return;
        if (!this.$.guide.hidden) {
          if (e.key === 'Escape' || e.key === 'g' || e.key === 'G') { e.preventDefault(); this.toggleGuide(false); }
          return;
        }
        if (e.key === 'Escape') { this.toggleSettings(false); return; }
        const onButton = e.target && e.target.tagName === 'BUTTON';
        if (/^[1-4]$/.test(e.key)) { e.preventDefault(); this.answer(Number(e.key) - 1); return; }
        if ((e.key === 'Enter' || e.key === ' ') && !onButton) { e.preventDefault(); this.next(); return; }
        if (e.key === 'ArrowRight') { this.next(); return; }
        if (e.key === 'g' || e.key === 'G') { this.toggleGuide(true); return; }
        if (e.key === '+' || e.key === '=') { this.zoomBy(1.3); return; }
        if (e.key === '-' || e.key === '_') { this.zoomBy(1 / 1.3); }
      });
    }

    // Keep the vessel in the open sky/sea above the card.
    updateFrame() {
      const top = this.$.card.getBoundingClientRect().top;
      const H = window.innerHeight || 1;
      this.scene.targetFracY = Math.max(0.2, Math.min(0.4, (top / H) * 0.5 + 0.02));
    }
  }

  NW.App = App;
  NW.drawDiagram = drawDiagram;
})();
