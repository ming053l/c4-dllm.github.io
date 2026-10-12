"""Compact recorded C4 decoding traces into the small JSON files the page replays.

Input: per-run trace JSON written by record_traces.py (one file per run: <name>_c4.json, <name>_base.json).
Output: static/traces/<name>.json holding both runs of the same prompt.

Nothing is synthesized: tokens, confidences, commit categories, CVEE state and per-step wall time are copied
from the trace. Two derived fields are added, both computed from logged data:
  - committed tokens are frozen at the value they had in the step that committed them;
  - for the full-decoding run, the answer the repo's extractor (c4.extract.extract_answer) reads from that
    step's provisional text, and the step after which it never changes again ("settle").

Usage: python tools/compact_traces.py TRACE_DIR C4_REPO name [name ...]
"""
import json
import sys
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "static" / "traces"
CATS = {"schedule": "s", "cctc_core": "k", "cctc_confirmed": "f", "cctc_escalation": "k",
        "cctc_last_step_flush": "k", "exit_fill": "x"}


def q(c):
    """confidence -> one char, 0..9 (floor of 10*c, 1.0 -> 9)."""
    return str(min(9, int(c * 10)))


def compact(run, extract=None, task=None):
    steps = run["steps"]
    vocab = {int(k): v["text"] for k, v in run["vocab"].items()}
    used = set()
    out, prev = [], None
    for s in steps:
        tok = s["tok"]
        if prev is None:
            t = tok
        else:
            t = {i: x for i, x in enumerate(tok) if x != prev[i]}
        prev = tok
        used.update(tok)
        c = {}
        for k, v in s["commits"].items():
            if v and k in CATS:
                c.setdefault(CATS[k], []).extend(v)
        if s["commits"].get("deferred"):
            c["d"] = s["commits"]["deferred"]
        e = {"b": s["block"], "w": s["wall_ms"], "t": t, "q": "".join(q(x) for x in s["conf"]), "c": c}
        v = s.get("cvee")
        if v:
            e["v"] = [v["ans"], v["conf"], v["run"], v["need"], v["changes"], v["fired"], v["span"]]
        if extract is not None:
            e["a"] = extract(task, s["text_preview"])
        out.append(e)
    settle = None
    if extract is not None:
        final = out[-1]["a"]
        settle = len(out)
        for i in range(len(out) - 1, -1, -1):
            if out[i]["a"] != final:
                break
            settle = i + 1
    m, r = run["meta"], run["result"]
    return {
        "arm": m["arm"], "steps": r["steps_used"], "budget": r["steps_budget"],
        # traced wall time: the untraced mmlu_c4 run absorbed first-decode warm-up (0.59 vs 0.34 s)
        "wall_s": r["wall_s_traced"], "correct": r["correct"], "pred": r["pred"],
        "block_steps": r["block_steps"], "settle": settle,
        "vocab": {i: vocab[i] for i in sorted(used) if i in vocab}, "steps_log": out,
    }


def main():
    tdir, repo = Path(sys.argv[1]), sys.argv[2]
    import importlib.util  # load extract.py by path: the package __init__ pulls in torch
    spec = importlib.util.spec_from_file_location("c4_extract", Path(repo) / "c4" / "extract.py")
    mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
    extract_answer = mod.extract_answer
    OUT.mkdir(parents=True, exist_ok=True)
    for name in sys.argv[3:]:
        c4 = json.load(open(tdir / f"{name}_c4.json"))
        base = json.load(open(tdir / f"{name}_base.json"))
        m = c4["meta"]
        assert m["prompt_text"] == base["meta"]["prompt_text"], name
        doc = {
            "task": m["task"], "model": m["model"], "sample": m["sample_def"], "prompt": m["prompt_text"],
            "gt": m["gt"], "gen_length": m["gen_length"], "block_length": m["block_length"],
            "num_blocks": m["num_blocks"], "commit": m["c4_commit"], "config": m["config"],
            "c4": compact(c4),
            # code answers are whole programs, graded by execution: no per-step answer to read
            "base": compact(base, None if m["task"] in ("humaneval", "mbpp") else extract_answer, m["task"]),
        }
        p = OUT / f"{name}.json"
        p.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")))
        print(p.name, f"{p.stat().st_size / 1024:.0f} kB", "c4", doc["c4"]["steps"], "base", doc["base"]["steps"],
              "base settles at", doc["base"]["settle"])


if __name__ == "__main__":
    main()
