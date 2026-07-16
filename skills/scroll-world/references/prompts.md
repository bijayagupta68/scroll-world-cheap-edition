# Prompt templates & intake

Everything here is fill-in-the-slots. Keep the **style preamble** byte-for-byte identical
across all scene stills — that identical text is what makes the world feel like one place.

> **No video prompts anymore.** This skill generates stills + depth maps and synthesizes
> the camera move in a WebGL shader — there are no `dive`, `leg`, or `connector` clips to
> prompt. The only prompt you write is the scene still (below); the depth map is computed
> automatically by `depth-map.py`.

## Intake checklist (Step 1)

Collect and write down:

- `SUBJECT` — the business + one-line pitch.
- `BRAND_NAME` — display name.
- `PALETTE` — 4–6 named hexes, e.g. `taro #9B7EBD, cream #F5EDE0, caramel #C88A5A, matcha #8FB98A, plum #3A2E48`. Pick ONE as the scene **background** colour (usually the lightest) and one as the primary **accent**.
- `TONE` — a word or two (cozy/premium, playful, industrial…).
- `STYLE` — the art direction (default below).
- `SECTIONS[]` — ordered list; for each: `id`, `label`, `subject` (what's in the diorama), `eyebrow`, `title`, `body` (≤ 1 sentence), `tags[]` (0–3). Last section = hero product + CTA.
- `STILLS_SOURCE` — `codex` (`image_gen`, subscription-billed; only offer when the Codex CLI is present) | `provided` (user supplies stills). No Higgsfield CLI required.
- `DEPTH_MODEL` — the Depth-Anything checkpoint for Step 4 (default `depth-anything-large-hf`; use `-small`/`-base` on CPU). Keep it identical for every scene.

## Style preamble (default: clay diorama)

Reuse verbatim in every scene prompt. Swap the bracketed bits for the brand's palette/bg.

```
Isometric low-poly 3D diorama floating as a small rounded island on a plain solid
[BG_HEX] background with a soft contact shadow beneath it. Soft matte clay 3D render,
rounded toy-model shapes, gentle warm studio lighting, soft long shadows, tilt-shift
miniature look. Cohesive color palette of [PALETTE]. Highly detailed, centered
composition, absolutely no text, no letters, no numbers, no logos.
```

Alternate directions (swap the first two sentences, keep the palette/no-text tail):
- **Flat papercraft:** "Isometric layered paper-craft diorama, matte cardstock, clean die-cut edges, subtle drop shadows between layers."
- **Glossy toy:** "Isometric glossy vinyl-toy diorama, smooth plastic shading, soft rim light, collectible figurine look."
- **Claymation:** "Isometric stop-motion clay set, visible thumbprints, handmade plasticine texture, soft studio softbox light."
- **Neon night:** "Isometric miniature at night, warm interior glow and neon signage, moody rim light, wet reflective ground."
- **Photoreal architectural** (real estate, hospitality, premium/luxury): "Ultra-photorealistic architectural photography of a single cohesive [subject], cinematic wide-angle, warm golden-hour light, natural materials, restrained designer furnishings, a breathtaking view, editorial magazine quality (Architectural Digest), shallow depth of field, no people." For photoreal, drop the floating-island framing and the knockout (Step 3) — the scenes are **full-bleed** (a dark page background reads premium), and cohesion comes entirely from the identical preamble.

## Scene still prompt (Step 2)

```
[STYLE PREAMBLE]
Subject: [SECTION.subject — describe the miniature scene: the building/space, a few
characters doing the work, the props that signal this stage of the business].
```

Tips:
- Name concrete props (they anchor the scene): tanks, cauldrons, conveyor, crates, awning, string lights, benches, scooters, map pins.
- For the final "hero product" section, drop the diorama-island framing and prompt a
  single oversized product centerpiece floating on the same background with a few small
  orbiting props.
- **Compose for the centre.** The engine renders every still `object-fit:cover` and pivots
  the parallax on each scene's `focal` (default centre). Keep the focal subject horizontally
  centred with a little headroom, and don't park anything essential at the far left/right
  edges. A centred composition also gives the depth model a clean, unambiguous near/far
  axis.
- **Give it real depth.** The still is the only input to depth estimation, so pick
  compositions with obvious foreground props and a receding background. A single flat plane
  (logo-on-a-void) has nothing for the parallax to grab and will look static.
- Aspect `3:2`, high resolution (Codex `image_gen` lands at 1536×1024, exactly 3:2).

## Depth map (Step 4 — automatic, no prompt)

You don't write a prompt for depth; `references/depth-map.py` estimates it from the still.
Two things to get right so the seams don't pop:

- **One checkpoint + one normalization for all N** (near = white, far = black). Don't mix
  `-large` with `-small`, and don't flip `--invert` on a single scene.
- **Keep the focal subject nearer than its surroundings** so the parallax has something to
  push. This is decided by the still, not the prompt — just compose with clear
  foreground/background separation (above).

`pipeline.md` §2 has the one-line batch loop. If a scene's map looks mushy, re-run with
`--model depth-anything-large-hf` (or without `--down`) — small checkpoints smear edges.

## Copy per section (for the engine config)

- `eyebrow` — 2–4 words, uppercase feel (a value-prop label).
- `title` — 3–6 words, the beat's headline. First section = the site's hero line; last =
  the payoff + it carries the CTA.
- `body` — one sentence, plain-spoken, from the visitor's side.
- `tags` — 0–3 short proof chips (e.g. "Fresh-cooked", "30-min delivery").
