/*
 * Vessel catalog: light configurations from the U.S. Coast Guard Navigation Rules
 * (International / COLREGS and Inland Rules, Parts C and Annex I).
 *
 * Local vessel frame (meters):  x = starboard, y = up from the waterline, z = forward (bow).
 * Relative bearing (beta) = direction of the OBSERVER as seen from the vessel, in degrees,
 * measured clockwise from dead ahead: 0 = dead ahead, +90 = starboard beam, 180 = dead astern,
 * -90 = port beam.
 */
(function () {
  'use strict';
  const NW = (window.NW = window.NW || {});

  // Sidelights are fitted so both show from dead ahead, cutting off 1–3° past it (Annex I §9).
  const SPILL = 2;

  const COLORS = {
    W: { name: 'white', rgb: [1.0, 0.95, 0.86], css: '#fff1d6' },
    R: { name: 'red', rgb: [1.0, 0.13, 0.08], css: '#ff3b2c' },
    G: { name: 'green', rgb: [0.1, 1.0, 0.56], css: '#2cf59b' },
    Y: { name: 'yellow', rgb: [1.0, 0.7, 0.12], css: '#ffb627' },
    B: { name: 'blue', rgb: [0.25, 0.42, 1.0], css: '#4f7dff' },
  };

  // Sectored light kinds: arc = center bearing ± half-width (degrees).
  const KINDS = {
    masthead: {
      c: 'W', center: 0, half: 112.5, name: 'Masthead light',
      arc: '225° — from dead ahead to 22.5° abaft the beam on each side',
    },
    stbd: {
      c: 'G', center: (112.5 - SPILL) / 2, half: (112.5 + SPILL) / 2, name: 'Starboard sidelight',
      arc: '112.5° — from dead ahead to 22.5° abaft the starboard beam',
    },
    port: {
      c: 'R', center: -(112.5 - SPILL) / 2, half: (112.5 + SPILL) / 2, name: 'Port sidelight',
      arc: '112.5° — from dead ahead to 22.5° abaft the port beam',
    },
    stern: {
      c: 'W', center: 180, half: 67.5, name: 'Sternlight',
      arc: '135° — 67.5° each side of dead astern',
    },
    towing: {
      c: 'Y', center: 180, half: 67.5, name: 'Towing light',
      arc: '135° aft — same arc as the sternlight',
    },
    special: {
      c: 'Y', center: 0, half: 112.5, hz: 1.0, name: 'Special flashing light',
      arc: '180–225° forward, flashing 50–70 times a minute',
    },
    allround: { c: 'W', center: 0, half: 180, name: 'All-round light', arc: '360°' },
  };

  // ---------------------------------------------------------------- geometry helpers
  const box = (x0, x1, y0, y1, z0, z1) => [
    [x0, y0, z0], [x1, y0, z0], [x0, y1, z0], [x1, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x0, y1, z1], [x1, y1, z1],
  ];
  const pole = (x, z, y0, y1, w = 0.25) => box(x - w / 2, x + w / 2, y0, y1, z - w / 2, z + w / 2);
  const spar = (a, b, w = 0.3) => {
    const h = w / 2;
    const out = [];
    for (const p of [a, b]) {
      out.push([p[0] - h, p[1] - h, p[2]], [p[0] + h, p[1] - h, p[2]], [p[0] - h, p[1] + h, p[2]], [p[0] + h, p[1] + h, p[2]]);
    }
    return out;
  };
  const tri = (a, b, c, t = 0.04) => [a, b, c].flatMap((p) => [[p[0] - t, p[1], p[2]], [p[0] + t, p[1], p[2]]]);

  // Simple convex hull: transom stern, parallel mid-body, raked & flared bow.
  function hull(L, B, fb, o = {}) {
    const hl = L / 2, hb = B / 2;
    const bow = o.bow ?? 0.22;
    const sheer = o.sheer ?? fb * 0.25;
    const zb = hl - L * bow;
    const zs = -hl + L * 0.08;
    return [
      [hb * 0.82, 0, -hl], [-hb * 0.82, 0, -hl], [hb * 0.9, fb, -hl], [-hb * 0.9, fb, -hl],
      [hb, 0, zs], [-hb, 0, zs], [hb, fb, zs], [-hb, fb, zs],
      [hb, 0, zb], [-hb, 0, zb], [hb, fb, zb], [-hb, fb, zb],
      [hb * 0.55, fb + sheer * 0.6, hl - L * bow * 0.45], [-hb * 0.55, fb + sheer * 0.6, hl - L * bow * 0.45],
      [0, 0, hl - L * 0.05], [0, fb + sheer, hl],
    ];
  }
  const Hp = (pts) => ({ pts, tone: 'hull' });
  const Sp = (pts) => ({ pts, tone: 'sail' });
  const shift = (parts, dz) => parts.map((p) => ({ tone: p.tone, pts: p.pts.map((q) => [q[0], q[1], q[2] + dz]) }));

  // ---------------------------------------------------------------- silhouettes
  const MODELS = {
    runabout: () => [
      Hp(hull(7.5, 2.5, 0.9, { bow: 0.35 })),
      Hp(box(-0.6, 0.6, 0.9, 1.6, -0.8, 0.5)),
      Hp(box(-0.9, 0.9, 1.0, 1.45, 0.5, 0.75)),
      Hp(pole(0, -3.2, 0.9, 2.75, 0.07)),
    ],
    workboat: () => [
      Hp(hull(28, 7, 2.2)),
      Hp(box(-2.8, 2.8, 2.2, 4.6, -7, 5)),
      Hp(box(-2.2, 2.2, 4.6, 6.6, 0.5, 4.5)),
      Hp(pole(0, 3.5, 6.6, 9.7, 0.2)),
      Hp(pole(0, -12.5, 2.2, 3.0, 0.15)),
    ],
    containerShip: () => [
      Hp(hull(160, 25, 10, { bow: 0.15 })),
      Hp(box(-12.5, 12.5, 10, 22, -52, 62)),
      Hp(box(-12, 12, 10, 33, -68, -54)),
      Hp(box(-13, 13, 30, 32, -60, -57)),
      Hp(box(-3, 3, 33, 37, -68, -63)),
      Hp(pole(0, 66, 10, 26.4, 0.6)),
      Hp(pole(0, -60, 33, 40.4, 0.5)),
    ],
    sloop: () => [
      Hp(hull(12, 3.8, 1.1, { bow: 0.3 })),
      Hp(box(-1.2, 1.2, 1.1, 1.8, -2.6, 1.6)),
      Hp(pole(0, 1.0, 1.1, 16.4, 0.14)),
      Sp(tri([0, 2.3, 0.9], [0, 15.6, 0.9], [0, 2.3, -4.6])),
      Sp(tri([0, 14.8, 1.15], [0, 1.6, 5.7], [0, 1.6, 1.0])),
    ],
    cruiser: () => [
      Hp(hull(14, 4.3, 1.5, { bow: 0.3 })),
      Hp(box(-1.8, 1.8, 1.5, 3.3, -4.5, 3)),
      Hp(box(-1.5, 1.5, 3.3, 4.1, -3, 0.8)),
      Hp(pole(0, 0.5, 4.1, 6.2, 0.1)),
    ],
    freighter: () => [
      Hp(hull(110, 17, 8, { bow: 0.16 })),
      Hp(box(-8.5, 8.5, 8, 21, -52, -38)),
      Hp(box(-9.5, 9.5, 19, 20.5, -46, -42)),
      Hp(box(-2.5, 2.5, 21, 26, -50, -45)),
      Hp(pole(0, 52, 8, 17.4, 0.5)),
      Hp(pole(0, -44, 21, 27.4, 0.4)),
      Hp(pole(0, 22, 8, 21, 0.7)),
      Hp(spar([0, 20, 22], [0, 10, 38], 0.4)),
      Hp(pole(0, -12, 8, 21, 0.7)),
      Hp(spar([0, 20, -12], [0, 10, 4], 0.4)),
    ],
    trawler: () => [
      Hp(hull(24, 7, 2)),
      Hp(box(-2.6, 2.6, 2, 5.6, 2.5, 8)),
      Hp(pole(0, 6, 5.6, 12.3, 0.2)),
      Hp(box(-3.1, -2.7, 2, 7.5, -10.5, -10.1)),
      Hp(box(2.7, 3.1, 2, 7.5, -10.5, -10.1)),
      Hp(box(-3.1, 3.1, 7.1, 7.5, -10.5, -10.1)),
    ],
    factoryTrawler: () => [
      Hp(hull(60, 13, 5)),
      Hp(box(-6, 6, 5, 11, 8, 24)),
      Hp(pole(0, 18, 11, 15.4, 0.3)),
      Hp(pole(0, -12, 5, 21.4, 0.35)),
      Hp(box(-5.6, -5.0, 5, 13, -28, -27)),
      Hp(box(5.0, 5.6, 5, 13, -28, -27)),
      Hp(box(-5.6, 5.6, 12.4, 13, -28, -27)),
    ],
    fishing: () => [
      Hp(hull(20, 6, 1.8)),
      Hp(box(-2, 2, 1.8, 4.8, -0.5, 4.5)),
      Hp(pole(0, 0.5, 4.8, 9.8, 0.18)),
      Hp(box(-1.5, 1.5, 1.8, 3, -8, -6)),
      Hp(spar([4.2, 2.0, 0.5], [4.2, 5.8, 0.5], 0.12)),
    ],
    tug: () => [
      Hp(hull(25, 9, 2.2, { bow: 0.3 })),
      Hp(box(-3.5, 3.5, 2.2, 5, -3, 6)),
      Hp(box(-2.6, 2.6, 5, 8, 1, 5.5)),
      Hp(pole(0, 3, 8, 14.8, 0.25)),
      Hp(box(-0.8, 0.8, 5, 7.5, -2, -0.5)),
      Hp(pole(0, -12.4, 2.2, 5.4, 0.2)),
    ],
    barge: () => [
      Hp([...box(-7, 7, 0.7, 2.6, -30, 30), ...box(-7, 7, 0, 0.7, -27, 27)]),
      Hp(pole(6.8, 28.5, 2.6, 3.7, 0.12)),
      Hp(pole(-6.8, 28.5, 2.6, 3.7, 0.12)),
    ],
    pushTow: () => [...MODELS.tug(), ...shift(MODELS.barge(), 42.5)],
    tender: () => [
      Hp(hull(45, 11, 3)),
      Hp(box(-4.5, 4.5, 3, 9.5, 8, 17)),
      Hp(pole(0, 12, 9.5, 21.3, 0.3)),
      Hp(pole(-2, -5, 3, 12, 0.6)),
      Hp(spar([-2, 11.5, -5], [0, 5, -18], 0.45)),
    ],
    pilotBoat: () => [
      Hp(hull(16, 5, 1.6, { bow: 0.3 })),
      Hp(box(-1.9, 1.9, 1.6, 4.2, -1.5, 4)),
      Hp(pole(0, 1.5, 4.2, 8.4, 0.12)),
      Hp(pole(0, 7.3, 1.6, 3.2, 0.08)),
    ],
    dredge: () => [
      Hp(box(-8, 8, 0, 2.5, -20, 20)),
      Hp(box(-5, 5, 2.5, 7.5, -17, -6)),
      Hp(pole(-5, -19, 0, 19, 0.8)),
      Hp(pole(5, -19, 0, 19, 0.8)),
      Hp(spar([-4, 2.5, 19], [0, 12, 12], 0.4)),
      Hp(spar([4, 2.5, 19], [0, 12, 12], 0.4)),
      Hp(spar([0, 12, 12], [0, -1, 26], 0.6)),
      Hp(pole(0, -8, 7.5, 16.4, 0.25)),
      Hp(pole(-8, 4, 2.5, 9.4, 0.15)),
      Hp(pole(8, 4, 2.5, 9.4, 0.15)),
    ],
    tanker: () => [
      Hp(hull(200, 32, 12, { bow: 0.12 })),
      Hp(box(-15, 15, 12, 36, -96, -80)),
      Hp(box(-16, 16, 33, 35, -86, -82)),
      Hp(box(-3, 3, 36, 42, -95, -90)),
      Hp(pole(0, -86, 36, 50.4, 0.5)),
      Hp(pole(0, 92, 12, 30.4, 0.6)),
      Hp(box(-2, 2, 12, 15, -78, 88)),
    ],
    minesweeper: () => [
      Hp(hull(48, 9, 3.5, { bow: 0.25 })),
      Hp(box(-4, 4, 3.5, 10.5, -6, 14)),
      Hp(box(-2.5, 2.5, 10.5, 13, 2, 9)),
      Hp(pole(0, 8, 10.5, 23.8, 0.3)),
      Hp(box(-5, 5, 21.3, 21.7, 7.85, 8.15)),
      Hp(pole(0, -12, 3.5, 9, 0.25)),
    ],
    hovercraft: () => [
      Hp(box(-5.5, 5.5, 0, 1.6, -12, 12)),
      Hp(box(-4.5, 4.5, 1.6, 5, -6, 9)),
      Hp(box(-5.2, -0.4, 1.6, 6.2, -12, -10)),
      Hp(box(0.4, 5.2, 1.6, 6.2, -12, -10)),
      Hp(pole(0, 5, 5, 7.7, 0.12)),
      Hp(pole(0, 3, 5, 8.8, 0.1)),
    ],
    patrol: () => [
      Hp(hull(12, 3.8, 1.3, { bow: 0.3 })),
      Hp(box(-1.5, 1.5, 1.3, 3.1, -2.5, 2.5)),
      Hp(box(-1.6, 1.6, 3.1, 3.45, -2.2, -1.4)),
      Hp(pole(0, -1.8, 3.1, 5.6, 0.08)),
    ],
  };

  // ---------------------------------------------------------------- light helpers
  const mh = (x, y, z, role) => ({ k: 'masthead', p: [x, y, z], role });
  const sides = (hx, y, z) => [{ k: 'stbd', p: [hx, y, z] }, { k: 'port', p: [-hx, y, z] }];
  const stern = (y, z) => ({ k: 'stern', p: [0, y, z] });
  const towL = (y, z) => ({ k: 'towing', p: [0, y, z] });
  const ar = (c, x, y, z, role) => ({ k: 'allround', c, p: [x, y, z], role });
  const flash = (c, hz, x, y, z, role) => ({ k: 'allround', c, hz, p: [x, y, z], role });
  const special = (y, z) => ({ k: 'special', p: [0, y, z] });

  // ---------------------------------------------------------------- answers (what the quiz asks you to name)
  const ANSWERS = {
    power: { name: 'Power-driven vessel underway (under 50 m)' },
    power50: { name: 'Power-driven vessel underway (50 m or more)' },
    sail: { name: 'Sailing vessel underway' },
    anchor: { name: 'Vessel at anchor' },
    nuc: { name: 'Vessel not under command' },
    trawl: { name: 'Vessel engaged in trawling' },
    fish: { name: 'Vessel fishing (other than trawling)' },
    tow: { name: 'Towing astern — tow 200 m or less' },
    towLong: { name: 'Towing astern — tow longer than 200 m' },
    push: { name: 'Pushing ahead or towing alongside' },
    ram: { name: 'Vessel restricted in her ability to maneuver' },
    pilot: { name: 'Pilot vessel on duty' },
    aground: { name: 'Vessel aground' },
    cbd: { name: 'Vessel constrained by her draft' },
    dredge: { name: 'Dredging, with an obstruction on one side' },
    mine: { name: 'Vessel engaged in mine clearance' },
    hover: { name: 'Air-cushion vessel (hovercraft)' },
    leo: { name: 'Law enforcement vessel' },
  };

  // ---------------------------------------------------------------- configurations
  const CONFIGS = [
    // ============ Level 1 — the basics
    {
      id: 'power-under50', answer: 'power', level: 1,
      title: 'Power-driven vessel underway (under 50 m)', rule: 'Rule 23(a)',
      shows: 'One masthead light forward, sidelights — red to port, green to starboard — and a sternlight.',
      note: 'Under 50 m, a second (higher, after) masthead light is optional.',
      making: true, speed: 3, dist: [850, 1200],
      bodies: [{ model: 'workboat', z: 0, lights: [mh(0, 9.6, 3.5), ...sides(2.9, 5.2, 3), stern(2.8, -14)] }],
    },
    {
      id: 'power-under12', answer: 'power', level: 1,
      title: 'Power-driven vessel under 12 m, underway', rule: 'Rule 23',
      shows: 'An all-round white light plus sidelights (often a combined lantern at the bow). The all-round white takes the place of both the masthead light and the sternlight.',
      making: true, speed: 3, dist: [420, 620],
      bodies: [{
        model: 'runabout', z: 0,
        lights: [ar('W', 0, 2.75, -3.2, 'All-round white light'), { k: 'stbd', p: [0.15, 1.2, 3.3] }, { k: 'port', p: [-0.15, 1.2, 3.3] }],
      }],
    },
    {
      id: 'power-over50', answer: 'power50', level: 1,
      title: 'Power-driven vessel underway (50 m or more)', rule: 'Rule 23(a)',
      shows: 'Two masthead lights — the after one higher than the forward one — plus sidelights and a sternlight.',
      tip: 'The two masthead lights work like range lights: stacked one above the other means she’s pointed at you; when they open up, the lower (forward) light points the way she’s heading.',
      making: true, speed: 4, dist: [1700, 2300],
      bodies: [{
        model: 'containerShip', z: 0,
        lights: [mh(0, 26, 66, 'Forward masthead light'), mh(0, 40, -60, 'After masthead light (higher)'), ...sides(12.6, 18, -58), stern(12, -80)],
      }],
    },
    {
      id: 'sail-basic', answer: 'sail', level: 1,
      title: 'Sailing vessel underway', rule: 'Rule 25(a)',
      shows: 'Sidelights and a sternlight only — no masthead light.',
      tip: 'A white light above her red/green means the engine is running: she’s a power-driven vessel, sails or not.',
      making: true, speed: 2.5, dist: [480, 680],
      bodies: [{ model: 'sloop', z: 0, lights: [...sides(1.35, 1.6, 3.2), stern(1.3, -5.9)] }],
    },
    {
      id: 'sail-tricolor', answer: 'sail', level: 1,
      title: 'Sailing vessel under 20 m, tricolor lantern', rule: 'Rule 25(b)',
      shows: 'Under 20 m, she may combine her sidelights and sternlight into one tricolor lantern at or near the top of the mast.',
      tip: 'Tricolors sit high on the mast, so they show over waves — but they can’t be used together with the red-over-green masthead lights.',
      making: true, speed: 2.5, dist: [480, 680],
      bodies: [{
        model: 'sloop', z: 0,
        lights: [{ k: 'stbd', p: [0.1, 16.3, 1.05] }, { k: 'port', p: [-0.1, 16.3, 1.05] }, { k: 'stern', p: [0, 16.3, 0.95] }],
      }],
    },
    {
      id: 'sail-redgreen', answer: 'sail', level: 1,
      title: 'Sailing vessel with optional masthead lights', rule: 'Rule 25(c)',
      shows: 'Sidelights and a sternlight, plus two optional all-round lights at the masthead: red over green.',
      mnemonic: 'Red over green, sailing machine.',
      making: true, speed: 2.5, dist: [480, 680],
      bodies: [{
        model: 'sloop', z: 0,
        lights: [ar('R', 0, 16.2, 1.0, 'All-round red (upper)'), ar('G', 0, 15.2, 1.0, 'All-round green (lower)'), ...sides(1.35, 1.6, 3.2), stern(1.3, -5.9)],
      }],
    },
    {
      id: 'anchor-small', answer: 'anchor', level: 1,
      title: 'Vessel at anchor (under 50 m)', rule: 'Rule 30(b)',
      shows: 'A single all-round white light where it can best be seen.',
      making: false, dist: [450, 650],
      bodies: [{ model: 'cruiser', z: 0, lights: [ar('W', 0, 6.3, 0.5, 'Anchor light')] }],
    },
    {
      id: 'anchor-large', answer: 'anchor', level: 1,
      title: 'Vessel at anchor (50 m or more)', rule: 'Rule 30(a)',
      shows: 'An all-round white light in the fore part, and a second all-round white light at or near the stern, lower than the forward one.',
      tip: 'The higher anchor light marks her bow.',
      making: false, dist: [1200, 1600],
      bodies: [{
        model: 'freighter', z: 0,
        lights: [ar('W', 0, 17.5, 52, 'Forward anchor light'), ar('W', 0, 11.2, -54, 'After anchor light (lower)')],
      }],
    },
    {
      id: 'nuc-stopped', answer: 'nuc', level: 1,
      title: 'Not under command, not making way', rule: 'Rule 27(a)',
      shows: 'Two all-round red lights in a vertical line. No sidelights or sternlight, because she isn’t making way through the water.',
      mnemonic: 'Red over red, the captain is dead.',
      making: false, dist: [1200, 1600],
      bodies: [{ model: 'freighter', z: 0, lights: [ar('R', 0, 27.5, -44, 'All-round red (upper)'), ar('R', 0, 25.5, -44, 'All-round red (lower)')] }],
    },
    {
      id: 'nuc-moving', answer: 'nuc', level: 1,
      title: 'Not under command, making way', rule: 'Rule 27(a)',
      shows: 'Two all-round red lights in a vertical line, plus sidelights and a sternlight because she’s making way. Note: no masthead light.',
      mnemonic: 'Red over red, the captain is dead.',
      making: true, speed: 1.5, dist: [1200, 1600],
      bodies: [{
        model: 'freighter', z: 0,
        lights: [ar('R', 0, 27.5, -44, 'All-round red (upper)'), ar('R', 0, 25.5, -44, 'All-round red (lower)'), ...sides(9.6, 15, -43), stern(9, -55)],
      }],
    },
    {
      id: 'trawl-moving', answer: 'trawl', level: 1,
      title: 'Trawling, making way (under 50 m)', rule: 'Rule 26(b)',
      shows: 'Two all-round lights in a vertical line — green over white — plus sidelights and a sternlight while making way.',
      note: 'Under 50 m, the masthead light abaft the green is optional.',
      mnemonic: 'Green over white, trawling tonight.',
      making: true, speed: 1.5, dist: [800, 1100],
      bodies: [{
        model: 'trawler', z: 0,
        lights: [ar('G', 0, 12.2, 6, 'All-round green (upper)'), ar('W', 0, 10.2, 6, 'All-round white (lower)'), ...sides(2.7, 4.6, 5.5), stern(3, -11.8)],
      }],
    },
    {
      id: 'fish-moving', answer: 'fish', level: 1,
      title: 'Fishing (not trawling), making way', rule: 'Rule 26(c)',
      shows: 'Two all-round lights in a vertical line — red over white — plus sidelights and a sternlight while making way.',
      mnemonic: 'Red over white, fishing at night.',
      making: true, speed: 1.2, dist: [750, 1050],
      bodies: [{
        model: 'fishing', z: 0,
        lights: [ar('R', 0, 9.7, 0.5, 'All-round red (upper)'), ar('W', 0, 7.7, 0.5, 'All-round white (lower)'), ...sides(2.1, 4.2, 4.4), stern(2.5, -9.8)],
      }],
    },
    {
      id: 'fish-stopped', answer: 'fish', level: 1,
      title: 'Fishing (not trawling), not making way', rule: 'Rule 26(c)',
      shows: 'Red over white all-round lights only — no sidelights or sternlight while she isn’t making way.',
      mnemonic: 'Red over white, fishing at night.',
      making: false, dist: [750, 1050],
      bodies: [{ model: 'fishing', z: 0, lights: [ar('R', 0, 9.7, 0.5, 'All-round red (upper)'), ar('W', 0, 7.7, 0.5, 'All-round white (lower)')] }],
    },

    // ============ Level 2 — working vessels
    {
      id: 'trawl-stopped', answer: 'trawl', level: 2,
      title: 'Trawling, not making way', rule: 'Rule 26(b)',
      shows: 'Green over white all-round lights only — no sidelights or sternlight while she isn’t making way.',
      mnemonic: 'Green over white, trawling tonight.',
      making: false, dist: [800, 1100],
      bodies: [{ model: 'trawler', z: 0, lights: [ar('G', 0, 12.2, 6, 'All-round green (upper)'), ar('W', 0, 10.2, 6, 'All-round white (lower)')] }],
    },
    {
      id: 'trawl-large', answer: 'trawl', level: 2,
      title: 'Trawling, 50 m or more, making way', rule: 'Rule 26(b)',
      shows: 'Green over white all-round lights, a masthead light abaft of and higher than the green, plus sidelights and a sternlight while making way.',
      mnemonic: 'Green over white, trawling tonight.',
      making: true, speed: 1.5, dist: [1100, 1500],
      bodies: [{
        model: 'factoryTrawler', z: 0,
        lights: [ar('G', 0, 15.2, 18, 'All-round green (upper)'), ar('W', 0, 13.2, 18, 'All-round white (lower)'), mh(0, 21.2, -12, 'Masthead light (abaft and above the green)'), ...sides(6.2, 9.5, 16), stern(5.5, -29.8)],
      }],
    },
    {
      id: 'fish-gear', answer: 'fish', level: 2,
      title: 'Fishing with gear extending more than 150 m', rule: 'Rule 26(c)(ii)',
      shows: 'Red over white all-round lights, plus an all-round white light toward outlying gear that extends more than 150 m horizontally.',
      mnemonic: 'Red over white, fishing at night.',
      making: false, dist: [700, 1000],
      bodies: [{
        model: 'fishing', z: 0,
        lights: [ar('R', 0, 9.7, 0.5, 'All-round red (upper)'), ar('W', 0, 7.7, 0.5, 'All-round white (lower)'), ar('W', 4.2, 5.9, 0.5, 'All-round white toward the gear')],
      }],
      extra: {
        prompt: 'What does the lone white light off to one side mark?',
        options: ['Gear extending more than 150 m in that direction', 'Her stern', 'A second boat tied alongside', 'Her anchor'],
        correct: 0,
        explain: 'Rule 26(c)(ii): an all-round white light (by day, a cone point-up) shows the direction of gear reaching more than 150 m from the vessel. Give that side a wide berth.',
      },
    },
    {
      id: 'tow-short', answer: 'tow', level: 2,
      title: 'Towing astern, tow 200 m or less', rule: 'Rule 24(a), 24(e)',
      shows: 'Two masthead lights in a vertical line, sidelights, a sternlight, and a yellow towing light directly above the sternlight. The vessel being towed shows sidelights and a sternlight.',
      making: true, speed: 2.5, dist: [1300, 1700],
      bodies: [
        { model: 'tug', z: 0, lights: [mh(0, 12.6, 3, 'Masthead light (lower)'), mh(0, 14.6, 3, 'Masthead light (upper)'), ...sides(3.6, 6, 4.5), stern(3.2, -12.4), towL(5.2, -12.4)] },
        { model: 'barge', z: -132.5, tow: true, lights: [...sides(6.8, 3.7, 28.5), stern(3.4, -30)] },
      ],
      towLine: true,
    },
    {
      id: 'tow-long', answer: 'towLong', level: 2,
      title: 'Towing astern, tow longer than 200 m', rule: 'Rule 24(a), 24(e)',
      shows: 'Three masthead lights in a vertical line, sidelights, a sternlight and a yellow towing light above it. Tow length is measured from the tug’s stern to the after end of the tow. The tow shows sidelights and a sternlight.',
      making: true, speed: 2.5, dist: [1900, 2400],
      bodies: [
        { model: 'tug', z: 0, lights: [mh(0, 10.6, 3, 'Masthead light (lowest)'), mh(0, 12.6, 3, 'Masthead light (middle)'), mh(0, 14.6, 3, 'Masthead light (upper)'), ...sides(3.6, 6, 4.5), stern(3.2, -12.4), towL(5.2, -12.4)] },
        { model: 'barge', z: -272.5, tow: true, lights: [...sides(6.8, 3.7, 28.5), stern(3.4, -30)] },
      ],
      towLine: true,
    },
    {
      id: 'push-intl', answer: 'push', level: 2, rules: ['intl'],
      title: 'Pushing ahead (International)', rule: 'Rule 24(c), 24(f)',
      shows: 'Two masthead lights in a vertical line, sidelights and a sternlight on the pushing vessel; the barge pushed ahead shows sidelights at its forward end.',
      making: true, speed: 2, dist: [1100, 1500],
      bodies: [{
        model: 'pushTow', z: 0,
        lights: [mh(0, 12.6, 3, 'Masthead light (lower)'), mh(0, 14.6, 3, 'Masthead light (upper)'), ...sides(3.6, 6, 4.5), stern(3.2, -12.4), ...sides(6.8, 3.7, 71).map((l) => ({ ...l, role: l.k === 'stbd' ? 'Barge starboard sidelight' : 'Barge port sidelight' }))],
      }],
    },
    {
      id: 'push-inland', answer: 'push', level: 2, rules: ['inland'],
      title: 'Pushing ahead (Inland)', rule: 'Inland Rule 24(c), 24(f)',
      shows: 'Two masthead lights in a vertical line, sidelights, and two yellow towing lights in a vertical line instead of a sternlight. The barge ahead shows sidelights and a yellow special flashing light at its bow.',
      making: true, speed: 2, dist: [1100, 1500],
      bodies: [{
        model: 'pushTow', z: 0,
        lights: [mh(0, 12.6, 3, 'Masthead light (lower)'), mh(0, 14.6, 3, 'Masthead light (upper)'), ...sides(3.6, 6, 4.5), { ...towL(3.4, -12.4), role: 'Towing light (lower)' }, { ...towL(5.4, -12.4), role: 'Towing light (upper)' }, ...sides(6.8, 3.7, 71).map((l) => ({ ...l, role: l.k === 'stbd' ? 'Barge starboard sidelight' : 'Barge port sidelight' })), special(4.6, 72.3)],
      }],
    },
    {
      id: 'ram-moving', answer: 'ram', level: 2,
      title: 'Restricted in ability to maneuver, making way', rule: 'Rule 27(b)',
      shows: 'All-round lights red-white-red in a vertical line, plus a masthead light, sidelights and a sternlight while making way.',
      tip: 'Red-white-red means her work (buoy tending, cable laying, towing she can’t steer out of) limits how well she can keep out of your way.',
      making: true, speed: 2, dist: [1000, 1400],
      bodies: [{
        model: 'tender', z: 0,
        lights: [mh(0, 21.4, 12.2), ar('R', 0, 18.6, 12, 'All-round red (top)'), ar('W', 0, 16.6, 12, 'All-round white (middle)'), ar('R', 0, 14.6, 12, 'All-round red (bottom)'), ...sides(5.2, 9.5, 12), stern(4, -22)],
      }],
    },
    {
      id: 'ram-stopped', answer: 'ram', level: 2,
      title: 'Restricted in ability to maneuver, not making way', rule: 'Rule 27(b)',
      shows: 'Red-white-red all-round lights in a vertical line only.',
      making: false, dist: [1000, 1400],
      bodies: [{ model: 'tender', z: 0, lights: [ar('R', 0, 18.6, 12, 'All-round red (top)'), ar('W', 0, 16.6, 12, 'All-round white (middle)'), ar('R', 0, 14.6, 12, 'All-round red (bottom)')] }],
    },
    {
      id: 'pilot-underway', answer: 'pilot', level: 2,
      title: 'Pilot vessel on duty, underway', rule: 'Rule 29(a)',
      shows: 'White over red all-round lights at or near the masthead, plus sidelights and a sternlight.',
      mnemonic: 'White over red, pilot ahead.',
      making: true, speed: 3, dist: [650, 900],
      bodies: [{ model: 'pilotBoat', z: 0, lights: [ar('W', 0, 8.3, 1.5, 'All-round white (upper)'), ar('R', 0, 7.3, 1.5, 'All-round red (lower)'), ...sides(2.3, 3.4, 2.5), stern(2.0, -7.9)] }],
    },
    {
      id: 'pilot-anchored', answer: 'pilot', level: 2,
      title: 'Pilot vessel on duty, at anchor', rule: 'Rule 29(a)',
      shows: 'White over red all-round lights, plus her anchor light.',
      mnemonic: 'White over red, pilot ahead.',
      making: false, dist: [650, 900],
      bodies: [{ model: 'pilotBoat', z: 0, lights: [ar('W', 0, 8.3, 1.5, 'All-round white (upper)'), ar('R', 0, 7.3, 1.5, 'All-round red (lower)'), ar('W', 0, 3.2, 7.3, 'Anchor light')] }],
    },

    // ============ Level 3 — everything else
    {
      id: 'aground', answer: 'aground', level: 3,
      title: 'Vessel aground', rule: 'Rule 30(d)',
      shows: 'Her anchor lights, plus two all-round red lights in a vertical line.',
      tip: 'The same two reds as “not under command,” but with anchor lights: she’s stuck — and the water around her is shallow.',
      making: false, dist: [1200, 1600],
      bodies: [{
        model: 'freighter', z: 0,
        lights: [ar('W', 0, 17.5, 52, 'Forward anchor light'), ar('W', 0, 11.2, -54, 'After anchor light (lower)'), ar('R', 0, 27.5, -44, 'All-round red (upper)'), ar('R', 0, 25.5, -44, 'All-round red (lower)')],
      }],
    },
    {
      id: 'cbd', answer: 'cbd', level: 3, rules: ['intl'],
      title: 'Constrained by her draft', rule: 'Rule 28 (International only)',
      shows: 'The lights of a power-driven vessel, plus three all-round red lights in a vertical line.',
      note: 'The Inland Rules have no constrained-by-draft signal.',
      making: true, speed: 3, dist: [2300, 2800],
      bodies: [{
        model: 'tanker', z: 0,
        lights: [mh(0, 30.2, 92, 'Forward masthead light'), mh(0, 50.2, -86, 'After masthead light (higher)'), ar('R', 0, 46, -86, 'All-round red (top)'), ar('R', 0, 44, -86, 'All-round red (middle)'), ar('R', 0, 42, -86, 'All-round red (bottom)'), ...sides(16, 22, -84), stern(14, -100)],
      }],
      extra: {
        prompt: 'Where can a vessel use this signal?',
        options: ['International waters only', 'Inland waters only', 'Both Inland and International waters', 'Only on the Western Rivers'],
        correct: 0,
        explain: 'Rule 28 exists only in the International Rules. Inland waters have no constrained-by-draft signal.',
      },
    },
    {
      id: 'dredge', answer: 'dredge', level: 3,
      title: 'Dredge with an obstruction on one side', rule: 'Rule 27(d)',
      shows: 'Red-white-red all-round lights, two all-round reds marking the obstructed side, and two all-round greens marking the side where you may pass.',
      making: false, dist: [900, 1250],
      bodies: [{
        model: 'dredge', z: 0,
        lights: [
          ar('R', 0, 16.6, -8, 'All-round red (top)'), ar('W', 0, 14.6, -8, 'All-round white (middle)'), ar('R', 0, 12.6, -8, 'All-round red (bottom)'),
          ar('R', -8, 9.5, 4, 'Obstruction side — red (upper)'), ar('R', -8, 7.5, 4, 'Obstruction side — red (lower)'),
          ar('G', 8, 9.5, 4, 'Safe side — green (upper)'), ar('G', 8, 7.5, 4, 'Safe side — green (lower)'),
        ],
      }],
      extra: {
        prompt: 'Which side is safe to pass?',
        options: ['The side showing two green lights', 'The side showing two red lights', 'Either side, if you go slowly', 'Neither — wait until she moves'],
        correct: 0,
        explain: 'Rule 27(d): two greens in a vertical line mark the side another vessel may pass; two reds mark the obstruction (pipeline, cable, anchors).',
      },
    },
    {
      id: 'mine', answer: 'mine', level: 3,
      title: 'Engaged in mine clearance', rule: 'Rule 27(f)',
      shows: 'Three all-round green lights — one at the foremast head and one at each end of the fore yard — plus the lights of a power-driven vessel.',
      making: true, speed: 1.5, dist: [1000, 1400],
      bodies: [{
        model: 'minesweeper', z: 0,
        lights: [ar('G', 0, 23.9, 8, 'All-round green (foremast head)'), ar('G', -4.9, 21.8, 8, 'All-round green (port yardarm)'), ar('G', 4.9, 21.8, 8, 'All-round green (starboard yardarm)'), mh(0, 18, 8.3), ...sides(4.3, 9, 10), stern(4.5, -23.8)],
      }],
      extra: {
        prompt: 'How close is it dangerous to approach her?',
        options: ['Within 1,000 m', 'Within 500 m', 'Within 200 m', 'Within 50 m'],
        correct: 0,
        explain: 'Rule 27(f): the three greens mean it is dangerous for another vessel to approach within 1,000 m.',
      },
    },
    {
      id: 'hover', answer: 'hover', level: 3,
      title: 'Air-cushion vessel in non-displacement mode', rule: 'Rule 23(b)',
      shows: 'The lights of a power-driven vessel, plus an all-round flashing yellow light.',
      making: true, speed: 6, dist: [800, 1100],
      bodies: [{
        model: 'hovercraft', z: 0,
        lights: [mh(0, 7.8, 5), flash('Y', 2.2, 0, 8.9, 3, 'All-round flashing yellow'), ...sides(4.6, 4.5, 6), stern(3.2, -12)],
      }],
    },
    {
      id: 'leo', answer: 'leo', level: 3, rules: ['inland'],
      title: 'Law enforcement vessel', rule: 'Inland Rules, Annex V (33 CFR 88.11)',
      shows: 'Normal running lights plus a flashing blue light, shown while engaged in direct law enforcement or public safety activities.',
      making: true, speed: 4, dist: [450, 650],
      bodies: [{
        model: 'patrol', z: 0,
        lights: [mh(0, 4.7, -1.8), flash('B', 1.3, 0, 5.4, -1.8, 'Flashing blue light'), ...sides(1.6, 2.2, 2.4), stern(1.6, -6)],
      }],
    },
  ];

  // ---------------------------------------------------------------- light queries
  const lightColor = (l) => l.c || KINDS[l.k].c;
  const lightHz = (l) => l.hz || KINDS[l.k].hz || 0;
  function lightName(l) {
    if (l.role) return l.role;
    if (l.k === 'allround') return `All-round ${COLORS[lightColor(l)].name} light`;
    return KINDS[l.k].name;
  }
  function angDiff(a, b) {
    let d = (a - b) % 360;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    return d;
  }
  // 1 inside the arc, fading to 0 over `soft` degrees past its edge.
  function arcVis(l, beta, soft = 0.8) {
    const K = KINDS[l.k];
    if (K.half >= 180) return 1;
    const d = Math.abs(angDiff(beta, K.center));
    if (soft <= 0) return d <= K.half ? 1 : 0;
    return Math.max(0, Math.min(1, (K.half + soft - d) / soft));
  }
  const arcHard = (l, beta) => arcVis(l, beta, 0) > 0;

  function configsFor(level, rules) {
    return CONFIGS.filter((c) => c.level <= level && (!c.rules || c.rules.includes(rules)));
  }

  // ---------------------------------------------------------------- traffic mix & rated ranges
  // Rough relative frequency of each configuration on a coastal night watch (tune freely).
  const TRAFFIC = {
    'power-under50': 6, 'power-under12': 6, 'power-over50': 5,
    'sail-basic': 4, 'sail-tricolor': 3, 'sail-redgreen': 1.5,
    'anchor-small': 3, 'anchor-large': 2,
    'nuc-stopped': 0.3, 'nuc-moving': 0.3,
    'trawl-moving': 3, 'fish-moving': 3, 'fish-stopped': 1.5,
    'trawl-stopped': 1, 'trawl-large': 1.5, 'fish-gear': 1,
    'tow-short': 2.5, 'tow-long': 1.5, 'push-intl': 1.5, 'push-inland': 2,
    'ram-moving': 0.7, 'ram-stopped': 0.5, 'pilot-underway': 0.5, 'pilot-anchored': 0.3,
    'aground': 0.1, 'cbd': 0.4, 'dredge': 0.2, 'mine': 0.05, 'hover': 0.05, 'leo': 0.4,
  };
  const trafficWeight = (cfg) => (TRAFFIC[cfg.id] != null ? TRAFFIC[cfg.id] : 1);

  // Minimum luminous ranges (Rule 22), nautical miles, by vessel length in meters.
  function ratedNm(l, len) {
    if (l.k === 'masthead') return len >= 50 ? 6 : len >= 20 ? 5 : len >= 12 ? 3 : 2;
    if (l.k === 'stbd' || l.k === 'port') return len >= 50 ? 3 : len >= 12 ? 2 : 1;
    return len >= 50 ? 3 : 2; // sternlight, towing light, all-round, special
  }
  // Typical detection range as a multiple of the rated minimum; past that, lights fade fast.
  const RANGE_REACH = 2.5;
  const rangeFactor = (d, l, len) => 1 / (1 + Math.pow(d / (ratedNm(l, len) * 1852 * RANGE_REACH), 4));

  const lenCache = {};
  function bodyLength(def) {
    if (lenCache[def.model] == null) {
      let lo = Infinity, hi = -Infinity;
      for (const part of MODELS[def.model]()) for (const q of part.pts) { lo = Math.min(lo, q[2]); hi = Math.max(hi, q[2]); }
      lenCache[def.model] = hi - lo;
    }
    return lenCache[def.model];
  }
  // Rated range (m) of the weakest light you can currently see on this configuration.
  function weakestRangeM(cfg, beta) {
    let m = Infinity;
    for (const body of cfg.bodies) {
      const len = bodyLength(body);
      for (const l of body.lights) if (arcHard(l, beta)) m = Math.min(m, ratedNm(l, len) * 1852);
    }
    return m;
  }

  NW.Vessels = {
    SPILL, COLORS, KINDS, MODELS, ANSWERS, CONFIGS,
    lightColor, lightHz, lightName, arcVis, arcHard, angDiff, configsFor,
    trafficWeight, ratedNm, rangeFactor, bodyLength, weakestRangeM, RANGE_REACH,
  };
})();
