// Numbers transcribed from the paper (Table 1: main results; Table 3: component ablation).
(function () {
  // [task, output length, LLaDA speedup, LLaDA dAcc, Dream speedup, Dream dAcc]
  const MAIN = [
    ["Short answer", null],
    ["MMLU", 64, 16.13, 0.0, 13.82, -1.5],
    ["ARC-C", 64, 14.30, 0.0, 17.35, 1.0],
    ["HellaSwag", 64, 16.76, 0.0, 13.48, 0.0],
    ["WinoGrande", 64, 18.64, 0.0, 15.81, 0.0],
    ["PIQA", 64, 15.53, 0.5, 17.71, 0.5],
    ["Long reasoning", null],
    ["GSM8K", 256, 3.55, -2.0, 4.82, 0.0],
    ["MATH", 256, 2.62, 1.0, 2.76, 0.0],
    ["SVAMP", 256, 4.29, 0.0, 5.28, -1.0],
    ["ASDiv", 256, 4.48, 3.0, 6.31, -2.0],
    ["GSM-Hard", 256, 3.60, 2.0, 3.99, 3.0],
    ["Code generation", null],
    ["HumanEval", 384, 8.70, 1.8, 10.07, -1.8],
    ["MBPP", 384, 11.09, 0.0, 13.42, 0.0],
  ];
  const tb = document.querySelector("#heat tbody");
  if (tb) {
    const lo = Math.log(2), hi = Math.log(19);
    const cell = (x, d) => {
      const t = Math.min(1, Math.max(0, (Math.log(x) - lo) / (hi - lo)));
      // blend #eaf1f9 -> #2a6bb0
      const c = [0xea + (0x2a - 0xea) * t, 0xf1 + (0x6b - 0xf1) * t, 0xf9 + (0xb0 - 0xf9) * t].map(Math.round);
      const ink = t > 0.55 ? "#fff" : "#1d2a3a";
      const ds = (d > 0 ? "+" : d < 0 ? "−" : "±") + Math.abs(d).toFixed(1);
      return `<td class="cell" style="background:rgb(${c});color:${ink}"><div class="x">${x.toFixed(2)}×</div><div class="d">Δacc ${ds}</div></td>`;
    };
    tb.innerHTML = MAIN.map(r => r[1] === null
      ? `<tr class="grp"><td colspan="4">${r[0]}</td></tr>`
      : `<tr><td class="task">${r[0]}</td><td class="len">${r[1]} tok</td>${cell(r[2], r[3])}${cell(r[4], r[5])}</tr>`).join("");
  }

  // [label, class, LLaDA steps, LLaDA acc, Dream steps, Dream acc]
  const ABL = {
    MMLU: { budget: 64, rows: [
      ["Full decoding", "base", 64, 64.0, 64, 71.5], ["+ CVEE exit", "cvee", 7.0, 64.0, 8.0, 69.5],
      ["+ CCTC core", "core", 5.2, 63.5, 5.2, 70.5], ["+ confirm", "conf", 5.0, 64.0, 4.7, 70.0],
      ["C⁴ (all blocks)", "c4", 4.8, 64.0, 4.5, 70.0]] },
    GSM8K: { budget: 256, rows: [
      ["Full decoding", "base", 256, 66.0, 256, 85.0], ["+ CVEE exit", "cvee", 250.0, 66.0, 256.0, 85.0],
      ["+ CCTC core", "core", 85.2, 66.0, 85.8, 85.0], ["+ confirm", "conf", 83.9, 66.0, 84.3, 85.0],
      ["C⁴ (all blocks)", "c4", 62.5, 64.0, 54.5, 85.0]] },
    HumanEval: { budget: 384, rows: [
      ["Full decoding", "base", 384, 40.2, 384, 45.1], ["+ CVEE exit", "cvee", 212.4, 37.2, 109.2, 42.7],
      ["+ CCTC core", "core", 50.0, 40.9, 36.6, 43.3], ["+ confirm", "conf", 48.8, 42.1, 35.8, 43.3],
      ["C⁴ (all blocks)", "c4", 39.4, 42.1, 29.2, 43.3]] },
  };
  const abl = document.getElementById("abl");
  const drawAbl = (bb) => {
    if (!abl) return;
    const si = bb === "llada" ? 2 : 4;
    abl.innerHTML = Object.entries(ABL).map(([task, o]) => `
      <div class="abl-task"><h4>${task}</h4><div class="abl-sub">${o.budget}-step budget · bar = average steps</div>
      ${o.rows.map(r => `<div class="abl-row r-${r[1]}"><div class="al">${r[0]}</div>
        <div class="abl-bar"><span data-w="${(100 * r[si] / o.budget).toFixed(2)}" style="width:0"></span></div>
        <div class="av"><b>${r[si] % 1 ? r[si].toFixed(1) : r[si]}</b> <small>acc ${r[si + 1].toFixed(1)}</small></div></div>`).join("")}
      </div>`).join("");
    requestAnimationFrame(() => requestAnimationFrame(() =>
      abl.querySelectorAll(".abl-bar span").forEach(s => { s.style.width = s.dataset.w + "%"; })));
  };
  document.querySelectorAll(".seg button").forEach(b => b.addEventListener("click", () => {
    document.querySelectorAll(".seg button").forEach(x => x.setAttribute("aria-checked", x === b));
    drawAbl(b.dataset.bb);
  }));
  if (abl && "IntersectionObserver" in window) {
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { drawAbl("llada"); io.disconnect(); } }, { threshold: 0.2 });
    io.observe(abl);
  } else drawAbl("llada");

  // lightbox
  const lb = document.getElementById("lightbox");
  if (lb) {
    const img = lb.querySelector("img");
    let last = null;
    const close = () => { lb.classList.remove("open"); if (last) last.focus(); };
    document.querySelectorAll("figure .frame img").forEach(im => {
      im.tabIndex = 0;
      const open = () => { last = im; img.src = im.currentSrc || im.src; img.alt = im.alt; lb.classList.add("open"); lb.querySelector("button").focus(); };
      im.addEventListener("click", open);
      im.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
    });
    lb.addEventListener("click", e => { if (e.target !== img) close(); });
    document.addEventListener("keydown", e => { if (e.key === "Escape" && lb.classList.contains("open")) close(); });
  }

  // BibTeX copy
  document.querySelectorAll(".copy").forEach(b => b.addEventListener("click", async () => {
    const t = document.getElementById(b.dataset.copy).textContent;
    try { await navigator.clipboard.writeText(t); b.textContent = "Copied"; }
    catch (e) {
      const r = document.createRange(); r.selectNodeContents(document.getElementById(b.dataset.copy));
      const s = getSelection(); s.removeAllRanges(); s.addRange(r); b.textContent = "Selected — press Ctrl+C";
    }
    setTimeout(() => { b.textContent = "Copy"; }, 1800);
  }));

  // section highlight in the sticky nav
  const links = [...document.querySelectorAll(".toc a")];
  const secs = links.map(a => document.querySelector(a.getAttribute("href"))).filter(Boolean);
  if ("IntersectionObserver" in window && secs.length) {
    const io = new IntersectionObserver(es => es.forEach(e => {
      if (e.isIntersecting) links.forEach(a => a.classList.toggle("on", a.getAttribute("href") === "#" + e.target.id));
    }), { rootMargin: "-40% 0px -55% 0px" });
    secs.forEach(s => io.observe(s));
  }
})();
