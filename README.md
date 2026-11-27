# Night Watch — navigation lights trainer

A vessel bobs on a dark sea, far off, seen through binoculars. Name what she is from her
lights, then say which way she's heading. Light configurations follow the U.S. Coast Guard
Navigation Rules (International / COLREGS and Inland Rules).

## Run it

Either:

- **Double-click `index.html`** — it runs straight from the file, no install, or
- `npm start` → open <http://localhost:5180> (a tiny dependency-free Node server).

## Playing

| Key | Action |
| --- | --- |
| `1`–`4` | Answer |
| `Enter` / `Space` / `→` | Next question / next vessel |
| `+` / `−` or scroll | Binocular zoom |
| `G` | Light guide |

The **Inland · Basics** chip (top right) switches between Inland and International rules,
picks the deck (Basics → + Working vessels → Everything), sets the moonlight and the sea
state (glassy calm → heavy; controls the waves and how much everything bobs), and resets
your score. Score and settings are saved in your browser.

**Distance:** *Near* keeps vessels within ~1.2 nm. *Horizon* puts them hull-down past your
horizon (eye 3 m up, horizon ≈ 3.6 nm): the earth's curve hides the hull and the swell
swallows the lowest lights now and then — a sidelight may blink out while she rolls.
*Mixed* (default) does that about a third of the time.

**Fog:** Clear, Haze (9 km), Fog (2.5 km), Thick (900 m). Lights dim and bloom, the
horizon and stars disappear, and vessels are kept close enough to see.

**Points:** each correct answer scores its base value (identify 100, heading 50,
follow-up 50) × (1 + range in nautical miles, capped at 6). A vessel 1.2 nm off pays ×2.2. The current
multiplier is shown at the top of the quiz card.

Each vessel gets 1–3 questions:

1. **What is she?** Wrong answers are chosen so none of them could show the same lights
   from *any* angle — if a picture is truly ambiguous (a lone white light could be an
   anchored boat *or* a vessel seen from astern), the reveal says so.
2. **Which way is she heading?** (vessels making way) — read from her sidelights,
   sternlight, and range lights.
3. Sometimes a **follow-up** (e.g. may you pass between a tug and her tow?).

After the last question the moon comes out so you can see her silhouette, and you get the
rule number, the lights she carries (dimmed if hidden from your angle), and a top-down
diagram of her light arcs with your position.

## What's in the catalog

Power-driven (under 12 m, under 50 m, 50 m+), sailing (sidelights, tricolor, red-over-green),
at anchor, not under command, trawling, fishing (incl. gear >150 m), towing astern
(≤200 m and >200 m), pushing ahead (International and Inland variants, incl. the Inland
special flashing light), restricted in ability to maneuver, pilot vessels, aground,
constrained by draft (International only), dredging with an obstruction, mine clearance,
hovercraft, and law enforcement flashing blue (Inland).

Arcs: masthead 225°, sidelights 112.5° each (with the 1–3° cut-off past dead ahead),
sternlight and towing light 135°, all-round 360°.

## How it's built

Plain HTML/CSS/JS, no build step, no dependencies.

- `js/vessels.js` — the light catalog: positions in 3D, arcs, rules text, silhouettes.
- `js/quiz.js` — picks a vessel and viewing angle, checks for lookalikes, writes questions.
- `js/sea.js` — WebGL shader: night sky, stars, clouds, animated waves on a curved sea
  (real horizon dip), and glitter paths reflecting each light.
- `js/scene.js` — vessel motion on the swell, your own boat's motion, binocular framing,
  silhouettes, and light glows.
- `js/ui.js` — quiz card, settings, guide, and the arc diagram.

*A study aid — always defer to the official Navigation Rules handbook.*
