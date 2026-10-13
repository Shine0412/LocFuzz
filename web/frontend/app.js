/* LocFuzz Web 前端：仪表盘 / 任务监控 / 实时控制台 / 结果可视化 / 用例详情 */
const API = window.API_BASE;

const $ = (sel) => document.querySelector(sel);
const STATUS_TEXT = { running: "运行中", done: "已完成", stopped: "已停止", error: "出错" };
const STATUS_COLOR = { ok: "#3ecf8e", runtime_error: "#f7b955", syntax_error: "#f76d6d",
                       timeout: "#ff8f5c", crash: "#ff5c5c", llm_error: "#b06bff" };
const CASE_LABEL = { ok: "正常执行", runtime_error: "运行时报错", syntax_error: "语法错误",
                     timeout: "超时", crash: "崩溃", llm_error: "LLM 错误" };

/* ---------- 工具 ---------- */
function toast(msg, kind = "") {
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.textContent = msg;
  $("#toast-box").appendChild(el);
  setTimeout(() => el.remove(), 3600);
}

function countUp(el, target, suffix = "") {
  const start = parseFloat(el.dataset.v || "0") || 0;
  el.dataset.v = target;
  const t0 = performance.now(), dur = 600;
  const step = (t) => {
    const p = Math.min(1, (t - t0) / dur);
    const v = start + (target - start) * (1 - Math.pow(1 - p, 3));
    el.textContent = (Number.isInteger(target) ? Math.round(v) : v.toFixed(2)) + suffix;
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/* JS 语法高亮（轻量正则实现，无外部依赖） */
function highlightJS(code) {
  const esc = code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return esc.replace(
    /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|('(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`)|\b(function|return|var|let|const|for|while|if|else|new|typeof|instanceof|in|of|try|catch|throw|class|extends|this|prototype|delete|void|yield|async|await|switch|case|break|continue|do)\b|\b(\d+(?:\.\d+)?)\b/g,
    (m, com, str, kw, num) => {
      if (com) return `<span class="tok-com">${com}</span>`;
      if (str) return `<span class="tok-str">${str}</span>`;
      if (kw)  return `<span class="tok-kw">${kw}</span>`;
      if (num) return `<span class="tok-num">${num}</span>`;
      return m;
    });
}

/* ---------- 后端状态与全局统计 ---------- */
let engineInfo = {};
async function pingBackend() {
  const dot = $("#backend-dot"), info = $("#backend-info");
  try {
    const r = await fetch(`${API}/api/health`);
    if (!r.ok) throw new Error();
    engineInfo = await (await fetch(`${API}/api/config`)).json();
    dot.className = "dot on";
    info.textContent = `后端在线 · LLM: ${engineInfo.model}`;
    $("#engine-pill").textContent = `V8 ${engineInfo.node_version || ""} · ${engineInfo.platform}`;
  } catch {
    dot.className = "dot off";
    info.textContent = "后端不可达";
    $("#engine-pill").textContent = "V8 · —";
  }
}

async function refreshStats() {
  let d;
  try { d = await (await fetch(`${API}/api/stats`)).json(); } catch { return; }
  countUp($("#st-jobs"), d.total_jobs);
  $("#st-running-sub").textContent = `运行中 ${d.running_jobs}`;
  $("#st-running-sub").classList.toggle("busy", d.running_jobs > 0);
  countUp($("#st-cases"), d.total_cases);
  countUp($("#st-valid"), d.avg_validity_pct, "%");
  countUp($("#st-jaccard"), d.avg_jaccard_pct, "%");
  countUp($("#st-editsim"), d.avg_edit_sim_pct, "%");
  countUp($("#st-crashes"), d.total_crashes);
}

/* ---------- 种子库 ---------- */
let seedData = { builtin: [], user: [] };

async function loadSeeds() {
  try {
    seedData = await (await fetch(`${API}/api/seeds`)).json();
  } catch { return; }
  $("#builtin-count").textContent = `（${seedData.builtin.length}）`;
  $("#user-count").textContent = `（${seedData.user.length}）`;
  renderSeedList("builtin-list", seedData.builtin, false);
  renderSeedList("user-list", seedData.user, true);
  syncMode();
}

function renderSeedList(id, seeds, deletable) {
  const box = $(`#${id}`);
  if (!seeds.length) {
    box.innerHTML = `<div class="empty muted">${deletable ? "尚未上传自定义种子" : "暂无内置种子"}</div>`;
    return;
  }
  box.innerHTML = seeds.map((s) => `
    <label class="seed-item">
      <input type="checkbox" value="${s.name}" ${deletable ? "" : 'data-builtin="1"'}>
      <span class="seed-text">
        <span class="seed-name">${s.name}</span>
      </span>
      ${s.desc ? `<span class="info-mark" title="${s.desc}">ⓘ</span>` : ""}
      <span class="chip-meta">${(s.size / 1024).toFixed(1)} KB</span>
      ${deletable ? '<button type="button" class="seed-del" title="删除该种子">✕</button>' : ""}
    </label>`).join("");
  if (deletable) {
    box.querySelectorAll(".seed-del").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.preventDefault();
        const name = btn.closest(".seed-item").querySelector("input").value;
        if (!confirm(`确认删除种子「${name}」？`)) return;
        const r = await fetch(`${API}/api/seeds/${encodeURIComponent(name)}`, { method: "DELETE" });
        if (r.ok) { toast(`已删除 ${name}`, "ok"); loadSeeds(); }
        else toast(`删除失败：${(await r.json()).detail || r.status}`, "err");
      });
    });
  }
}

function syncMode() {
  const custom = document.querySelector('input[name="seed-mode"]:checked').value === "custom";
  $("#seed-picker").hidden = !custom;
  document.querySelectorAll("#seed-picker input[type=checkbox]").forEach((c) => {
    c.checked = !custom && !!c.dataset.builtin;
  });
}

document.querySelectorAll('input[name="seed-mode"]').forEach((r) =>
  r.addEventListener("change", syncMode));

$("#seed-upload").addEventListener("change", async (e) => {
  const f = e.target.files[0];
  e.target.value = "";
  if (!f) return;
  const fd = new FormData();
  fd.append("file", f);
  const r = await fetch(`${API}/api/seeds`, { method: "POST", body: fd });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { toast(`上传失败：${d.detail || r.status}`, "err"); return; }
  toast(`已保存至我的种子库：${d.saved}`, "ok");
  await loadSeeds();
  // 切到自定义模式并勾选刚上传的种子
  document.querySelector('input[name="seed-mode"][value="custom"]').checked = true;
  syncMode();
  const cb = document.querySelector(`#user-list input[value="${CSS.escape(d.saved)}"]`);
  if (cb) cb.checked = true;
});

/* ---------- 发起任务 ---------- */
$("#start-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const mode = document.querySelector('input[name="seed-mode"]:checked').value;
  let names;
  if (mode === "default") {
    names = seedData.builtin.map((s) => s.name);
    if (!names.length) { toast("内置种子库为空", "err"); return; }
  } else {
    names = [...document.querySelectorAll("#seed-picker input[type=checkbox]:checked")]
      .map((c) => c.value);
    if (!names.length) { toast("请先勾选至少一个种子", "err"); return; }
  }

  const fd = new FormData();
  fd.append("selected", names.join(","));
  fd.append("per_seed", $("#per-seed").value);
  fd.append("timeout", $("#timeout").value);

  const btn = $("#start-btn");
  btn.disabled = true;
  try {
    const r = await fetch(`${API}/api/jobs`, { method: "POST", body: fd });
    const data = await r.json();
    if (!r.ok) throw new Error(data.detail || `HTTP ${r.status}`);
    toast(`任务已创建：${data.job_id}`, "ok");
    refreshJobs();
    selectJob(data.job_id);
  } catch (err) {
    toast(`创建失败：${err.message}`, "err");
  } finally {
    btn.disabled = false;
  }
});

/* ---------- 任务监控 ---------- */
let pollTimer = null;
let selectedJob = null;
const openConsoles = new Set();
const consoleTimers = {};

function statusBadge(s) {
  return `<span class="badge ${s}">${STATUS_TEXT[s] || s}</span>`;
}

async function refreshJobs() {
  let jobs;
  try { jobs = await (await fetch(`${API}/api/jobs`)).json(); } catch { return; }

  const tbody = $("#job-tbody");
  if (!jobs.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty">暂无任务</td></tr>`;
  } else {
    tbody.innerHTML = jobs.map((j) => {
      const pct = j.progress.total ? Math.round(j.progress.done / j.progress.total * 100) : 0;
      const acts = [];
      acts.push(`<button class="btn btn-ghost btn-sm" onclick="toggleConsole('${j.job_id}')">🖥 控制台</button>`);
      if (j.status === "running") {
        acts.push(`<button class="btn btn-danger btn-sm" onclick="stopJob('${j.job_id}')">停止</button>`);
      } else {
        acts.push(`<button class="btn btn-ghost btn-sm" onclick="selectJob('${j.job_id}')">📊 结果</button>`);
        acts.push(`<button class="btn btn-ghost btn-sm" onclick="rerunJob('${j.job_id}')">↻ 重跑</button>`);
        acts.push(`<a class="btn btn-ghost btn-sm" href="${API}/api/jobs/${j.job_id}/export" download>⬇ 导出</a>`);
        acts.push(`<button class="btn btn-danger btn-sm" onclick="deleteJob('${j.job_id}')">删除</button>`);
      }
      const seedChips = j.seeds.map((s) =>
        `<a href="javascript:void(0)" onclick="viewSeed('${j.job_id}','${s}')">${s}</a>`).join("、");
      return `<tr>
        <td><a href="javascript:void(0)" onclick="selectJob('${j.job_id}')">${j.job_id}</a></td>
        <td class="muted">${j.created_at}</td>
        <td>${seedChips}</td>
        <td>${statusBadge(j.status)}${j.error ? `<div class="current-case">${j.error}</div>` : ""}</td>
        <td>
          <div class="progress">
            <div class="bar"><div style="width:${pct}%"></div></div>
            <span class="num">${j.progress.done}/${j.progress.total}</span>
          </div>
          ${j.progress.current ? `<div class="current-case">${j.progress.current} · 已运行 ${j.elapsed_sec}s</div>` : ""}
        </td>
        <td>${acts.join(" ")}</td>
      </tr>` +
      (openConsoles.has(j.job_id) ? `<tr class="console-row"><td colspan="6"><div class="console" id="console-${j.job_id}">加载事件流…</div></td></tr>` : "");
    }).join("");
  }

  // 打开的轮询控制台
  for (const id of openConsoles) {
    const job = jobs.find((x) => x.job_id === id);
    if (job) loadConsole(id);
  }

  const anyRunning = jobs.some((j) => j.status === "running");
  if (anyRunning && !pollTimer) pollTimer = setInterval(refreshJobs, 2000);
  if (!anyRunning && pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

/* ---------- 实时控制台 ---------- */
window.toggleConsole = (jobId) => {
  if (openConsoles.has(jobId)) {
    openConsoles.delete(jobId);
    if (consoleTimers[jobId]) { clearInterval(consoleTimers[jobId]); delete consoleTimers[jobId]; }
  } else {
    openConsoles.add(jobId);
  }
  refreshJobs();
};

async function loadConsole(jobId) {
  const box = $(`#console-${jobId}`);
  if (!box) {
    if (consoleTimers[jobId]) { clearInterval(consoleTimers[jobId]); delete consoleTimers[jobId]; }
    return;
  }
  try {
    const resp = await fetch(`${API}/api/jobs/${jobId}/events`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const d = await resp.json();
    const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    box.innerHTML = d.events.map((e) =>
      `<div><span class="c-time">${e.time}</span><span class="c-${e.kind}">${esc(e.msg)}</span></div>`
    ).join("") || `<div class="c-info">暂无事件</div>`;
    box.scrollTop = box.scrollHeight;
    // 运行中：1.5s 轮询事件流；已结束：轮询一次即停
    if (d.status === "running" && !consoleTimers[jobId]) {
      consoleTimers[jobId] = setInterval(() => loadConsole(jobId), 1500);
    } else if (d.status !== "running" && consoleTimers[jobId]) {
      clearInterval(consoleTimers[jobId]);
      delete consoleTimers[jobId];
    }
  } catch { /* 任务可能刚被删除：停掉轮询，避免空转 */
    if (consoleTimers[jobId]) { clearInterval(consoleTimers[jobId]); delete consoleTimers[jobId]; }
  }
}

/* ---------- 任务操作 ---------- */
window.stopJob = async (jobId) => {
  await fetch(`${API}/api/jobs/${jobId}/stop`, { method: "POST" });
  toast("已发送停止指令");
  refreshJobs();
};

window.rerunJob = async (jobId) => {
  try {
    const r = await fetch(`${API}/api/jobs/${jobId}/rerun`, { method: "POST" });
    const d = await r.json();
    if (!r.ok) throw new Error(d.detail || "重跑失败");
    toast(`已按相同配置重跑：${d.job_id}`, "ok");
    refreshJobs();
  } catch (e) { toast(e.message, "err"); }
};

window.deleteJob = async (jobId) => {
  if (!confirm(`确认删除任务 ${jobId}？其用例与结果将一并清除。`)) return;
  try {
    const r = await fetch(`${API}/api/jobs/${jobId}`, { method: "DELETE" });
    const d = await r.json();
    if (!r.ok) throw new Error(d.detail || "删除失败");
    toast(`任务 ${jobId} 已删除`, "ok");
    if (selectedJob === jobId) $("#result-card").hidden = true;
    refreshJobs(); refreshStats();
  } catch (e) { toast(e.message, "err"); }
};

window.viewSeed = async (jobId, name) => {
  try {
    const code = await (await fetch(`${API}/api/jobs/${jobId}/seeds/${name}`)).text();
    openModal({ title: `种子 · ${name}`, code,
      badges: [`<span class="badge done">seed</span>`],
      info: "上传的原始漏洞 PoC（基线样本）" });
  } catch { toast("种子读取失败", "err"); }
};

/* ---------- 结果展示 ---------- */
let resultTimer = null;

function gaugeSVG(value, label, color, desc = "", tip = "") {
  const r = 52, c = 2 * Math.PI * r;
  const off = c * (1 - Math.min(100, Math.max(0, value)) / 100);
  return `<div class="gauge-box" ${tip ? `title="${tip}"` : ""} style="cursor:help">
    <svg class="gauge" viewBox="0 0 120 120">
      <circle class="g-bg" cx="60" cy="60" r="${r}"></circle>
      <circle class="g-val" cx="60" cy="60" r="${r}" stroke="${color}"
        stroke-dasharray="${c}" stroke-dashoffset="${c}"
        transform="rotate(-90 60 60)"
        style="stroke-dashoffset:${off}; filter: drop-shadow(0 0 6px ${color})"></circle>
      <text x="60" y="58" text-anchor="middle">${value.toFixed(2)}</text>
      <text class="g-unit" x="60" y="76" text-anchor="middle">/ 100</text>
    </svg>
    <div class="gauge-label">${label}${tip ? ' <span class="info-mark">ⓘ</span>' : ""}</div>
    ${desc ? `<div class="gauge-desc">${desc}</div>` : ""}
  </div>`;
}

function drawDonut(breakdown) {
  const canvas = $("#donut"), ctx = canvas.getContext("2d");
  const entries = Object.entries(breakdown);
  const total = entries.reduce((s, [, n]) => s + n, 0);
  ctx.clearRect(0, 0, 180, 180);
  $("#donut-legend").innerHTML = "";
  if (!total) {
    ctx.strokeStyle = "#263250"; ctx.lineWidth = 22;
    ctx.beginPath(); ctx.arc(90, 90, 66, 0, 2 * Math.PI); ctx.stroke();
    return;
  }
  let a = -Math.PI / 2;
  entries.forEach(([k, n]) => {
    const frac = n / total, a2 = a + frac * 2 * Math.PI;
    ctx.strokeStyle = STATUS_COLOR[k] || "#8fa1bd";
    ctx.lineWidth = 22; ctx.lineCap = "butt";
    ctx.beginPath(); ctx.arc(90, 90, 66, a + 0.02, a2 - 0.02); ctx.stroke();
    a = a2;
    $("#donut-legend").insertAdjacentHTML("beforeend",
      `<div class="legend-item"><span class="legend-swatch" style="background:${STATUS_COLOR[k] || "#8fa1bd"}"></span>${CASE_LABEL[k] || k} × ${n}（${Math.round(frac * 100)}%）</div>`);
  });
  ctx.fillStyle = "#e6ecf5"; ctx.font = "700 26px Segoe UI";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(total, 90, 84);
  ctx.fillStyle = "#8fa1bd"; ctx.font = "11px Segoe UI";
  ctx.fillText("用例", 90, 106);
}

const infoCell = (info) => {
  if (!info) return `<td class="muted">—</td>`;
  const text = info.locations || info.note || "—";
  const extra = [info.strategy && `策略: ${info.strategy}`,
                 info.pattern && `模式: ${info.pattern}`]
                .filter(Boolean).join("；");
  const title = JSON.stringify(info, null, 1).replace(/"/g, "&quot;");
  return `<td class="llm-info" title="${title}">
    <span class="llm-badge">LLM</span> ${text}${extra ? `<div class="muted">${extra}</div>` : ""}</td>`;
};

window.selectJob = async (jobId) => {
  selectedJob = jobId;
  if (resultTimer) { clearInterval(resultTimer); resultTimer = null; }
  $("#result-card").hidden = false;
  $("#result-job-id").textContent = jobId;
  $("#export-btn").href = `${API}/api/jobs/${jobId}/export`;

  const res = await fetch(`${API}/api/jobs/${jobId}/result`);
  if (res.status === 409) {
    $("#gauge-row").innerHTML =
      `<div class="empty" style="grid-column:1/-1;padding:30px 0">⏳ 任务尚未完成，完成后自动显示…</div>`;
    $("#crash-tbody").innerHTML = "";
    $("#record-tbody").innerHTML = "";
    drawDonut({});
    resultTimer = setInterval(() => selectJob(jobId), 3000);
    $("#result-card").scrollIntoView({ behavior: "smooth" });
    return;
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    $("#gauge-row").innerHTML =
      `<div class="empty" style="grid-column:1/-1">✕ ${data.detail || "结果获取失败"}</div>`;
    return;
  }
  const d = await res.json();

  $("#gauge-row").innerHTML =
    gaugeSVG(d.validity_rate_pct, "用例有效性", "#4f8ef7",
      "变异代码可正常解析执行的比例",
      "LLM 生成的变异代码中，能被 JS 引擎正常解析并执行（非语法错误、未超时/崩溃）的比例。越高说明 LLM 定向变异越精准、不破坏代码结构。") +
    gaugeSVG(d.mean_jaccard_pct, "Jaccard 相似度", "#3ecf8e",
      "变异前后覆盖函数集合的重合度",
      "变异前后「覆盖函数集合」的交并比（交集 ÷ 并集）。越接近 100%，说明变异保留了原漏洞样本的执行路径。") +
    gaugeSVG(d.mean_edit_sim_pct, "EditSim 相似度", "#9b5cf7",
      "变异前后函数调用顺序的吻合度",
      "变异前后「函数调用序列」的编辑距离相似度。越高说明变异没有打乱原漏洞的触发时序。两项相似度共同衡量变异是否在原漏洞附近做「换汤不换药」的探索。") +
    `<div class="gauge-box" style="display:flex;flex-direction:column;justify-content:center;gap:6px">
       <div class="stat"><div class="stat-v">${d.total_cases}</div><div class="stat-k">用例总数</div></div>
       <div class="stat"><div class="stat-v">${d.elapsed_sec}s</div><div class="stat-k">耗时</div></div>
       <div class="stat"><div class="stat-v" style="font-size:16px">${engineInfo.model || "LLM"}</div><div class="stat-k">引导变异模型</div></div>
     </div>`;

  drawDonut(d.status_breakdown);

  const caseLink = (name) =>
    name ? `<a href="${API}/api/jobs/${jobId}/cases/${name}" download>${name}</a>` : "—";

  const CASE_STATUS_TEXT = { crash: "崩溃", timeout: "超时" };
  $("#crash-tbody").innerHTML = d.crashes_and_timeouts.length
    ? d.crashes_and_timeouts.map((c) => {
        const label = CASE_STATUS_TEXT[c.status] || c.status;
        const color = STATUS_COLOR[c.status] || "#8fa1bd";
        return `<tr>
        <td>${c.case}</td><td><span class="badge" style="background:${color}22;color:${color}">${label}</span></td>
        <td class="muted">${c.error || ""}</td>
        <td>${caseLink(c.case)}</td></tr>`;
      }).join("")
    : `<tr><td colspan="4" class="empty">无崩溃/超时用例</td></tr>`;

  const REC_STATUS_TEXT = { valid: "有效", invalid: "无效", timeout: "超时", crash: "崩溃", llm_error: "LLM 错误" };
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  // —— 按种子分组合集：组头可折叠，含异常用例的组默认展开 ——
  const groups = {};
  d.records.forEach((r, idx) => { (groups[r.seed] = groups[r.seed] || []).push([r, idx]); });
  $("#record-tbody").innerHTML = Object.entries(groups).map(([seed, items]) => {
    const n = items.length;
    const validN = items.filter(([r]) => r.valid).length;
    const avgJ = (items.reduce((s, [r]) => s + r.jaccard, 0) / n).toFixed(2);
    const avgE = (items.reduce((s, [r]) => s + r.edit_sim, 0) / n).toFixed(2);
    const abnormal = items.filter(([r]) => r.status === "crash" || r.status === "timeout").length;
    const open = abnormal > 0;
    const detailRows = items.map(([r, idx]) => {
      const caseName = r.status === "llm_error" ? null : `${r.seed.replace(/\.js$/, "")}_m${r.id}.js`;
      return `<tr class="grp-detail" data-seed="${esc(seed)}" style="display:${open ? "" : "none"}"
        onclick="viewCase('${jobId}', ${idx})">
        <td class="muted">${esc(r.seed)}</td><td>${r.id}</td>
        <td><span class="badge" style="background:${(STATUS_COLOR[r.status] || "#8fa1bd")}22;color:${STATUS_COLOR[r.status] || "#8fa1bd"}">${REC_STATUS_TEXT[r.status] || r.status}</span></td>
        <td>${r.valid ? "✓" : "✗"}</td>
        <td>${r.jaccard}</td><td>${r.edit_sim}</td>
        <td class="latency">${r.latency_ms != null ? r.latency_ms + " ms" : "—"}</td>
        ${infoCell(r.mutation_info)}
      </tr>`;
    }).join("");
    return `<tr class="grp-row${open ? " grp-open" : ""}" data-seed="${esc(seed)}" onclick="toggleGroup(this)">
      <td colspan="8">
        <span class="grp-arrow">${open ? "▼" : "▶"}</span>
        <span class="grp-name">${esc(seed)}</span>
        <span class="chip">${n} 个用例</span>
        <span class="chip">有效 ${validN}/${n}</span>
        <span class="chip">J ${avgJ}</span>
        <span class="chip">E ${avgE}</span>
        ${abnormal ? `<span class="chip chip-warn">⚠ ${abnormal} 个异常</span>` : ""}
        <span class="muted grp-hint">点击${open ? "收起" : "展开"}用例明细</span>
      </td></tr>${detailRows}`;
  }).join("");

  $("#result-card").scrollIntoView({ behavior: "smooth" });
  refreshStats();
};

/* ---------- 用例详情抽屉 ---------- */
let currentResult = null;

window.toggleGroup = (row) => {
  const seed = row.dataset.seed;
  const open = row.classList.toggle("grp-open");
  document.querySelectorAll(`.grp-detail[data-seed="${CSS.escape(seed)}"]`)
    .forEach((r) => { r.style.display = open ? "" : "none"; });
  row.querySelector(".grp-arrow").textContent = open ? "▼" : "▶";
  row.querySelector(".grp-hint").textContent = open ? "点击收起用例明细" : "点击展开用例明细";
};

window.viewCase = async (jobId, idx) => {
  try {
    const d = await (await fetch(`${API}/api/jobs/${jobId}/result`)).json();
    currentResult = d;
    const r = d.records[idx];
    const caseName = `${r.seed.replace(/\.js$/, "")}_m${r.id}.js`;
    const code = r.status === "llm_error"
      ? `// 该用例 LLM 变异失败\n// ${r.error || ""}`
      : await (await fetch(`${API}/api/jobs/${jobId}/cases/${caseName}`)).text();
    const info = r.mutation_info || {};
    const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    openModal({
      title: caseName,
      code,
      badges: [
        `<span class="badge" style="background:${(STATUS_COLOR[r.status] || "#8fa1bd")}22;color:${STATUS_COLOR[r.status] || "#8fa1bd"}">${CASE_LABEL[r.status] || r.status}</span>`,
        r.valid ? `<span class="badge done">有效</span>` : `<span class="badge error">无效</span>`,
        `<span class="badge running">Jaccard ${r.jaccard}</span>`,
        `<span class="badge running">EditSim ${r.edit_sim}</span>`,
        r.latency_ms != null ? `<span class="badge stopped">LLM ${r.latency_ms} ms</span>` : "",
      ].join(""),
      info: [
        info.locations ? `<b>变异位置：</b>${esc(info.locations)}` : "",
        info.strategy ? `<b>变异策略：</b>${esc(info.strategy)}` : "",
        info.pattern ? `<b>漏洞模式：</b>${esc(info.pattern)}` : "",
      ].filter(Boolean).join("<br>") || "该用例无 LLM 自述信息",
      downloadUrl: r.status === "llm_error" ? null : `${API}/api/jobs/${jobId}/cases/${caseName}`,
    });
  } catch { toast("用例详情加载失败", "err"); }
};

function openModal({ title, code, badges = "", info = "", downloadUrl = null }) {
  $("#modal-title").textContent = title;
  $("#modal-badges").innerHTML = badges;
  $("#modal-info").innerHTML = info;
  $("#modal-info").style.display = info ? "" : "none";
  $("#modal-code").innerHTML = highlightJS(code);
  const dl = $("#modal-download");
  if (downloadUrl) { dl.href = downloadUrl; dl.style.display = ""; }
  else dl.style.display = "none";
  $("#modal-mask").hidden = false;
}

window.closeModal = () => { $("#modal-mask").hidden = true; };
$("#modal-mask").addEventListener("click", (e) => {
  if (e.target === $("#modal-mask")) closeModal();
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });

/* ---------- 启动 ---------- */
$("#refresh-btn").addEventListener("click", refreshJobs);
pingBackend(); refreshStats(); refreshJobs(); loadSeeds();
setInterval(pingBackend, 15000);
setInterval(refreshStats, 5000);
