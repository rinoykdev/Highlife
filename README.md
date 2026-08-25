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


Balance input is analog and smoothed. **It drives your arms, not your body** —
see below. You cannot step while holding a steady breath.

Turning on the line is removed for now. Reaching the far anchor instead ends
the run as a completed crossing.

---

## How the game works

### Balance — arms first, body second (`js/physics.js` → `BalanceModel`)

A highliner does not balance with their torso. They balance with their arms,
and the torso follows. So your touch does **not** torque the body. It drives an
*arm* state with its own inertia, and the body only ever feels the arms:

```
touch ──► arms swing (spring-damped, ~0.25 s)
             ├── static:  where the arms ARE moves the centre of mass
             └── dynamic: how fast they SWING kicks back the other way
```

Measured in the test suite: **hands reach full reach at 0.26 s, the body only
begins to move at 0.40 s.** That two-stage lag is the feel of the game.

It also gives failure a physical cause. At full stretch you have simply run out
of arm — `atLimit` rises, the elbows lock straight, and nothing more is coming.

Tuning this took four passes and the failures are worth recording:

- The reflex that reaches for the high side had the **wrong sign** at first, so
  the walker's own instinct fed the fall. Everyone died in 4 s.
- A full arm swing produced roughly **four times gravity's torque**. Combined
  with the arm's own lag the loop overshot, and player input performed *worse
  than no input at all* across the entire parameter grid. Body damping, not
  gain, was the fix.
- The dynamic reaction term at its physically honest strength briefly
  **overpowered the weight shift**: pressing right moved you left for ~0.2 s.
  Correct physics, unplayable controls. It is now a flavour term.

Resulting curve, against simulated players of varying reaction time:

| Player | Outcome |
|---|---|
| No input at all | falls in ~8 s |
| Expert, 160 ms reaction | 109 m, rarely falls |
| Average, 260 ms | ~92 m |
| Sloppy, 340 ms | ~46 m |

Point of no return: about **0.7** of full lean.

### The landscape (`js/environment.js`)

One ridged-multifractal heightfield carries everything: the gorge the line
crosses, the ledges it is bolted to, and the ranges out to the horizon. Colour
comes from altitude and slope — snow settles on high flat ground, cliff faces
stay bare — which is most of why it reads as rock rather than shaded polygons.

Two details do the heavy lifting:

- **A warped grid.** A uniform 5 km plane spends all its vertices on empty
  distance and renders the 150 m gorge in four cells. Vertex spacing follows
  `|u|^2.5` instead, giving ~8 m cells at the line and ~200 m at the horizon
  from one seamless mesh — 40 cells across the gorge, no LOD popping.
- **Kilometre-scale massing.** Ramping peak height over a few hundred metres
  put 400 m summits 400 m away: a 42° wall across the whole view. Peaks now
  build over ~3 km, and the anchors sit near the top of the massif so most of
  the horizon falls away below eye level.

The camera is deliberately yawed ~24° off the line's axis. Looking straight
down the webbing puts the backlit far anchor dead centre as a black slab;
swung round, the gorge opens along the frame instead. It is how highline
photographs are composed and it costs nothing.

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
│   ├── environment.js    heightfield terrain, forests, cloud sea, sky
│   ├── input.js          touch zones, swipes, keyboard
│   ├── ui.js             screens, HUD, menus
│   ├── audio.js          synthesised wind and effects (no audio files)
│   ├── storage.js        versioned local save
│   └── content.js        locations, challenges, tricks  ← tune here first
├── lib/
│   ├── three.module.min.js       Three.js r160, bundled for offline use
│   ├── GLTFLoader.js             for the optional rigged walker
│   ├── BufferGeometryUtils.js    GLTFLoader dependency
│   └── THREE-LICENSE.txt
├── icons/                app icons (192, 512, maskable, apple-touch)
└── assets/               location card artwork
```

`content.js` is the designer-facing file: line length, sag, wind, altitude,
palette, sun angle and fog for each location live there, along with the
challenge and trick lists.

---

## Performance

The scene costs about **66 draw calls and 57,000 triangles**. Every
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
are labelled "Coming soon" rather than shipping as dead buttons. Only `Sit` is
implemented; the 180 turn is shelved and the rest are declared future work.

**A new challenge:** add it to `CHALLENGES` with a `type`, then handle that
type in `Game._trackObjectives`.

---

## Optional: a real human walker

The built-in walker is assembled from primitives. It is animated carefully —
the arms are driven by the actual balance state, so what you see is literally
what is generating the correcting torque — but primitives will never read as a
photographic person. **That needs a rigged model, and a rigged model has to be
downloaded.**

To use one:

1. Get a rigged humanoid in glTF binary format. Good free sources:
   - **Mixamo** (mixamo.com, free Adobe account) — pick any character, choose
     *T-Pose*, download **FBX**, then convert to `.glb` with Blender
     (`File ▸ Import ▸ FBX`, then `File ▸ Export ▸ glTF 2.0`).
   - **Ready Player Me** (readyplayer.me) — exports `.glb` directly, already
     humanoid-rigged. Simplest route.
   - **Quaternius** or **Kenney** low-poly character packs (CC0).
2. Rename it `walker.glb` and put it in `assets/`.
3. Add `'./assets/walker.glb'` to the `PRECACHE` list in `service-worker.js`
   so it still works offline, and bump `CACHE_VERSION`.

That is all. On the next load the game detects the file, scales it to 1.75 m,
matches its skeleton and drives the bones from the same balance state. With no
file present the procedural walker is used and nothing changes.

Keep it under ~3 MB and around 15–30 k triangles for phones. Bone names are
matched loosely and `mixamorig:` prefixes are stripped, so Mixamo and Ready
Player Me rigs both work; an unusual skeleton falls back to whole-body lean,
which still looks considerably better than primitives.

**Note:** with no `walker.glb` present the browser console logs one harmless
404 from the probe for it. That is expected.

## Known limitations

- The walker is procedural unless you add `assets/walker.glb` — see above.
- Only `Sit` is a functional trick. The 180 turn is removed for now; the trick
  screen shows the rest explicitly marked as future features.
- The five locations share one procedural terrain generator, re-seeded and
  re-skinned. They differ in colour, light, fog, peak height, gorge depth, tree
  line, line length, sag and wind — but not in silhouette vocabulary.
- Terrain generates on the main thread at load (~0.3–0.8 s on a phone), which
  is why there is a loading screen. Moving it to a worker is the obvious next
  step.

---

Three.js is bundled under the MIT licence; see `lib/THREE-LICENSE.txt`.
