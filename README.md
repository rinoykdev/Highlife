# Highline — Find Your Balance

A calm, skill-based highline walking game that runs entirely in the browser and
installs to an iPhone home screen as a PWA. No backend, no accounts, no build
step, no npm. Copy the folder to GitHub Pages and it works.

**The loop:** stand → balance → step → the line reacts → recover → step again.
You will fall. That is the point.

---

## Deploy to GitHub Pages

1. Create a repository and upload every file in this folder, keeping the
   directory structure exactly as it is.
2. **Settings → Pages → Build and deployment → Source: Deploy from a branch**,
   choose `main` and `/ (root)`.
3. Open `https://<user>.github.io/<repo>/`.

Every path in the project is relative, so the game works from a subfolder
without configuration. On iPhone, open it in Safari and tap
**Share → Add to Home Screen** to install it; after the first load it runs
offline.

To test locally you need a real HTTP server, because the game uses ES modules
(`file://` will not work):

```bash
cd highline-pwa
python3 -m http.server 8000
# then open http://localhost:8000
```

---

## Controls

| Action | Touch | Keyboard |
|---|---|---|
| Balance | Hold the left or right half of the screen. The further out you press, the harder you lean. | `A` / `D` or `←` / `→` |
| Steady breath | Hold both sides at once, or the ◉ button | `Space` or `Shift` |
| Step forward | Swipe up | `W` or `↑` |
| Sit | Swipe down | `S` or `↓` |
| 180 turn | Double tap, or the ↺ button | `Q` |

Balance input is analog and smoothed — it behaves like shifting your weight,
not like flipping a switch. You cannot step while holding a steady breath.

---

## How the game works

### Balance (`js/physics.js` → `BalanceModel`)

`tilt` runs from −1 (falling left) through 0 (centred) to +1 (falling right).
Each frame:

```
acc = destabilising − passive correction + tremor + player input + wind + line − damping
```

The shape of that equation is the whole game:

- **Below ~0.35** the passive term slightly exceeds the destabilising term, so
  the body self-centres. You are never truly still, though — a tremor term
  keeps nudging you.
- **Around 0.6** the destabilising term wins and you must actively work.
- **Past ~0.85** maximum player input (4.48) is *less than* the destabilising
  torque (5.05). The fall is unrecoverable. There is a genuine point of no
  return, not a scripted animation.

Measured against simulated players of varying reaction time:

| Player | Outcome |
|---|---|
| No input at all | falls in 8.7 s |
| Expert, 160 ms reaction | ~1 fall per 30 runs |
| Average, 260 ms | falls around 37 m |
| Sloppy, 340 ms | falls around 24 m |

### The webbing (`js/physics.js` → `LinePhysics`)

48 nodes, fixed at both ends, integrating the 1-D wave equation on both the
lateral and vertical axes. Gravity produces the sag for free, so the resting
curve is emergent rather than drawn. The walker applies a continuous load at
their position, and each footstep injects an impulse that travels along the
line and reflects off the anchors.

Integration is semi-implicit Euler with a symmetric stencil, sub-stepped four
times per frame. (An earlier version read already-updated neighbour positions
within the same pass and diverged to 10²⁹ within two seconds — the two-pass
split is load-bearing, not stylistic.)

### Frame rate independence

Physics runs at a fixed 1/50 s step with an accumulator, capped at five steps
per frame. A stiff balance model integrated with a variable `dt` feels
different on different phones; this keeps a 30 fps device and a 120 fps device
playing the same game.

### Wind (`js/physics.js` → `Wind`)

Layered value noise for continuous turbulence, plus a gust scheduler with a
`calm → warning → gust → fade` cycle. Gusts announce themselves about 1.6 s
early: the wind badge turns amber, a directional flash appears at the screen
edges, the clouds accelerate, and the audio filter opens. The wind is
learnable rather than random punishment.

### Falling

Losing balance detaches the walker, who tumbles under gravity until the leash
goes tight at 4.2 m, then swings as a damped pendulum around the anchor point
while the catch yanks the line. After the swing settles you get a result card.
Each fall costs one focus mark; three ends the session.

---

## Project structure

```
highline-pwa/
├── index.html            all screens, HUD and overlays
├── styles.css            dark glass interface
├── manifest.json         PWA manifest
├── service-worker.js     offline precache (bump CACHE_VERSION per deploy)
├── README.md
├── js/
│   ├── main.js           bootstrap, wiring, lifecycle
│   ├── game.js           engine, camera, run/fall state machine
│   ├── physics.js        balance, webbing, wind  (no Three.js — unit testable)
│   ├── character.js      procedurally animated walker rig
│   ├── environment.js    sky shader, cliffs, ridges, clouds, birds
│   ├── input.js          touch zones, swipes, keyboard
│   ├── ui.js             screens, HUD, menus
│   ├── audio.js          synthesised wind and effects (no audio files)
│   ├── storage.js        versioned local save
│   └── content.js        locations, challenges, tricks  ← tune here first
├── lib/
│   ├── three.module.min.js   Three.js r160, bundled for offline use
│   └── THREE-LICENSE.txt
├── icons/                app icons (192, 512, maskable, apple-touch)
└── assets/               location card artwork
```

`content.js` is the designer-facing file: line length, sag, wind, altitude,
palette, sun angle and fog for each location live there, along with the
challenge and trick lists.

---

## Performance

The scene costs **25 draw calls, ~3,300 triangles and 2 textures**. Every
mountain, cloud and texture is generated at runtime, so nothing but the five
location cards and the icons ships as an image.

Choices that keep it cheap on a phone:

- No shadow maps. There is no surface below the walker to receive one, so they
  would cost frame time for nothing. Depth comes from fog, the cloud sea and a
  rim light instead.
- `MeshLambertMaterial` throughout, with vertex colours rather than textures.
- Distant ranges are flat two-triangle-per-span silhouettes with pre-blended
  haze colours and `fog: false`.
- Device pixel ratio capped per quality setting (1.0 / 1.6 / 2.0).

If it ever runs hot, drop **Settings → Graphics** to Low: fewer clouds, birds
and spires, and a 1× pixel ratio.

---

## Save data

One versioned LocalStorage key, `highline.save`:

```js
{ version: 1, player: {…}, locations: {…}, challenges: {…}, settings: {…} }
```

Missing keys are back-filled from defaults on load, so adding fields in a later
release will not wipe anyone's progress. Writes are debounced by 220 ms and
flushed immediately on `pagehide` and `visibilitychange`. A run is banked when
you fall, restart, *or* simply leave the line — walking 200 m and quitting
still counts.

---

## Extending it

**A new location:** add an entry to `LOCATIONS` in `content.js` and drop a card
image in `assets/`. All five are fully playable — the environment is procedural,
so nothing else is needed. Add an unlock rule to `UNLOCK_RULES`.

**A new trick:** add it to `TRICKS`, give it a pose method in `character.js`
following `_poseSit`, and a trigger in `game.js`. Tricks with `ready: false`
are labelled "Coming soon" in the UI rather than shipping as dead buttons.
`Sit` and `180 turn` are implemented; the other five are declared future work.

**A new challenge:** add it to `CHALLENGES` with a `type`, then handle that
type in `Game._trackObjectives`.

---

## Known limitations

- Only `Sit` and `180 turn` are functional tricks. The rest are visible in the
  trick screen but explicitly marked as future features.
- The five locations share one procedural environment generator, re-skinned per
  palette. They differ in colour, light, fog, line length, sag and wind, but not
  in silhouette vocabulary.
- Reaching an anchor turns the walker around automatically so distance can keep
  accumulating on a finite line.

---

Three.js is bundled under the MIT licence; see `lib/THREE-LICENSE.txt`.
