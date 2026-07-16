---
name: scroll-world
description: >-
  Build an immersive scroll-scrubbed "fly through the world" landing page for any
  industry or brand using AI-generated scene stills + a per-still depth map and a
  portable WebGL parallax shader. As the visitor scrolls, a depth-driven 2.5D camera
  pushes from outside each scene into its interior, then crossfades to the next scene
  with NO cuts — one continuous connected flight (Emons-style isometric diorama world,
  or any art direction you pick). The skill interviews the user for the topic, the
  story beats/sections, and brand kit, then generates cohesive stills + depth maps and
  wires a framework-agnostic scroll-scrub engine. Use when the user wants a "3D world" /
  "browse-through-the-industry" hero, a scroll cinematic, a diorama landing, or to turn
  a business into a scrollable world. No video generation or Higgsfield CLI required.
allowed-tools: Bash, Read, Write, Edit, AskUserQuestion, Skill
---

# scroll-world

Produces a landing page where **scroll drives a depth-based camera**: a 2.5D parallax
shader displaces each scene's plane using its depth map as you scroll, pushing the
camera from a wide "outside" view into the scene's interior, then crossfading to the
next scene — with no visible cuts. The visuals are AI-generated **stills + depth maps**;
the camera motion is computed live in a WebGL shader from a single scroll-progress value.
This is the same technique family behind Apple's scroll-through product pages — the
camera genuinely moves, scroll only drives time — but instead of scrubbing pre-rendered
video, we synthesize the camera move at runtime from depth.

**What you generate:** N scene stills → N depth maps (one per still) → a portable WebGL
scrub engine that plays the whole chain as one flight.

**The one rule that makes or breaks it:** seams must crossfade cleanly. Read
[The seamless chain](#step-6--the-seamless-chain-the-critical-part) before wiring any
scene. Getting this wrong is the single most common failure and produces a visible
"pop" between scenes.

Do not assume a frontend framework. The scrub engine in `references/scrub-engine.js` is
self-contained vanilla JS + WebGL (it builds its own DOM + injects its own CSS into a
container you give it), so it drops into plain HTML, Next.js, Vue, a Python-served page,
anything. The value of this skill is the image + depth pipeline, the prompts, and the
seam method — not the framework.

---

## Step 0 — Bootstrap

1. **Depth-estimation dependency.** The camera move is synthesized from a depth map per
   still, so you need a relative-depth model. Recommended: **Depth-Anything** via
   `transformers` (or the standalone `depth-anything` package), or any metric/relative
   depth estimator that emits a grayscale map. Install once:
   `pip install torch transformers` (or the Depth-Anything package) and fetch a
   checkpoint (e.g. `depth-anything-large-hf` for best edges). Confirm with a smoke test
   on one still (pipeline.md §2). Python ≥ 3.10.
   - No GPU? CPU inference works (slow but fine — the N stills you already have are the
     only inputs, and depth is a one-off per still). Or use a hosted depth endpoint if
     the user has one.
2. **An image tool.** Pillow (`python3 -c "import PIL"`) — used by `knockout.py` and the
   depth script's I/O. Optional unless you float the scenes.
3. **A still generator (no Higgsfield CLI required).** This skill no longer needs the
   Higgsfield CLI or any auth. Prefer the **Codex CLI** (`codex`, ≥ 0.125) `image_gen`
   when it's on `$PATH` — billed to the user's ChatGPT subscription, zero credits (Step
   2). Otherwise just ask the user to drop N stills into a folder (any generator) and
   proceed. ffmpeg is **not** needed — there are no videos to encode.
4. Caveats: macOS ships **bash 3.2** (no `declare -A`); don't use associative arrays in
   scripts. Depth estimation runs locally and is the only heavy step; stills generate in
   seconds.

---

## Step 1 — Interview the user

The **subject is the user's to state — ask it as an open question in plain prose**, never a
fabricated multiple-choice. A made-up list of industries biases them and reads as you
deciding their business for them; let them answer in their own words (their real business,
a client's, or any idea). Reserve structured multiple-choice (`AskUserQuestion` in Claude
Code; a plain either/or question elsewhere) for the genuinely enumerable, lower-stakes
choices below — art direction and brand-kit approach — and even there, signal they can go
their own way ("Other"). Ask only what you can't sensibly default. Cover:

1. **Subject** (ask openly, not multiple-choice) — "What should this world be about? Your
   business, a client's, or any idea — a word or a sentence is fine." Capture the
   industry/product + a one-line pitch (e.g. "a bubble tea company, from leaf to last
   sip"), and a brand name if they have one; otherwise you'll propose one below.
2. **Brand kit** — offer three paths, pick one:
   - Import from a URL: `higgsfield marketing-studio brand-kits fetch --url <site> --wait`
     (pulls name, colours, tone). Then read it back with `brand-kits list --json`.
     (This marketing-studio fetch is the only Higgsfield touch and is optional — skip it
     if the CLI isn't installed; the user can just hand you the palette.)
   - The user hands you palette + name + tone directly.
   - You propose a palette + name and let them approve.
   Capture **4–6 named hex values**, a display name, and a tone word or two.
3. **Art direction** — default is "soft matte low-poly **clay diorama**, isometric,
   tilt-shift miniature, warm light." Offer alternatives (flat papercraft, glossy toy,
   claymation, neon night, photoreal architectural). Whatever is chosen becomes the
   shared **style preamble** reused verbatim in every scene prompt (this is what makes the
   world cohesive). Note for depth: isometric/miniature art reads *best* — it has crisp,
   unambiguous near/far structure that the depth model and the parallax shader both love.
   Very flat, single-plane art (a logo on a void) gives the parallax nothing to grab.
4. **The journey (sections)** — the ordered scenes the camera flies through. Propose a
   set derived from the subject's own value chain and let the user edit. 5–7 works well.
   Boba example: farms → pearl kitchen → flagship shop → delivery → community plaza →
   the hero product. Each section needs: a short subject description (what's IN the
   diorama), an eyebrow, a headline, one line of body, and 0–3 tag pills. The last
   section is usually the hero product + the CTA.
5. **Mobile — NOT a separate render.** Unlike the old video pipeline, the depth shader is
   fully responsive: one set of stills + depth drives every viewport, and the engine just
   dials the parallax strength down on phones. So there's no credit/version decision here
   — just confirm the page should be phone-friendly (it always is) and move on.

Keep the scroll mechanic fixed (continuous push-in + crossfade) — that's the point of the
skill. See `references/prompts.md` for the intake checklist and copy structure.

---

## Step 2 — Generate the scene stills

One image per section, **all sharing the same style preamble** for cohesion. The stills are
**both** the hero visual **and** the input to depth estimation, so they must be rich in
real near/far structure (an isometric diorama is ideal; avoid logo-on-a-void).

Prompt shape (full templates in `references/prompts.md`):

```
<STYLE PREAMBLE, identical every time>. On a plain solid <bg> background with a soft
contact shadow. <PALETTE hexes>. No text, no letters, no logos, centered, 3:2.
Subject: <what is in THIS diorama>.
```

- **Codex stills (preferred, subscription-billed, zero credits)** when `codex` is on
  `$PATH`. Same prompt files, same byte-identical preamble, generated by Codex's built-in
  `image_gen`:

  ```bash
  codex exec -C "$WORK" -s workspace-write --skip-git-repo-check \
    'Use the image generation tool ($imagegen) to generate: '"$(cat "$WORK/still_$n.txt")"' Wide 3:2 landscape, high resolution. Save it as ./still_'"$n"'.png. Do not do anything else.'
  ```

  Single-quote the `$imagegen` segment (the shell must not expand it); ~1–3 min per image;
  run a few in parallel, not all N at once. Output lands at 1536×1024 (3:2) — perfect for
  depth estimation and posters.
- **No Codex CLI?** Ask the user to provide N stills (any generator — Midjourney, a design
  tool, etc.) and place them at `assets/<name>.png` (or webp). Everything downstream is
  unchanged.
- A generation may fail transiently — re-roll that one individually; don't restart.
- **Review the stills before continuing.** They must read as one cohesive world (same
  angle, palette, light) and each must have clear foreground/background separation. If one
  is off-style or depth-ambiguous, regenerate it.

The stills double as **posters and lazy-load fallbacks**, so keep them.

---

## Step 3 — (Optional) Float the scenes

If you want the dioramas to float over an atmospheric background instead of sitting in a
solid box, knock out the flat background to transparency with `references/knockout.py`
(border-connected flood fill — preserves interior colour that matches the bg, e.g. cream
walls). The scrub engine composites the still over the sky, so transparent areas show the
atmosphere behind. If you'd rather keep it simple, just make the page background the same
colour as the scene background and skip this.

---

## Step 4 — Depth map per still (this replaces the old "connectors")

For every still, run depth estimation → a **normalized grayscale depth map** (see
`references/pipeline.md` §2 / `references/depth-map.py`). Convention used by the engine:

- **white (1.0) = near** the camera, **black (0.0) = far**. The shader pushes near pixels
  more than far pixels, so the world feels 3D as you scroll.
- Output resolution: match the still (or downscale to ~50% — depth is low-frequency and
  smaller maps scrub cheaper). Saved as `assets/depth_<name>.png`.
- **One checkpoint, one normalization, for all N.** The parallax direction at a seam is
  decided by the depth convention; if scene A is near=white and scene B near=black the
  motion would flip and you'd get the seam pop. Keep it identical everywhere.

This step *is* the old "connector" work: it's what lets the shader fake the camera dive and
blend one scene into the next. There are no video clips to generate or encode anymore.

Tips for clean depth:
- Prefer `depth-anything-large` — small checkpoints smear edges and the parallax looks
  mushy.
- Keep the focal subject **centred and clearly nearer** than its surroundings; the shader
  pivots the parallax on each scene's `focal` (default centre) so a centred hero stays put
  while the world slides around it.
- Avoid scenes that are a single flat plane (no depth to parallax) — pick compositions
  with obvious foreground props and a receding background.

---

## Step 5 — Assemble the page

Copy `references/scrub-engine.js` (and, if you want a fully standalone page, the
`references/index-template.html`) into the user's project — or adapt into their framework.
It's config-driven and self-contained:

```js
mountScrollWorld(document.getElementById('world'), {
  brand: { name: 'Pearl & Co.' },
  scrollPer: 1.3,            // viewport-heights of scroll per scene
  depth: 0.06,               // parallax strength (fraction of frame)
  zoom: 0.18,                // how far the camera pushes in across a scene
  sections: [
    { id:'farm', label:'The Farms',
      still:'assets/farm.webp', depth:'assets/depth_farm.png',
      focal:[0.5, 0.42],     // where the camera dives toward (UV, y from top) — optional
      scroll: 1.6, linger: 0.45,   // optional pacing: longer dwell + camera settles mid-scene
      accent:'#8FB98A', eyebrow:'From leaf to last sip', title:'It starts in the hills.',
      body:'…', tags:['Single-origin','Hand-picked'] },
    // …one per section; last may carry a `cta`
  ],
});
```

Each section takes a **`still` (image) + `depth` (grayscale map)** pair — there is no
`clip`, `connectors`, or mobile-variant concept anymore. The engine:

- Loads each still + depth as WebGL textures (lazy, near the active scroll position).
- Renders a full-screen quad whose fragment shader displaces the still by its depth map,
  driven by the scene's scroll progress (a push-in zoom + depth parallax around `focal`).
- **Crossfades** to the next scene across a fixed seam band (Step 6) — that's the "no cut."
- Handles the pinned per-section copy (first section greets on landing, last holds its
  CTA), a route rail, `prefers-reduced-motion` (falls back to the stills, no shader), and
  responsive phones (lighter parallax, no extra assets).

**Pacing per section:** `scroll` overrides `scrollPer` for that scene (more scroll = longer
dwell) and `linger` (0–1, keep ≤ 0.6) remaps progress so the camera settles mid-scene —
exactly while the copy peaks — then speeds up toward the seam; seam progress is untouched
(f(0)=0, f(1)=1). Give the hero and finale scenes a higher `scroll` + some `linger`; keep
transit scenes brisk. Theme it with CSS variables (`--accent`, `--sw-bg`, `--sw-ink`, …) —
the visual identity comes from the generated stills, so the chrome stays quiet. See the
header of `scrub-engine.js` for the full config + CSS vars.

For non-JS backends (Python/Rails/etc.): serve the assets and drop the engine `<script>`
into the rendered HTML; nothing about it is framework-specific.

---

## Step 6 — The seamless chain (the critical part)

Because there are no rendered clips, a "seam" is now a **crossfade between two
depth-driven scenes**. The rule that prevents a pop:

> At a seam, scene *i* is at its deep "inside" pose (`progress = 1`) and scene *i+1* is at
> its wide "outside" pose (`progress = 0`); the engine crossfades between them over a fixed
> band. The pose of *i+1* is identical on both sides of the seam (wide → wide), so the
> hand-off is continuous — the only thing changing is which scene is on top.

To make that hold in practice:

- **Keep the depth convention identical** across all scenes (near = white). Mixed
  conventions flip the parallax direction and you'll see the world "snap" the other way at
  the seam. (This is the depth-map equivalent of the old "frame-matched connector
  endpoints" rule.)
- **Keep `focal` consistent** (default centre is fine for every scene). A scene whose focal
  jumps to a corner makes the crossfade pivot around a different point and reads as a cut.
- **One parallax direction.** The shader always pushes *in* (zoom grows with progress),
  never pulls back, so motion never reverses across a seam — same as the old architecture-A
  rule, now enforced by the engine for free.

You mostly get this for free; the thing to actually check is depth consistency (Step 4) and
centred composition. The engine's crossfade band (`crossfade`, default ~0.14 viewport-
heights) is the only knob — widen it if a particular pair of scenes still reads as a hard
cut.

---

## Step 7 — QA the seams (don't skip)

Drive the page in a headless browser and **verify the crossfades are smooth**, which is the
thing most likely to be wrong:

- Screenshot at scroll positions just before and just after each seam. The two frames must
  be near-identical (scene *i+1*'s wide pose on both sides of the boundary). If they pop,
  the depth convention differs between the two scenes (redo Step 4 with one checkpoint) or
  `focal` jumped.
- Check the console for WebGL errors, confirm the canvas paints (textures loaded — watch
  the network tab for the `still`/`depth` fetches), and that the parallax tracks scroll
  across each scene's band.
- **Mobile** — load a phone viewport once: page loads, still posters show until textures
  arrive, nothing overlaps, parallax is present but lighter. The engine handles this with
  no config; just sanity-check it doesn't break.
- Check reduced-motion (should fall back to the stills, no shader, no parallax).

---

## Gotchas (hard-won)

- **Seam pop / world snaps the other way** → the two scenes' depth maps use different
  near/far conventions, or one was estimated with a different checkpoint. Re-estimate all N
  with the same `depth-map.py` invocation (one checkpoint, one normalization). Also keep
  `focal` consistent.
- **Scene looks flat / no parallax** → the still is a single depth plane (logo-on-a-void) or
  the depth checkpoint smeared edges. Use `depth-anything-large` and pick compositions with
  clear foreground/background. The shader can't invent depth that isn't in the map.
- **Edges sample outside the image (streaking at frame borders)** → keep `depth` modest
  (≤ ~0.08) and let the engine's `zoom` cover the parallax travel; textures are
  `CLAMP_TO_EDGE` so it stretches the border pixel rather than wrapping, but a big parallax
  offset still reveals it. Lower `depth` if you see it.
- **Parallax feels reversed when scrolling up** → that's expected and fine; the shader is
  symmetric, so scrolling up simply flies back out. No fix needed.
- **White-box scenes** → still generators often return a solid bg; either match the page bg
  to it or knock it out (Step 3). With the shader, a solid bg just means the background
  pixels share one depth value — fine.
- **Floating scenes show a hard rectangle** → you knocked out the still but not (or
  inconsistently) the depth map, or the depth map's transparent areas aren't handled. The
  engine composites the still's alpha over the sky, so make sure the still's transparency is
  clean (knockout.py) and the depth map is opaque (it should be — depth has no alpha).
- **bash 3.2** on macOS → no associative arrays in scripts.
- **Depth estimation is slow / OOM** → run CPU at reduced resolution (the script downscales
  by default) or process one still at a time; you only need it once per still.
- **Codex `image_gen` prompt placement** → the prompt goes BEFORE any `-i` flag (it's
  variadic); single-quote `$imagegen` so the shell doesn't expand it.

## References

- `references/prompts.md` — the intake checklist, style-preamble pattern, and the scene-
  still prompt template with fill-in slots (video/connector templates removed — there are
  no videos anymore).
- `references/pipeline.md` — copy-paste batch scripts for the run (generate stills →
  estimate depth per still → optional knockout), bash-3.2-safe.
- `references/scrub-engine.js` — the portable, config-driven WebGL parallax engine (builds
  DOM + injects CSS; loads still+depth textures, depth-displaces a full-screen quad by
  scroll progress, crossfades between scenes at the seam, copy, route rail, reduced-motion,
  and phone hardening).
- `references/index-template.html` — a minimal standalone page that mounts the engine with
  still + depth-map pairs.
- `references/depth-map.py` — relative-depth estimation (Depth-Anything) → normalized
  grayscale depth map per still.
- `references/knockout.py` — border-connected background knockout for floating scenes
  (unchanged).
