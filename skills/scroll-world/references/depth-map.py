#!/usr/bin/env python3
"""Relative depth estimation -> normalized grayscale depth map (Depth-Anything).

For each scene still, produce a single-channel depth map where WHITE = near the
camera and BLACK = far. The scroll-world shader uses this to fake a 2.5D camera
push-in: near pixels displace more than far pixels as you scroll, so the world
reads as 3D. Use ONE checkpoint + ONE normalization for every scene in a run, or
the parallax direction will flip at the seams (a visible pop).

Usage:
    python3 depth-map.py input.png output.png [--model depth-anything-large-hf] [--down N] [--invert]

    --model   HuggingFace Depth-Anything checkpoint. Default: depth-anything-large-hf
              (use -small / -base if you're on CPU and -large is too slow).
    --down N  downscale the input by 2**N before inference (depth is low-frequency;
              smaller maps are faster and look the same). Default 1 (half res).
    --invert  flip near/far, i.e. white = model's MINIMUM output instead of maximum.
              Only ever flip for the WHOLE run, never a single scene.

Dependencies:  pip install torch transformers pillow
Pairs with SKILL.md Step 4 / pipeline.md §2.
"""
import argparse
import sys

import numpy as np
from PIL import Image


def estimate(src, model, down):
    from transformers import pipeline

    img = Image.open(src).convert("RGB")
    if down and down > 0:
        w, h = img.size
        img = img.resize((max(1, w // (2 ** down)), max(1, h // (2 ** down))),
                         Image.LANCZOS)

    estimator = pipeline(task="depth-estimation", model=model)
    out = estimator(images=img)
    depth = np.asarray(out["depth"], dtype=np.float32)
    return depth


def to_grayscale(depth, invert):
    dmin, dmax = float(depth.min()), float(depth.max())
    if dmax - dmin < 1e-6:
        norm = np.zeros_like(depth, dtype=np.float32)
    else:
        norm = (depth - dmin) / (dmax - dmin)
    if invert:
        norm = 1.0 - norm
    # white = near (1.0), black = far (0.0)
    return (norm * 255.0).clip(0, 255).astype("uint8")


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("input")
    ap.add_argument("output")
    ap.add_argument("--model", default="depth-anything-large-hf")
    ap.add_argument("--down", type=int, default=1)
    ap.add_argument("--invert", action="store_true")
    args = ap.parse_args()

    try:
        depth = estimate(args.input, args.model, args.down)
    except Exception as e:  # surface a friendly message instead of a stack trace
        sys.stderr.write(
            "depth-map: failed to estimate depth for %s\n  %r\n"
            "  (need `pip install torch transformers pillow`; first run downloads the checkpoint)\n"
            % (args.input, e))
        sys.exit(1)

    gray = to_grayscale(depth, args.invert)
    Image.fromarray(gray, mode="L").save(args.output)
    print("depth", args.output, "model=%s down=%d invert=%s"
          % (args.model, args.down, args.invert))


if __name__ == "__main__":
    main()
