# C⁴ Project Page

Static project page for **Commit Locally, Exit Globally: Coordinating Adaptive Sampling and Early Exit in Diffusion Language Models**.

**Live site:** https://ming053l.github.io/c4-dllm.github.io/ · **Code:** https://github.com/ming053l/C4-dLLM · **arXiv:** https://arxiv.org/abs/2607.28166

Plain HTML/CSS/JavaScript, no build step. Layout follows the group's other project pages
([Doctor Trigger](https://ming053l.github.io/Doctor-Trigger/), [FlashReFocus](https://ming053l.github.io/FlashReFocus/),
[Spectral World Renderer](https://ming053l.github.io/Spectral-World-Renderer/)).

## Preview

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```

The replays fetch `static/traces/*.json`, so open the page through a server, not as `file://`.

## Layout

```text
index.html                # the page
static/css/site.css       # styles (palette taken from the paper's figures)
static/js/results.js      # results heatmap, component-ablation bars, lightbox, BibTeX copy
static/js/replay.js       # hero replay (C⁴ vs. full decoding) and the step-through gate lab
static/js/compare.js      # hero replay, second mode: C⁴ vs. Prophet, SlowFast, WINO on the same prompt
static/traces/*.json      # recorded decoding traces the replays play back
static/fig/*.webp         # paper figures, rasterized from the manuscript PDFs
static/video/             # promo video (+ poster)
static/pdf/paper.pdf      # public preprint
tools/compact_traces.py   # raw traces -> static/traces/{mmlu,gsm8k,humaneval}.json
tools/compact_compare.py  # paper replay recordings -> static/traces/cmp_*.json (prompts in tools/cmp_prompts.json)
```

## Where the numbers come from

- **Results section:** transcribed from the paper (Table 1 main results, Table 3 component ablation, Table 2 WINO composition).
  The paper is the source of record.
- **Replays and the gate lab:** recorded runs of LLaDA-8B-Instruct with the deployed C⁴ configuration
  (τ_CCTC 0.8, H 1, confirm on, every block; CVEE τ 0.7, γ 2.0, p_min 3) and with full decoding, on one RTX 3090.
  Tokens, confidences, commit categories, CVEE state and per-step wall time are copied from the trace; each
  instrumented run was checked to produce the same text and step count as the un-instrumented `generate_live`.
  Per-step times are those measured in the recorded run. They agree with an un-instrumented rerun within about 2%,
  except the first decode after model load (MMLU C⁴: 0.59 s untraced, warm-up included, vs 0.34 s).
  Samples (C4-dLLM `prompts.LOADERS`, code at commit a0a9551): MMLU `(n=200, seed=0, skip=40)[6]`,
  GSM8K `(n=100, seed=0, skip=40)[0]`, HumanEval `[68]` (`unique(l)`). They are single examples, not averages;
  the wall-clock ratios they show (≈12× MMLU, ≈5× GSM8K, ≈16× HumanEval) are for these prompts on a 3090, while the
  paper's speedups are task averages timed on an RTX 4090.
- **"C⁴ vs other methods" replay:** the per-method recordings made for the paper's case figures
  (C⁴, Prophet, SlowFast, WINO on the same prompts, one GPU, LLaDA-8B-Instruct): per-step argmax and committed buffer.
  Prophet is rebuilt from the full-decoding trajectory it ran on, cut at its recorded trigger step plus its one-shot
  fill. Every reconstruction was checked against the run's own recorded result (same extracted answer for MMLU #163
  and GSM8K #77; identical program text for HumanEval/68, except SlowFast, which stored only pass/fail). Only total
  wall time per run was recorded, so playback spreads it evenly over that run's steps. These three prompts are
  hand-picked showcase cases; C⁴ is not the fastest on two of them (WINO on GSM8K, SlowFast on HumanEval).
- **Promo video:** rendered frame by frame from the same `static/traces/*.json`; build scripts live outside this repo.

## Rebuilding the trace files

```bash
python3 tools/compact_traces.py RAW_TRACE_DIR PATH_TO_C4_REPO mmlu gsm8k humaneval
```

`RAW_TRACE_DIR` holds `<name>_c4.json` / `<name>_base.json` written by the trace recorder (an instrumented copy of `c4/decode.py` with read-only hooks; kept with the authors, available on request).
