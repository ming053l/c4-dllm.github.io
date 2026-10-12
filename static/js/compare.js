// "C⁴ vs other methods": the same prompt decoded by C⁴, Prophet, SlowFast and WINO, replayed from the paper's
// per-method recordings (static/traces/cmp_*.json, built by tools/compact_compare.py). Each run's measured total
// wall time is spread evenly over its steps; all four share one clock.
(function () {
  const root = document.getElementById("compare");
  if (!root) return;
  const TASKS = [
    { id: "mmlu", label: "Short answer · MMLU" },
    { id: "gsm8k", label: "Reasoning · GSM8K" },
    { id: "humaneval", label: "Code · HumanEval" },
  ];
  const METHODS = [
    { id: "c4", name: "C⁴", cls: "c4" },
    { id: "prophet", name: "Prophet", note: "early exit" },
    { id: "slowfast", name: "SlowFast", note: "faster sampling" },
    { id: "wino", name: "WINO", note: "faster sampling + re-masking" },
  ];
  const SPEEDS = [1, 2, 4];
  const SPECIAL = /^<\|.*\|>$/;
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const cache = {};
  const load = (id) => cache[id] || (cache[id] = fetch(`static/traces/cmp_${id}.json`).then(r => {
    if (!r.ok) throw new Error(id); return r.json();
  }).then(prep));

  function prep(doc) {
    const L = doc.gen_length;
    for (const m of METHODS) {
      const run = doc.runs[m.id];
      const buf = new Array(L).fill(-1);
      run.frames = run.log.map((diff) => {
        const fresh = new Set();
        for (const k in diff) { const p = +k, t = diff[k]; if (t >= 0 && buf[p] < 0) fresh.add(p); buf[p] = t; }
        return { buf: buf.slice(), fresh };
      });
      run.dt = run.wall_s * 1000 / run.frames.length;
    }
    return doc;
  }

  function body(doc, buf, fresh) {
    const L = doc.gen_length, out = [];
    let last = L - 1;
    while (last > 0 && (buf[last] < 0 || SPECIAL.test(doc.vocab[buf[last]] || ""))) {
      if (buf[last] < 0) break;
      last--;
    }
    for (let i = 0; i <= Math.min(L - 1, last + 1); i++) {
      const t = buf[i];
      if (t < 0) { out.push('<span class="tk m"></span>'); continue; }
      let s = doc.vocab[t]; if (s === undefined) s = "?";
      if (SPECIAL.test(s)) continue;
      out.push(`<span class="tk${fresh && fresh.has(i) ? " new" : ""}">${esc(s)}</span>`);
    }
    return out.join("");
  }

  root.innerHTML = `
    <div class="rp-head">
      <div class="rp-tabs" role="tablist">${TASKS.map(t => `<button class="rp-tab" role="tab" type="button" data-id="${t.id}">${t.label}</button>`).join("")}</div>
      <div class="rp-ctl">
        <button class="rp-btn" data-act="play" type="button">Play</button>
        <button class="rp-btn" data-act="speed" type="button" aria-label="Playback speed">1×</button>
      </div>
    </div>
    <div class="rp-prompt"></div>
    <div class="cmp-grid">${METHODS.map(m => `
      <div class="rp-panel ${m.cls || ""}" data-m="${m.id}">
        <div class="rp-bar"><span class="rp-name">${m.name}${m.note ? ` <small>${m.note}</small>` : ""}</span><span class="rp-meta"></span></div>
        <div class="rp-prog"><span></span></div>
        <div class="rp-body"></div>
        <div class="rp-foot"></div>
      </div>`).join("")}
    </div>`;
  const P = {};
  METHODS.forEach(m => {
    const el = root.querySelector(`[data-m="${m.id}"]`);
    P[m.id] = { meta: el.querySelector(".rp-meta"), prog: el.querySelector(".rp-prog span"), body: el.querySelector(".rp-body"), foot: el.querySelector(".rp-foot"), last: -2 };
  });
  const btnPlay = root.querySelector('[data-act="play"]'), btnSpeed = root.querySelector('[data-act="speed"]');
  let doc = null, clock = 0, speed = 1, playing = false, raf = 0, prev = 0, hold = 0;

  function draw(force) {
    for (const m of METHODS) {
      const run = doc.runs[m.id], p = P[m.id];
      const n = run.frames.length;
      const i = Math.min(n - 1, Math.floor(clock / run.dt) - 1 + (clock >= run.dt ? 0 : 0));
      const k = Math.min(n, Math.floor(clock / run.dt));          // steps finished
      const done = k >= n;
      p.meta.innerHTML = `step <b>${k}</b> · <b>${(Math.min(clock, run.wall_s * 1000) / 1000).toFixed(2)}</b> s`;
      p.prog.style.width = `${100 * Math.min(clock, run.wall_s * 1000) / (doc.maxWall * 1000)}%`;
      if (k - 1 === p.last && !force) continue;
      p.last = k - 1;
      const f = k > 0 ? run.frames[k - 1] : null;
      p.body.innerHTML = body(doc, f ? f.buf : new Array(doc.gen_length).fill(-1), f && !done ? f.fresh : null);
      const a = p.body.querySelector(".tk.new") || p.body.querySelector(".tk.m");
      if (a) p.body.scrollTop = Math.max(0, a.offsetTop - p.body.offsetTop - 60);
      p.foot.innerHTML = done
        ? `<span>finished in <b>${run.steps}</b> steps, ${run.wall_s.toFixed(2)} s</span>` +
          (run.correct ? `<span class="badge ok">✓ ${doc.task === "humaneval" ? "passes tests" : "correct"}</span>` : `<span class="badge no">✗ ${doc.task === "humaneval" ? "fails tests" : "wrong"}</span>`)
        : `<span>decoding…</span>`;
      void i;
    }
  }
  function tick(ts) {
    if (!playing) return;
    const dt = prev ? ts - prev : 0; prev = ts;
    const end = doc.maxWall * 1000;
    if (hold) { if (ts >= hold) { hold = 0; clock = 0; METHODS.forEach(m => { P[m.id].last = -2; }); } }
    else { clock += dt * speed; if (clock >= end) { clock = end; hold = ts + 3000; } }
    draw(false);
    raf = requestAnimationFrame(tick);
  }
  function setPlaying(on) { playing = on; btnPlay.textContent = on ? "Pause" : "Play"; prev = 0; cancelAnimationFrame(raf); if (on) raf = requestAnimationFrame(tick); }
  function setSpeed(s) { speed = s; btnSpeed.textContent = `${s}×`; }
  async function pick(id) {
    root.querySelectorAll(".rp-tab").forEach(b => b.setAttribute("aria-selected", b.dataset.id === id));
    doc = await load(id);
    doc.maxWall = Math.max(...METHODS.map(m => doc.runs[m.id].wall_s));
    root.querySelector(".rp-prompt").innerHTML = `<b>Prompt.</b> ${esc(doc.prompt).replace(/\n/g, "<br>")}`;
    clock = 0; hold = 0; METHODS.forEach(m => { P[m.id].last = -2; });
    setSpeed(doc.maxWall > 8 ? 2 : 1);
    draw(true);
  }
  root.querySelectorAll(".rp-tab").forEach(b => b.addEventListener("click", () => pick(b.dataset.id).then(() => setPlaying(true))));
  btnPlay.addEventListener("click", () => setPlaying(!playing));
  btnSpeed.addEventListener("click", () => setSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]));
  document.addEventListener("visibilitychange", () => { if (document.hidden && playing) setPlaying(false); });

  // mode switch between the two hero replays
  const modes = document.querySelectorAll(".mode-seg button");
  modes.forEach(b => b.addEventListener("click", () => {
    modes.forEach(x => x.setAttribute("aria-checked", x === b));
    const cmp = b.dataset.mode === "compare";
    document.getElementById("replay").hidden = cmp;
    root.hidden = !cmp;
    document.querySelectorAll(".mode-cap").forEach(c => { c.hidden = c.dataset.mode !== b.dataset.mode; });
    const other = document.querySelector('#replay [data-act="play"]');
    if (cmp) {
      if (other && other.textContent === "Pause") other.click();
      (doc ? Promise.resolve() : pick("humaneval")).then(() => setPlaying(true));
    } else if (playing) setPlaying(false);
  }));
})();
