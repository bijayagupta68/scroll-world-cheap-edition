# scroll-world


https://github.com/user-attachments/assets/b08e641e-985b-4bd4-83ff-6750272d0c37


An agent skill — for Claude Code, Codex, and any `SKILL.md`-compatible agent — that
builds an immersive, **scroll-scrubbed "fly through the world" landing page** for any industry or brand — the kind where, as you scroll, a camera flies
from *outside* each scene *into* its interior, then flows on to the next scene with **no
cuts**. One continuous connected flight through a little generated world (think the Emons
logistics site, applied to whatever you want).

## Install

### Claude Code — as a plugin (recommended)

```
/plugin marketplace add oso95/scroll-world
/plugin install scroll-world@scroll-world
```

Then just ask for a scroll-through world landing page, or invoke `/scroll-world`.

### Codex & other agents — via the skills CLI

Using [Vercel's skills CLI](https://github.com/vercel-labs/skills), which installs into
Codex, Claude Code, Cursor, and 20+ other agents:

```bash
npx skills add oso95/scroll-world            # pick your agent(s) when prompted
npx skills add oso95/scroll-world -a codex   # or target Codex directly
```

In Codex, invoke it with `$scroll-world` (or `/skills` to browse), or just ask for a
scroll-through world landing page.

### Manually (drop-in skill)

Copy the skill folder into your agent's skills directory:

```bash
git clone https://github.com/oso95/scroll-world
cp -R scroll-world/skills/scroll-world ~/.claude/skills/   # Claude Code
cp -R scroll-world/skills/scroll-world ~/.codex/skills/    # Codex
```

## Requirements

- **A depth-estimation model** — [Depth-Anything](https://github.com/LiheYoung/Depth-Anything)
  via `pip install torch transformers` (or the standalone package), fetching a checkpoint
  such as `depth-anything-large-hf`. This is what turns each still into a depth map; the
  camera move is synthesized from those maps in the browser, so there are **no videos and
  no credits**.
- **Python 3 with Pillow** — for the optional transparent-scene knockout (`knockout.py`).
- An **image generator for the stills** (no Higgsfield CLI required). The skill prefers the
  [Codex CLI](https://github.com/openai/codex) `image_gen` (billed to a ChatGPT
  subscription, zero credits) when present; otherwise you just drop your own stills into a
  folder. `ffmpeg` is not needed.

## What it does

It leans on AI for the art: cohesive isometric diorama **stills** (generated via the
[Codex CLI](https://github.com/openai/codex) `image_gen` on a ChatGPT subscription, or any
image tool you like), and a **depth map per still** (Depth-Anything). The camera flight
itself is synthesized live in the browser: a WebGL shader displaces each still by its depth
map as you scroll, pushing the camera from outside the scene into its interior, then
crossfading to the next — the same technique family behind Apple's scroll-through product
pages. The camera genuinely moves; scroll only drives time. It's **framework-agnostic**: you
get the stills + depth pipeline, the prompt templates, and a portable vanilla-JS/WebGL scrub
engine that drops into plain HTML, Next.js, Vue, or a Python-served page — nothing assumes a
stack.

When invoked, the skill:

1. **Interviews you** — the subject/industry + pitch, a brand kit (import from a URL, hand
   it over, or have it proposed), art direction, the ordered scenes the camera visits,
   whether you want the **mobile version** (a second chain rendered natively in 9:16
   portrait — composed for phones, not a crop of the landscape film), and the **budget** —
   render tiers and stills source shown with estimated credit costs, approved before
   anything generates.
2. **Generates the assets** — one still per scene, then a **depth map per still**
   (Depth-Anything). The depth maps are what let the shader fake the camera dive and
   blend one scene into the next, so every seam crossfades cleanly. No video is generated
   or encoded — the camera move is computed at runtime from depth.
3. **Wires it up** — a config-driven scroll engine that plays the whole chain as one
   flight, serving the portrait clips and posters automatically on phones.

## What's in the skill

```
skills/scroll-world/
├── SKILL.md                    the procedure + the seam rule + gotchas
└── references/
    ├── prompts.md              intake checklist + the scene-still prompt template
    ├── pipeline.md             copy-paste batch scripts (generate stills → estimate depth per still → optional knockout)
    ├── scrub-engine.js         portable, config-driven WebGL parallax engine (loads still+depth, depth-displaces a quad by scroll, seam crossfade)
    ├── index-template.html     a minimal standalone page that mounts the engine
    ├── depth-map.py            relative-depth estimation (Depth-Anything) → normalized depth map
    └── knockout.py             background knockout for floating scenes (unchanged)
```

## Notes

- There are **no credits and no video**. The only compute is local depth estimation
  (Depth-Anything, once per still) plus the live shader in the browser — the skill costs
  nothing to run beyond a little CPU for depth maps.
- The generated `still`/`depth` asset pairs are produced per project; they're not shipped
  here.

## Star History

<a href="https://www.star-history.com/?type=date&repos=oso95%2Fscroll-world">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=oso95/scroll-world&type=date&theme=dark&legend=top-left&sealed_token=rsHNX9eWfbhlu820oC1dzsc66Y8UZI4dawuHvAUlbn36F0gwOWXRDi-Qq4QFopkoEJE7bzgXPUkAmSnmMcglxAo_rM7TvGDKFehk5MzprmeT2euDRbHnTQZIxEWwjjpGQ3nodpdblW6WjTssURtDxXO2MCVL_WgJ_WnCIoVbV8qhsB_Z-Eeo8KCyVerC" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=oso95/scroll-world&type=date&legend=top-left&sealed_token=rsHNX9eWfbhlu820oC1dzsc66Y8UZI4dawuHvAUlbn36F0gwOWXRDi-Qq4QFopkoEJE7bzgXPUkAmSnmMcglxAo_rM7TvGDKFehk5MzprmeT2euDRbHnTQZIxEWwjjpGQ3nodpdblW6WjTssURtDxXO2MCVL_WgJ_WnCIoVbV8qhsB_Z-Eeo8KCyVerC" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=oso95/scroll-world&type=date&legend=top-left&sealed_token=rsHNX9eWfbhlu820oC1dzsc66Y8UZI4dawuHvAUlbn36F0gwOWXRDi-Qq4QFopkoEJE7bzgXPUkAmSnmMcglxAo_rM7TvGDKFehk5MzprmeT2euDRbHnTQZIxEWwjjpGQ3nodpdblW6WjTssURtDxXO2MCVL_WgJ_WnCIoVbV8qhsB_Z-Eeo8KCyVerC" />
 </picture>
</a>

## License

MIT — see [LICENSE](LICENSE).
