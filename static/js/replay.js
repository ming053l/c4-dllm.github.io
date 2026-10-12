// Replays recorded LLaDA decoding traces (static/traces/*.json, built by tools/compact_traces.py).
// Every token, confidence, commit category and CVEE value shown here is read from the trace.
(function () {
  const TRACES = [
    { id: "mmlu", label: "Short answer · MMLU", speed: 1 },
    { id: "gsm8k", label: "Reasoning · GSM8K", speed: 4 },
    { id: "humaneval", label: "Code · HumanEval", speed: 4, optional: true },
  ];
  const SPEEDS = [1, 4, 16];
  const cache = {};
  const load = (id) => cache[id] || (cache[id] = fetch(`static/traces/${id}.json`).then(r => {
    if (!r.ok) throw new Error(id); return r.json();
  }).then(prep));

  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const SPECIAL = /^<\|.*\|>$/;

  // Expand the per-step diffs into per-step frames: argmax tokens, committed tokens (frozen at commit), etc.
  function prep(doc) {
    for (const arm of ["c4", "base"]) {
      const run = doc[arm], L = doc.gen_length;
      const tok = new Array(L).fill(0), frozen = new Array(L).fill(null);
      let t = 0;
      run.frames = run.steps_log.map((s) => {
        if (Array.isArray(s.t)) s.t.forEach((x, i) => { tok[i] = x; });
        else for (const k in s.t) tok[+k] = s.t[k];
        const cat = {};
        for (const [c, ps] of Object.entries(s.c)) {
          if (c === "d") continue;
          ps.forEach(p => { if (frozen[p] === null) frozen[p] = tok[p]; cat[p] = c; });
        }
        t += s.w;
        return { tok: tok.slice(), frozen: frozen.slice(), cat, def: new Set(s.c.d || []), q: s.q, b: s.b, v: s.v, a: s.a, t };
      });
      // traced per-step times, rescaled to the un-instrumented wall time of the same run
      const k = run.wall_s * 1000 / t;
      run.frames.forEach(f => { f.t *= k; });
    }
    return doc;
  }

  // answers longer than a short value (programs) are shown by size, not inline
  const short = (a) => {
    if (a === null || a === undefined) return "—";
    a = String(a);
    return a.length <= 14 ? a : `program, ${a.split("\n").length} lines`;
  };

  const piece = (doc, arm, id) => {
    const s = doc[arm].vocab[id];
    return s === undefined ? "?" : s;
  };

  // ---------------------------------------------------------------- render one panel's text
  function body(doc, arm, f, opts = {}) {
    const L = doc.gen_length, out = [];
    let lastReal = L - 1;
    // hide trailing end-of-text tokens once committed, so the panel shows the answer, not padding
    while (lastReal > 0 && f.frozen[lastReal] !== null && SPECIAL.test(piece(doc, arm, f.frozen[lastReal]))) lastReal--;
    const span = f.v && f.v[6] && f.v[6][1] - f.v[6][0] <= 12 ? f.v[6] : null;
    for (let i = 0; i <= Math.min(L - 1, lastReal + 1); i++) {
      const fz = f.frozen[i];
      if (fz === null) {
        const cls = f.def.has(i) ? "tk m def" : "tk m";
        out.push(`<span class="${cls}" data-i="${i}"></span>`);
        continue;
      }
      let s = piece(doc, arm, fz);
      if (SPECIAL.test(s)) { s = ""; }
      const c = f.cat[i];
      let cls = "tk";
      if (opts.fresh && c) cls += c === "f" ? " conf" : c === "x" ? " fill" : " new";
      if (span && i >= span[0] && i < span[1]) cls += " ans";
      out.push(`<span class="${cls}" data-i="${i}">${esc(s)}</span>`);
    }
    return out.join("");
  }

  // ---------------------------------------------------------------- hero replay
  const root = document.getElementById("replay");
  if (root) {
    root.innerHTML = `
      <div class="rp-head">
        <div class="rp-tabs" role="tablist"></div>
        <div class="rp-ctl">
          <button class="rp-btn" data-act="play" type="button">Play</button>
          <button class="rp-btn" data-act="speed" type="button" aria-label="Playback speed">1×</button>
          <span class="rp-speed" aria-live="polite"></span>
        </div>
      </div>
      <div class="rp-prompt"></div>
      <div class="rp-panels">
        ${["c4", "base"].map(a => `
        <div class="rp-panel ${a}">
          <div class="rp-bar"><span class="rp-name">${a === "c4" ? "C⁴" : "Full decoding"}</span><span class="rp-meta"></span></div>
          <div class="rp-prog"><span></span></div>
          <div class="rp-body"></div>
          <div class="rp-foot"></div>
        </div>`).join("")}
      </div>
      <div class="rp-legend">
        <span><i style="background:#e6e9ee"></i>still masked</span>
        <span><i style="background:var(--gold-soft);box-shadow:inset 0 -2px 0 var(--gold)"></i>committed this step</span>
        <span><i style="background:#dde9f6;box-shadow:inset 0 -2px 0 var(--blue)"></i>deferred, then confirmed</span>
        <span><i style="background:#e9f3ee;box-shadow:inset 0 -2px 0 var(--green)"></i>filled at exit</span>
        <span><i style="outline:1.5px solid var(--blue)"></i>answer span read by CVEE</span>
      </div>`;
    const tabs = root.querySelector(".rp-tabs");
    const P = {}; ["c4", "base"].forEach(a => {
      const el = root.querySelector(`.rp-panel.${a}`);
      P[a] = { meta: el.querySelector(".rp-meta"), prog: el.querySelector(".rp-prog span"), body: el.querySelector(".rp-body"), foot: el.querySelector(".rp-foot"), last: -2 };
    });
    const btnPlay = root.querySelector('[data-act="play"]'), btnSpeed = root.querySelector('[data-act="speed"]');
    let doc = null, cur = null, speed = 1, clock = 0, playing = false, raf = 0, prevTs = 0, holdUntil = 0;

    const idxAt = (run, ms) => {
      const fr = run.frames; let i = -1;
      while (i + 1 < fr.length && fr[i + 1].t <= ms) i++;
      return i;
    };
    function draw(force) {
      for (const a of ["c4", "base"]) {
        const run = doc[a], p = P[a], i = idxAt(run, clock);
        const done = i === run.frames.length - 1;
        const tms = Math.min(clock, run.wall_s * 1000);
        p.meta.innerHTML = `step <b>${Math.max(0, i + 1)}</b> / ${run.budget} · <b>${(tms / 1000).toFixed(2)}</b> s`;
        p.prog.style.width = `${100 * Math.max(0, i + 1) / run.budget}%`;
        if (i === p.last && !force) continue;
        p.last = i;
        if (i < 0) {
          p.body.innerHTML = body(doc, a, { frozen: new Array(doc.gen_length).fill(null), def: new Set(), cat: {} });
          p.foot.innerHTML = `<span>waiting for the first step</span>`;
          continue;
        }
        const f = run.frames[i];
        p.body.innerHTML = body(doc, a, f, { fresh: true });
        const act = p.body.querySelector(".tk.new, .tk.conf, .tk.fill") || p.body.querySelector(".tk.m");
        if (act) p.body.scrollTop = Math.max(0, act.offsetTop - p.body.offsetTop - 60);
        p.foot.innerHTML = foot(a, run, f, done);
      }
    }
    function foot(a, run, f, done) {
      const pv = run.pred === null || run.pred === undefined ? "" : ` (${esc(String(run.pred))})`;
      const ok = run.correct ? `<span class="badge ok">✓ ${doc.task === "humaneval" ? "passes tests" : "correct"}${pv}</span>` : `<span class="badge no">✗ wrong${pv}</span>`;
      if (a === "c4") {
        const v = f.v || [];
        const fired = v[5];
        if (done) {
          const why = fired ? "CVEE exit" : "every block completed";
          return `<span>${why} after <b>${run.steps}</b> of ${run.budget} steps</span>${ok}`;
        }
        const ans = esc(short(v[0]));
        const conf = v[1] === null || v[1] === undefined ? "not readable yet" : v[1].toFixed(2);
        return `<span class="rp-ans">answer ${ans}</span><span>conf ${conf} · run ${v[2]}/${v[3]}</span>`;
      }
      if (run.settle === null) return done ? `<span>ran all ${run.budget} steps</span>${ok}` : `<span>runs every scheduled step</span>`;
      if (done) return `<span>answer final since step <b>${run.settle}</b>; ran all ${run.budget}</span>${ok}`;
      const ans = f.a === null || f.a === undefined || f.a === "" ? "—" : esc(String(f.a));
      return `<span class="rp-ans">answer ${ans}</span><span>${run.settle && run.frames.indexOf(f) + 1 >= run.settle ? "already final" : "still changing"}</span>`;
    }
    function tick(ts) {
      if (!playing) return;
      const dt = prevTs ? ts - prevTs : 0; prevTs = ts;
      const end = Math.max(doc.c4.wall_s, doc.base.wall_s) * 1000;
      if (holdUntil) {
        if (ts >= holdUntil) { holdUntil = 0; clock = 0; P.c4.last = P.base.last = -2; }
      } else {
        clock += dt * speed;
        if (clock >= end) { clock = end; holdUntil = ts + 2600; }
      }
      draw(false);
      raf = requestAnimationFrame(tick);
    }
    function setPlaying(on) {
      playing = on; btnPlay.textContent = on ? "Pause" : "Play"; prevTs = 0;
      cancelAnimationFrame(raf); if (on) raf = requestAnimationFrame(tick);
    }
    function setSpeed(s) { speed = s; btnSpeed.textContent = `${s}×`; root.querySelector(".rp-speed").textContent = s === 1 ? "real time (RTX 3090)" : `${s}× real time`; }
    async function pick(t) {
      cur = t;
      tabs.querySelectorAll("button").forEach(b => b.setAttribute("aria-selected", b.dataset.id === t.id));
      doc = await load(t.id);
      root.querySelector(".rp-prompt").innerHTML = `<b>Prompt.</b> ${esc(doc.prompt).replace(/\n/g, "<br>")}`;
      clock = 0; holdUntil = 0; P.c4.last = P.base.last = -2;
      setSpeed(t.speed); draw(true);
    }
    // only show tabs whose trace file exists
    Promise.all(TRACES.map(t => load(t.id).then(() => t, () => null))).then(ok => {
      const avail = ok.filter(Boolean);
      tabs.innerHTML = avail.map(t => `<button class="rp-tab" role="tab" type="button" data-id="${t.id}">${t.label}</button>`).join("");
      tabs.querySelectorAll("button").forEach(b => b.addEventListener("click", () => pick(avail.find(t => t.id === b.dataset.id)).then(() => setPlaying(true))));
      pick(avail[0]).then(() => {
        const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (!reduce && "IntersectionObserver" in window) {
          const io = new IntersectionObserver(es => { es.forEach(e => { if (e.isIntersecting && !playing && clock === 0) setPlaying(true); }); }, { threshold: 0.35 });
          io.observe(root);
        }
      });
      initLab(avail);
    });
    btnPlay.addEventListener("click", () => setPlaying(!playing));
    btnSpeed.addEventListener("click", () => setSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]));
    document.addEventListener("visibilitychange", () => { if (document.hidden && playing) setPlaying(false); });
  }

  // ---------------------------------------------------------------- gate lab (scrub through the C4 run)
  function initLab(avail) {
    const lab = document.getElementById("lab");
    if (!lab || !avail.length) return;
    lab.innerHTML = `
      <div class="lab-top"><div class="rp-tabs" role="tablist"></div><span class="rp-meta lab-pos"></span></div>
      <div class="lab-grid">
        <div>
          <div class="blocks"></div>
          <div class="lab-tokens"></div>
          <div class="lab-scrub">
            <button class="rp-btn" type="button" data-d="-1" aria-label="Previous step">←</button>
            <input type="range" min="1" value="1" aria-label="Decoding step">
            <button class="rp-btn" type="button" data-d="1" aria-label="Next step">→</button>
          </div>
          <div class="lab-step"></div>
        </div>
        <div class="lab-side">
          <div class="gcard g-ans"><div class="gk">Answer read this step</div><div class="gv"></div><div class="hist"></div></div>
          <div class="gcard g-conf"><div class="gk">Confidence c<sub>t</sub> ≥ 0.7</div><div class="meter"><span></span><i style="left:70%"></i></div><div class="gs"></div></div>
          <div class="gcard g-run"><div class="gk">Unchanged steps ≥ required</div><div class="pips"></div><div class="gs"></div></div>
          <div class="gcard dec"><div class="gk">Decision</div><div class="gv"></div><div class="gs"></div></div>
        </div>
      </div>`;
    const tabs = lab.querySelector(".rp-tabs"), range = lab.querySelector("input");
    let doc = null, i = 0;
    tabs.innerHTML = avail.map(t => `<button class="rp-tab" role="tab" type="button" data-id="${t.id}">${t.label.split(" · ")[1]}</button>`).join("");
    const show = () => {
      const run = doc.c4, f = run.frames[i], v = f.v || [null, null, 0, 3, 0, false, null];
      const last = i === run.frames.length - 1;
      lab.querySelector(".lab-pos").innerHTML = `C⁴ step <b>${i + 1}</b> of ${run.steps} · block ${f.b + 1} of ${doc.num_blocks}`;
      range.value = i + 1;
      // block progress
      const B = doc.block_length;
      lab.querySelector(".blocks").innerHTML = Array.from({ length: doc.num_blocks }, (_, b) => {
        let n = 0; for (let p = b * B; p < (b + 1) * B; p++) if (f.frozen[p] !== null) n++;
        return `<div class="blk${b === f.b ? " active" : ""}" title="block ${b + 1}: ${n}/${B} committed"><span style="width:${100 * n / B}%"></span></div>`;
      }).join("");
      // tokens: the whole output; at masked positions of the active block, the current argmax (faint, shaded by confidence)
      const L = doc.gen_length, out = [], span = v[6] && v[6][1] - v[6][0] <= 12 ? v[6] : null;
      for (let p = 0; p < L; p++) {
        const fz = f.frozen[p];
        const inBlk = p >= f.b * B && p < (f.b + 1) * B;
        if (fz === null) {
          if (!inBlk) { out.push(`<span class="tk m"></span>`); continue; }
          const c = +f.q[p] / 10, s = piece(doc, "c4", f.tok[p]);
          const def = f.def.has(p);
          out.push(`<span class="tk${p === f.b * B ? " blk0" : ""}" title="masked · argmax ${esc(s)} · conf ≥ ${c.toFixed(1)}" style="color:#8a939e;background:rgba(61,127,98,${(0.08 + 0.4 * c).toFixed(2)});${def ? "box-shadow:inset 0 -2px 0 var(--red);" : ""}">${esc(SPECIAL.test(s) ? "·" : s.replace(/\n/g, "↵"))}</span>`);
          continue;
        }
        let s = piece(doc, "c4", fz);
        if (SPECIAL.test(s)) { if (inBlk && f.cat[p]) s = "·"; else continue; }
        s = s.replace(/\n/g, "↵\n");
        const c = f.cat[p];
        let cls = "tk" + (c ? (c === "f" ? " conf" : c === "x" ? " fill" : " new") : "") + (p === f.b * B ? " blk0" : "");
        if (span && p >= span[0] && p < span[1]) cls += " ans";
        out.push(`<span class="${cls}">${esc(s)}</span>`);
      }
      const box = lab.querySelector(".lab-tokens");
      box.innerHTML = out.join("");
      const a0 = box.querySelector(".new, .conf, .fill") || box.querySelector(".blk0");
      if (a0) box.scrollTop = Math.max(0, a0.offsetTop - box.offsetTop - 80);
      // what this step committed, by rule (counts from the trace)
      const n = { s: 0, k: 0, f: 0, x: 0 };
      Object.values(f.cat).forEach(c => { n[c] = (n[c] || 0) + 1; });
      const row = (cls, lbl, k, note) => `<div class="ls-row"><i class="${cls}"></i><span>${lbl}</span><b>${k}</b><small>${note}</small></div>`;
      lab.querySelector(".lab-step").innerHTML = `<div class="ls-h">Committed at this step</div>` +
        row("sw-new", "scheduled top-k", n.s, "the base decoder's own commit, always kept") +
        row("sw-new", "CCTC core", n.k, "confident and next to the resolved boundary") +
        row("sw-conf", "confirmed deferral", n.f, "same token as last step, still confident") +
        row("sw-def", "deferred", f.def.size, "confident but far from the boundary: recheck next step") +
        (n.x ? row("sw-fill", "filled at exit", n.x, "rest of the sequence, from this step's prediction") : "");
      // answer + history of distinct values so far
      const hist = [];
      for (let k = 0; k <= i; k++) { const a = run.frames[k].v && run.frames[k].v[0]; if (a !== null && a !== undefined && hist[hist.length - 1] !== a) hist.push(a); }
      lab.querySelector(".g-ans .gv").textContent = short(v[0]);
      lab.querySelector(".g-ans .hist").innerHTML = hist.slice(-8).map((a, k, arr) => `<span class="${k === arr.length - 1 ? "cur" : ""}">${esc(String(a).length <= 14 ? String(a) : "v" + (hist.length - arr.length + k + 1))}</span>`).join("") +
        (hist.length > 1 ? `<span style="background:none">${hist.length - 1} change${hist.length > 2 ? "s" : ""}</span>` : "");
      // confidence
      const cOK = v[1] !== null && v[1] >= 0.7;
      lab.querySelector(".g-conf .meter span").style.width = `${100 * (v[1] || 0)}%`;
      lab.querySelector(".g-conf .gs").textContent = v[1] === null ? "answer span not decoded yet, so not readable" : `${v[1].toFixed(3)} ${cOK ? "— passes" : "— below 0.7"}`;
      lab.querySelector(".g-conf").classList.toggle("pass", cOK);
      // stability
      const need = v[3], run_ = v[2], rOK = run_ >= need;
      lab.querySelector(".g-run .pips").innerHTML = Array.from({ length: Math.max(need, run_) }, (_, k) => `<i class="${k < run_ ? "f" : ""}"></i>`).join("");
      lab.querySelector(".g-run .gs").textContent = `${run_} of ${need} required` + (v[4] ? ` (max(3, ⌈2 × ${v[4]} changes⌉))` : " (minimum 3)");
      lab.querySelector(".g-run").classList.toggle("pass", rOK);
      // decision
      const dec = lab.querySelector(".dec");
      let k = "Keep decoding", s = "at least one condition has not passed";
      if (v[5]) { k = "Exit"; const nf = Object.values(f.cat).filter(c => c === "x").length; s = `both pass: the remaining ${nf} masked positions are filled from this step's prediction`; }
      else if (last) { k = "Done"; s = "every block completed through CCTC before the exit gate fired"; }
      dec.classList.toggle("exit", !!v[5] || last);
      dec.querySelector(".gv").textContent = k; dec.querySelector(".gs").textContent = s;
    };
    const pick = async (id) => {
      tabs.querySelectorAll("button").forEach(b => b.setAttribute("aria-selected", b.dataset.id === id));
      doc = await load(id); range.max = doc.c4.steps; i = 0;
      // start on the most informative step: the first where the answer is readable
      show();
    };
    tabs.querySelectorAll("button").forEach(b => b.addEventListener("click", () => pick(b.dataset.id)));
    range.addEventListener("input", () => { i = +range.value - 1; show(); });
    lab.querySelectorAll("[data-d]").forEach(b => b.addEventListener("click", () => { i = Math.min(doc.c4.steps - 1, Math.max(0, i + +b.dataset.d)); show(); }));
    lab.addEventListener("keydown", e => {
      if (e.target === range) return;
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") { i = Math.min(doc.c4.steps - 1, Math.max(0, i + (e.key === "ArrowRight" ? 1 : -1))); show(); }
    });
    pick(avail.find(t => t.id === "gsm8k") ? "gsm8k" : avail[0].id);
  }
})();
