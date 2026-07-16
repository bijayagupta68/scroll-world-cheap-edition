# Pipeline: copy-paste scripts (bash 3.2 safe)

Set these once. `NAMES` is the ordered section ids; the last is the hero/finale.

```bash
WORK=/tmp/scroll-world           # scratch dir for prompts, stills, depth maps
ASSETS=./assets                  # where the site reads stills (webp) + depth maps (png)
mkdir -p "$WORK" "$ASSETS"
NAMES="farm kitchen shop delivery plaza finale"   # <-- your section ids, in order
```

There are **no videos** in this skill anymore — no Higgsfield calls, no ffmpeg encode, no
connectors. The whole run is: generate N stills → estimate a depth map for each → (optional)
knock out backgrounds → point the engine at `still` + `depth` pairs. Every step is
local/bash-3.2-safe.

## 1. Scene stills (Step 2)

Write one prompt file per section to `$WORK/still_<name>.txt` (see prompts.md), then
generate. **Codex `image_gen`** (preferred, subscription-billed, zero credits) when the CLI
is present:

```bash
gen_still() { # name
  codex exec -C "$WORK" -s workspace-write --skip-git-repo-check \
    'Use the image generation tool ($imagegen) to generate: '"$(cat "$WORK/still_$1.txt")"' Wide 3:2 landscape, high resolution. Save it as ./still_'"$1"'.png. Do not do anything else.' \
    > "$WORK/still_$1.codex.log" 2>&1
  [ -f "$WORK/still_$1.png" ] && echo "still $1 ok" || echo "still $1 FAIL (see .codex.log)"
}
for n in $NAMES; do gen_still "$n" & done ; wait
```

**No Codex CLI?** Have the user drop stills at `$WORK/still_<name>.png` (any generator) and
skip the loop. Either way, convert to webp for the site (and optionally run `knockout.py`
first for transparency):

```bash
for n in $NAMES; do cwebp -quiet -q 84 -resize 1800 0 "$WORK/still_$n.png" -o "$ASSETS/$n.webp"; done
```

Review the stills for cohesion **and** for clear near/far structure before continuing
(re-roll any off-style or depth-ambiguous one).

## 2. Depth maps — the per-still pass (Step 4)

This is the step that used to be "generate connector clips." For every still, estimate a
relative depth map and save it as a normalized grayscale PNG (white = near, black = far),
one checkpoint + one normalization for all N (so the parallax direction never flips at a
seam). `references/depth-map.py` wraps Depth-Anything:

```bash
# one checkpoint for every scene — do NOT mix models across the run
for n in $NAMES; do
  python3 depth-map.py "$WORK/still_$n.png" "$ASSETS/depth_$n.png" \
    --model depth-anything-large-hf --down 2
done
```

- `--down 2` halves the map resolution (depth is low-frequency; smaller maps scrub cheaper
  and look identical). Drop it for full-res if you want crisper edges.
- Output is forced to grayscale and normalized to the 0–255 range with **near = white**. If
  you ever swap the convention, you must swap it for *all* scenes or you'll get seam pops.
- Smoke test on one still first (`python3 depth-map.py still_farm.png /tmp/d.png`) to
  confirm the model downloads and the map looks sane before batching.

If you'd rather not depend on `transformers`/`torch`, any depth endpoint works as long as
it emits a normalized grayscale map with the same near/far convention — just save it to
`$ASSETS/depth_<name>.png` and skip the loop above.

## 3. (Optional) Float the scenes — knockout (Step 3)

If you want the dioramas to float over the atmosphere, knock out the flat background to
transparency (border-connected flood fill — preserves interior colour that matches the bg).
The engine composites the still's alpha over the sky, so transparent areas show through.

```bash
python3 knockout.py "$WORK"/still_*.png      # writes still_*.rgba.png
# re-encode the knocked-out stills to webp *with* alpha:
for n in $NAMES; do cwebp -quiet -q 84 -alpha_q 95 -resize 1800 0 "$WORK/still_$n.rgba.png" -o "$ASSETS/$n.webp"; done
```

Keep the depth maps opaque (they have no alpha — depth is a single channel); only the still
gets transparency.

## 4. Wire it up (Step 5)

Now the engine config's `sections[k]` takes a **`still` + `depth` pair** — no `clip`,
`connectors`, or mobile variants:

```js
sections: [
  { id:'farm', label:'The Farms', still:'assets/farm.webp',  depth:'assets/depth_farm.png',  accent:'#8FB98A', … },
  { id:'kitchen', label:'The Kitchen', still:'assets/kitchen.webp', depth:'assets/depth_kitchen.png', … },
  // …one per section; last may carry a `cta`
]
```

The engine loads each `still`/`depth` as a WebGL texture (lazy, near the active scroll),
depth-displaces a full-screen quad by scroll progress, and crossfades between consecutive
scenes across a fixed seam band. See `scrub-engine.js` for the full config + CSS vars and
`index-template.html` for a minimal standalone page.

## Notes

- **No credits, no encode.** There are no Higgsfield calls and no ffmpeg step — the camera
  move is computed live in the shader from the depth maps, so this whole run costs nothing
  but a little local CPU for depth estimation.
- **One depth convention, one checkpoint.** Mixed near/far conventions (or mixing
  `depth-anything-small` with `-large`) flip the parallax direction and produce seam pops;
  keep the `depth-map.py` invocation identical for all N.
- **Depth is the seam.** The crossfade at a seam is continuous only if scene *i+1*'s depth
  pose matches across the boundary — which it does by construction (same convention, same
  `focal`). If a seam reads as a hard cut, widen the engine's `crossfade` (default ~0.14
  vh) before re-estimating depth.
- Concurrency: launching ~5–6 Codex gens at once is fine; much more can trip rate limits —
  stagger or re-run the individual failure. Depth estimation is a one-off per still and
  cheap enough to run inline.
- If a whole batch stalls, check `$WORK/*.codex.log` for the reason.
