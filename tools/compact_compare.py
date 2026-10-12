"""Build static/traces/cmp_<task>.json: the same prompt decoded by C4, Prophet, SlowFast and WINO.

Source: the paper's per-method replay recordings (sequence_replays/final/shared_<task>_idx<k>/), all run on one
machine with LLaDA-8B-Instruct. Per step they store the argmax prediction (x0), its confidence and the committed
buffer (filled; mask id where still masked). Prophet runs ordinary decoding and, at its trigger step, fills every
remaining position from that step's prediction; its replay is rebuilt from the full-decoding trajectory it was run
on (prophet_baseline_traj_*.pt) cut at the recorded trigger step, plus that one-shot fill.
Each reconstructed final output is checked against the prediction the run itself recorded.
Only total wall time per run is recorded, so playback spreads it evenly over that run's steps.

Prompt texts (not stored in the recordings) come from tools/cmp_prompts.json, recovered from the C4-dLLM dataset loaders
by matching each recording's answer and decoded text (MMLU test #163, GSM8K test #77, HumanEval/68).
Usage (an env with torch + transformers): python tools/compact_compare.py SRC_DIR TOKENIZER_DIR C4_REPO task:idx ...
"""
import glob
import json
import sys
from pathlib import Path

import torch
from transformers import AutoTokenizer

MASK = 126336
OUT = Path(__file__).resolve().parent.parent / "static" / "traces"


def states_from_traj(filled):
    """filled: (steps, L) committed buffer per step -> list of per-step diffs {pos: token or -1 (mask)}."""
    out, prev = [], None
    for row in filled.tolist():
        if prev is None:
            out.append({i: (-1 if t == MASK else t) for i, t in enumerate(row) if t != MASK})
        else:
            out.append({i: (-1 if t == MASK else t) for i, (t, p) in enumerate(zip(row, prev)) if t != p})
        prev = row
    return out, prev


def prophet_states(base, trigger, L, plen):
    """Full-decoding trajectory up to `trigger` steps, then one-shot fill from that step's prediction."""
    x0s = base["x0_history"]                 # per block: (steps_in_block, plen + L) predictions
    idxs = base["true_indices_history"]      # per block: per step, positions committed that step
    buf = [MASK] * L
    out, step = [], 0
    for b, (xb, ib) in enumerate(zip(x0s, idxs)):
        for s in range(xb.shape[0]):
            step += 1
            pred = xb[s].tolist()
            diff = {}
            for p in ib[s].reshape(-1, 2)[:, 1].tolist() if ib[s].ndim == 2 else ib[s].tolist():
                g = p - plen
                if 0 <= g < L and buf[g] == MASK:
                    buf[g] = pred[p]; diff[g] = pred[p]
            if step == trigger:
                for g in range(L):
                    if buf[g] == MASK:
                        buf[g] = pred[plen + g]; diff[g] = pred[plen + g]
                out.append(diff)
                return out, buf
            out.append(diff)
    return out, buf


def main():
    src, tokdir, repo = Path(sys.argv[1]), sys.argv[2], sys.argv[3]
    tok = AutoTokenizer.from_pretrained(tokdir, trust_remote_code=True, local_files_only=True)
    sys.path.insert(0, repo)
    from c4.extract import extract_answer
    prompts = json.load(open(Path(__file__).with_name("cmp_prompts.json")))
    OUT.mkdir(parents=True, exist_ok=True)
    for spec in sys.argv[4:]:
        task, idx = spec.split(":")
        d = src / f"shared_{task}_idx{idx}"
        runs, used = {}, set()
        for m in ("c4", "slowfast", "wino"):
            js = json.load(open(d / f"{m}_{task}_idx{idx}.json"))
            tr = torch.load(d / f"{m}_{task}_idx{idx}_traj.pt", map_location="cpu", weights_only=False)["examples"][0]
            diffs, final = states_from_traj(tr["filled"])
            if m == "slowfast":
                r = js["results"][0]; steps, wall, ok, pred = r["model_calls"], r["wall_s"], r["correct"], r.get("pred")
            else:
                r = js["per_example"][0]; steps, wall, ok, pred = r["nfe"], r["wall_s"], r["correct"], r.get("pred")
            runs[m] = {"steps": steps, "wall_s": round(wall, 3), "correct": ok, "log": diffs, "final": final, "pred": pred}
        pj = json.load(open(d / f"prophet_{task}_idx{idx}.json"))
        base = torch.load(glob.glob(str(d / "prophet_baseline_traj_question_*.pt"))[0], map_location="cpu", weights_only=False)
        L, plen = base["gen_length"], base["prompt_token_len"]
        trig = pj["per_example"][0]["nfe"]
        diffs, final = prophet_states(base, trig, L, plen)
        runs["prophet"] = {"steps": trig, "wall_s": round(pj["metrics"]["avg_wall_seconds"], 3),
                           "correct": pj["per_example"][0]["correct"], "log": diffs, "final": final,
                           "pred": pj["per_example"][0].get("pred")}
        # checks: reconstructed final output vs. the run's own recorded prediction
        for m, r in runs.items():
            txt = tok.decode([t for t in r["final"] if t != MASK], skip_special_tokens=True)
            if task in ("humaneval", "mbpp"):
                check = "recon==pred:" + str(bool(r["pred"]) and txt.strip()[:300] == r["pred"].strip()[:300]) if r["pred"] else "(no text stored)"
            else:
                check = f"extract(recon)={extract_answer(task, txt)!r} recorded={r['pred']!r}"
            print(f"{task}:{idx} {m:8s} steps={r['steps']:3d} logged={len(r['log']):3d} wall={r['wall_s']:.2f}s ok={r['correct']} {check}")
            for diff in r["log"]:
                used.update(t for t in diff.values() if t >= 0)
        vocab = {i: tok.decode([i]) for i in sorted(used)}
        prompt = prompts[task]
        doc = {"task": task, "sample": f"{task} idx {idx} (paper replay set)", "gen_length": L,
               "block_length": base["block_length"], "prompt": prompt, "vocab": vocab,
               "runs": {m: {k: v for k, v in r.items() if k not in ("final", "pred")} for m, r in runs.items()}}
        p = OUT / f"cmp_{task}.json"
        p.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")))
        print(" ->", p.name, f"{p.stat().st_size / 1024:.0f} kB")


if __name__ == "__main__":
    main()
