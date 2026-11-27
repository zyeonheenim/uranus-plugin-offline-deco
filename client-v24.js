/**
 * 线下剧情增强 · 前端插件 v2.2.0（四钮跳转 + 气泡样式 + 开关式彩色毛玻璃）
 *
 * 两件套合成一个插件：
 *
 * 1. **四钮跳转**（右缘四个圆钮）：回顶 / 上一条我的发言 / 下一条我的发言 / 跳到最新。
 * 2. **气泡样式**（「线下模式」标题旁的「样式」按钮）：实时预览 + 跟随主题/自定义
 *    + 我这边/角色那边分别调底色/透明度/毛玻璃开关与百分比强度/边框/文字/圆角。
 *
 * 纯前端：不改源码、不碰存档、不发任何非同源请求。
 */
const NS = "uranus-bubble-style-v2";
const ATTR = "data-uranus-bubble-style-v2";
const JUMP_NS = "uranus-jump-buttons-v1";
const BTN_ID = "ubs-style-btn";
const DLG_ID = "ubs-style-dialog";
const SAVE_URL = (id) => `/api/plugins/${id}/config`;

/** 和 manifest 的 default 一一对应。theme 时一个样式都不盖。 */
const DEFAULTS = {
  mode: "custom",
  user: { bg: "#e6f0fa", bgAlpha: 100, glass: false, blur: 60, border: "#b9cfe4", borderAlpha: 100, borderWidth: 1, text: "#2f3a4a", radius: 16 },
  assistant: { bg: "#fdf6e8", bgAlpha: 100, glass: false, blur: 60, border: "#e8dcc0", borderAlpha: 100, borderWidth: 1, text: "#3f3a30", radius: 16 },
};

const KEYMAP = {
  user: { bg: "userBg", bgAlpha: "userBgAlpha", glass: "userGlass", blur: "userBlur", border: "userBorder", borderAlpha: "userBorderAlpha", borderWidth: "userBorderWidth", text: "userText", radius: "userRadius" },
  assistant: { bg: "assistantBg", bgAlpha: "assistantBgAlpha", glass: "assistantGlass", blur: "assistantBlur", border: "assistantBorder", borderAlpha: "assistantBorderAlpha", borderWidth: "assistantBorderWidth", text: "assistantText", radius: "assistantRadius" },
};

const COLOR_RE = /^#([0-9a-f]{6})$/i;

function clone(o) { return JSON.parse(JSON.stringify(o)); }
function num(v, d, min, max) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : d;
}
function color(v, d) { return COLOR_RE.test(String(v || "").trim()) ? String(v).trim().toLowerCase() : d; }

/** 将 10% ~ 100% 的用户直观百分比平滑映射为 4px ~ 24px 的真实高斯模糊 */
function blurPx(percent) {
  const p = Math.max(10, Math.min(100, Number(percent) || 60));
  return Math.round(3 + (p / 100) * 21);
}

/** 从插件 config（扁平 key）还原成内存 state，缺项用默认值兜底。 */
function fromConfig(c) {
  const s = clone(DEFAULTS);
  if (!c || typeof c !== "object") return s;
  s.mode = c.mode === "theme" || c.mode === "custom" ? c.mode : DEFAULTS.mode;
  for (const side of ["user", "assistant"]) {
    const d = DEFAULTS[side];
    const m = KEYMAP[side];
    let glass = false;
    let blurVal = d.blur;
    if (typeof c[m.glass] === "boolean") {
      glass = c[m.glass];
      blurVal = num(c[m.blur], d.blur, 10, 100);
    } else if (typeof c[m.blur] === "number") {
      // 兼��旧版若传入了 0~30 的数值
      glass = c[m.blur] > 0;
      blurVal = c[m.blur] > 0 ? (c[m.blur] <= 30 ? Math.round(c[m.blur] * 3.3) : c[m.blur]) : d.blur;
    }

    s[side] = {
      bg: color(c[m.bg], d.bg),
      bgAlpha: num(c[m.bgAlpha], d.bgAlpha, 0, 100),
      glass: glass,
      blur: num(blurVal, d.blur, 10, 100),
      border: color(c[m.border], d.border),
      borderAlpha: num(c[m.borderAlpha], d.borderAlpha, 0, 100),
      borderWidth: num(c[m.borderWidth], d.borderWidth, 0, 12),
      text: color(c[m.text], d.text),
      radius: num(c[m.radius], d.radius, 0, 40),
    };
  }
  return s;
}

/** 内存 state → 扁平 config values（只发声明过的 key，服务端白名单会校验）。 */
function toValues(s) {
  const out = { mode: s.mode };
  for (const side of ["user", "assistant"]) {
    for (const [k, ck] of Object.entries(KEYMAP[side])) out[ck] = s[side][k];
  }
  return out;
}

/** #rrggbb → rgb(r g b / a%) */
function cssColor(hex, alpha) {
  const m = /^#([0-9a-f]{6})/i.exec(String(hex || ""));
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgb(${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255} / ${num(alpha, 100, 0, 100)}%)`;
}

let state = clone(DEFAULTS);
let pluginId = "";
let currentSide = "assistant";
let saveTimer = null;
let observer = null;
let tickTimer = null;

function applyStyle() {
  const root = document.documentElement;
  if (state.mode === "theme") {
    root.removeAttribute(ATTR);
    return;
  }
  for (const side of ["user", "assistant"]) {
    const s = state[side];
    const set = (k, v) => root.style.setProperty(`--${NS}-${side}-${k}`, v);
    set("bg", cssColor(s.bg, s.bgAlpha));
    set("border", cssColor(s.border, s.borderAlpha));
    set("width", `${s.borderWidth}px`);
    set("text", s.text);
    set("radius", `${s.radius}px`);
    if (s.glass) {
      const px = blurPx(s.blur);
      set("filter", `blur(${px}px) saturate(130%)`);
      set("shadow", "0 1px 2px rgba(15, 23, 42, 0.05), 0 6px 16px rgba(15, 23, 42, 0.08)");
    } else {
      set("filter", "none");
      set("shadow", "none");
    }
  }
  root.setAttribute(ATTR, "on");
}

function getCurrentLabel() {
  const nodes = Array.from(document.querySelectorAll('[aria-current="page"]'));
  return nodes
    .map((el) => `${el.getAttribute("aria-label") || ""} ${el.textContent || ""}`)
    .join(" ");
}

function scrollBox() {
  return document.querySelector("main[data-scroll]");
}

function turnNodes(box, mineOnly) {
  let all = Array.from(box.querySelectorAll("div.flex.items-start.gap-3"));
  if (!mineOnly) return all;
  const marked = Array.from(box.querySelectorAll("[data-turn-user]"));
  if (marked.length) {
    return marked.map((el) =>
      el.matches?.("div.flex.items-start.gap-3") ? el : (el.closest("div.flex.items-start.gap-3") || el)
    );
  }
  return all.filter((el) => /flex-row-reverse/.test(el.className || ""));
}

function contentTop(el, box) {
  return el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
}

function jumpEdge(edge) {
  const box = scrollBox();
  if (!box) return;
  if (edge === "top") {
    box.scrollTo({ top: 0, behavior: "smooth" });
  } else {
    const spare = 72;
    const max = Math.max(0, box.scrollHeight - box.clientHeight + spare);
    box.scrollTo({ top: max, behavior: "smooth" });
  }
}

function jumpUser(dir) {
  const box = scrollBox();
  if (!box) return;
  const nodes = turnNodes(box, true);
  if (!nodes.length) return;
  const vr = box.getBoundingClientRect();
  const aim = (el) => Math.max(0, contentTop(el, box) - box.clientHeight / 3);

  if (dir < 0) {
    const above = nodes.filter((n) => n.getBoundingClientRect().bottom < vr.top - 8);
    const target = above.length ? above[above.length - 1] : nodes[0];
    box.scrollTo({ top: aim(target), behavior: "auto" });
  } else {
    const below = nodes.filter((n) => n.getBoundingClientRect().top > vr.bottom + 8);
    if (below.length) {
      box.scrollTo({ top: aim(below[0]), behavior: "auto" });
    } else {
      box.scrollTo({ top: box.scrollTop + box.clientHeight * 0.9, behavior: "auto" });
    }
  }
}

/* ───────────────────── 四钮跳转 ───────────────────── */

function makeJumpButton(label, title, svg) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = `${JUMP_NS}-btn`;
  b.setAttribute("aria-label", title);
  b.title = title;
  b.dataset.act = label;
  b.innerHTML = svg;
  return b;
}

const JUMP_ICON = {
  top: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 11l7-7 7 7"/><path d="M5 18l7-7 7 7"/></svg>',
  prev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 15l6-6 6 6"/></svg>',
  next: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
  bottom: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 6l7 7 7-7"/><path d="M5 13l7 7 7-7"/></svg>',
};

function buildJumpHost() {
  if (document.getElementById(JUMP_NS)) return null;
  const host = document.createElement("div");
  host.id = JUMP_NS;
  host.className = `${JUMP_NS}-host`;
  host.append(
    makeJumpButton("top", "回到最上面", JUMP_ICON.top),
    makeJumpButton("prev", "上一次我的发言", JUMP_ICON.prev),
    makeJumpButton("next", "下一次我的发言", JUMP_ICON.next),
    makeJumpButton("bottom", "跳到最新", JUMP_ICON.bottom),
  );
  host.addEventListener("click", (e) => {
    const btn = e.target.closest(`.${JUMP_NS}-btn`);
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === "top") jumpEdge("top");
    else if (act === "bottom") jumpEdge("bottom");
    else if (act === "prev") jumpUser(-1);
    else if (act === "next") jumpUser(1);
  });
  document.body.appendChild(host);
  return host;
}

function markBubbles() {
  const box = document.querySelector("main[data-scroll]");
  if (!box) return;
  box.querySelectorAll("div.flex.items-start.gap-3").forEach((row) => {
    const mine = /\bflex-row-reverse\b/.test(row.className || "");
    const bubble = Array.from(row.querySelectorAll("div")).find((el) => {
      const cls = el.className || "";
      return /\bborder-line\b/.test(cls) && !/border-dashed/.test(cls) && /\b(bg-sunken|bg-paper)\b/.test(cls);
    });
    if (bubble) bubble.setAttribute(ATTR, mine ? "user" : "assistant");
  });
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fetch(SAVE_URL(pluginId), {
      method: "PUT",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ values: toValues(state) }),
    }).catch(() => {});
  }, 400);
}

function changed() {
  applyStyle();
  markBubbles();
  updatePreview();
  scheduleSave();
}

/* ───────────────────────── 弹窗 ───────────────────────── */

const ICON_PALETTE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="7.5" cy="11" r="1" fill="currentColor" stroke="none"/><circle cx="11" cy="7" r="1" fill="currentColor" stroke="none"/><circle cx="16" cy="8.5" r="1" fill="currentColor" stroke="none"/><path d="M12 21c0-2 1.5-3 3.5-3"/></svg>';
const ICON_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
const ICON_ROTATE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>';
const ICON_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';

function el(tag, cls, html) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
}

function previewBubble(mine, text) {
  const s = state[mine ? "user" : "assistant"];
  const b = el("div", "ubs-pv-bubble", text);
  if (state.mode === "custom") {
    b.style.backgroundColor = cssColor(s.bg, s.bgAlpha);
    b.style.borderColor = cssColor(s.border, s.borderAlpha);
    b.style.borderWidth = `${s.borderWidth}px`;
    b.style.borderRadius = `${s.radius}px`;
    b.style.color = s.text;
    if (s.glass) {
      const px = blurPx(s.blur);
      b.style.webkitBackdropFilter = `blur(${px}px) saturate(130%)`;
      b.style.backdropFilter = `blur(${px}px) saturate(130%)`;
      b.style.boxShadow = "0 1px 2px rgba(15, 23, 42, 0.05), 0 6px 16px rgba(15, 23, 42, 0.08)";
    } else {
      b.style.webkitBackdropFilter = "none";
      b.style.backdropFilter = "none";
      b.style.boxShadow = "none";
    }
  }
  const rowBox = el("div", `ubs-pv-row ${mine ? "ubs-pv-mine" : ""}`);
  rowBox.appendChild(b);
  return rowBox;
}

function updatePreview() {
  const dlg = document.getElementById(DLG_ID);
  if (!dlg) return;
  const area = dlg.querySelector(".ubs-pv");
  if (!area) return;
  area.innerHTML = "";
  area.appendChild(previewBubble(false, "「你来了，手怎么这么凉。」他把外套往你��上搭。"));
  area.appendChild(previewBubble(true, "没多久。刚到。"));
}

function makeRow(label, control, valueEl) {
  const r = el("div", "ubs-row");
  r.appendChild(el("span", "ubs-row-label", label));
  const box = el("div", "ubs-row-ctl");
  box.appendChild(control);
  r.appendChild(box);
  if (valueEl) r.appendChild(valueEl);
  return r;
}

function buildControls() {
  const wrap = el("div", "ubs-controls");

  // 模式切换
  const modeBox = el("div", "ubs-chips");
  const themeBtn = el("button", "ubs-chip", "跟随主题");
  const customBtn = el("button", "ubs-chip", "自定义");
  themeBtn.type = customBtn.type = "button";
  themeBtn.onclick = () => { state.mode = "theme"; syncModeUI(); changed(); };
  customBtn.onclick = () => { state.mode = "custom"; syncModeUI(); changed(); };
  modeBox.append(themeBtn, customBtn);
  wrap.appendChild(modeBox);

  // 侧切换
  const sideBox = el("div", "ubs-chips ubs-side-chips");
  const userBtn = el("button", "ubs-chip", "我这边");
  const asstBtn = el("button", "ubs-chip", "角色那边");
  userBtn.type = asstBtn.type = "button";
  userBtn.onclick = () => { currentSide = "user"; rebuildControls(); };
  asstBtn.onclick = () => { currentSide = "assistant"; rebuildControls(); };
  sideBox.append(userBtn, asstBtn);
  wrap.appendChild(sideBox);

  // 锁定区
  const lockedBox = el("div", "ubs-locked");
  wrap.appendChild(lockedBox);

  const rows = buildRows();
  while (rows.childNodes.length) lockedBox.appendChild(rows.childNodes[0]);

  syncModeUI();
  syncSideUI();
  return wrap;
}

/** 具体的控件行：底色/透明度/毛玻璃开关与百分比强度/边框/文字/圆角 */
function buildRows() {
  const box = el("div");
  const s = state[currentSide];

  const mkColor = (key) => {
    const inp = el("input");
    inp.type = "color";
    inp.className = "ubs-color";
    inp.value = s[key];
    const onPick = () => { state[currentSide][key] = inp.value; changed(); };
    inp.oninput = onPick;
    inp.onchange = onPick;
    return inp;
  };
  const mkRange = (key, min, max, unit) => {
    const inp = el("input");
    inp.type = "range";
    inp.className = "ubs-range";
    inp.min = min; inp.max = max; inp.value = s[key];
    const val = el("span", "ubs-row-val", `${s[key]}${unit}`);
    inp.oninput = () => {
      const v = Number(inp.value);
      state[currentSide][key] = v;
      val.textContent = `${v}${unit}`;
      changed();
    };
    return { inp, val };
  };

  const bg = mkColor("bg");
  const bgA = mkRange("bgAlpha", 0, 100, "%");
  box.appendChild(makeRow("背景颜色", bg));
  box.appendChild(makeRow("背景不透明度", bgA.inp, bgA.val));

  // 毛玻璃效果：紧凑双胶囊（关闭 / 开启）
  const glassRow = el("div", "ubs-row");
  glassRow.appendChild(el("span", "ubs-row-label", "毛玻璃效果"));
  const glassCtl = el("div", "ubs-row-ctl");
  const glassChips = el("div", "ubs-chips-compact");
  const offBtn = el("button", `ubs-chip ${!s.glass ? "on" : ""}`, "关闭");
  const onBtn = el("button", `ubs-chip ${s.glass ? "on" : ""}`, "开启");
  offBtn.type = onBtn.type = "button";

  // 毛玻璃强度滑块（10% ~ 100%，以百分比计）
  const blurR = mkRange("blur", 10, 100, "%");
  const blurRow = makeRow("毛玻璃强度", blurR.inp, blurR.val);
  blurRow.style.display = s.glass ? "flex" : "none";

  offBtn.onclick = () => {
    s.glass = false;
    offBtn.classList.add("on");
    onBtn.classList.remove("on");
    blurRow.style.display = "none";
    changed();
  };

  onBtn.onclick = () => {
    s.glass = true;
    onBtn.classList.add("on");
    offBtn.classList.remove("on");
    blurRow.style.display = "flex";
    // 🌟 智能联动：如果当前是不透明（100%），自动降至最佳透光的 60%
    if (s.bgAlpha === 100) {
      s.bgAlpha = 60;
      bgA.inp.value = 60;
      bgA.val.textContent = "60%";
    }
    changed();
  };

  glassChips.append(offBtn, onBtn);
  glassCtl.appendChild(glassChips);
  glassRow.appendChild(glassCtl);

  box.appendChild(glassRow);
  box.appendChild(blurRow);

  const bd = mkColor("border");
  const bdA = mkRange("borderAlpha", 0, 100, "%");
  const bdW = mkRange("borderWidth", 0, 12, "px");
  box.appendChild(makeRow("边框颜色", bd));
  box.appendChild(makeRow("边框不透明度", bdA.inp, bdA.val));
  box.appendChild(makeRow("边框宽度", bdW.inp, bdW.val));

  box.appendChild(makeRow("文字颜色", mkColor("text")));
  const rad = mkRange("radius", 0, 40, "");
  box.appendChild(makeRow("圆角半径", rad.inp, rad.val));

  return box;
}

function syncModeUI() {
  const dlg = document.getElementById(DLG_ID);
  if (!dlg) return;
  const chips = dlg.querySelectorAll(".ubs-chip");
  chips.forEach((c) => {
    const t = (c.textContent || "").trim();
    if (t === "跟随主题") c.classList.toggle("on", state.mode === "theme");
    else if (t === "自定义") c.classList.toggle("on", state.mode === "custom");
  });
  const locked = dlg.querySelector(".ubs-locked");
  if (locked) locked.classList.toggle("locked", state.mode === "theme");
}

function syncSideUI() {
  const dlg = document.getElementById(DLG_ID);
  if (!dlg) return;
  const chips = dlg.querySelectorAll(".ubs-chip");
  chips.forEach((c) => {
    const t = (c.textContent || "").trim();
    if (t === "我这边") c.classList.toggle("on", currentSide === "user");
    else if (t === "角色那边") c.classList.toggle("on", currentSide === "assistant");
  });
}

function rebuildControls() {
  const dlg = document.getElementById(DLG_ID);
  if (!dlg) return;
  const locked = dlg.querySelector(".ubs-locked");
  if (!locked) return;
  const fresh = buildRows();
  locked.innerHTML = "";
  while (fresh.childNodes.length) locked.appendChild(fresh.childNodes[0]);
  syncModeUI();
  syncSideUI();
}

let escHandler = null;

function closeDialog() {
  const dlg = document.getElementById(DLG_ID);
  if (dlg) dlg.remove();
  if (escHandler) {
    document.removeEventListener("keydown", escHandler);
    escHandler = null;
  }
}

function openDialog() {
  if (document.getElementById(DLG_ID)) return;
  const mask = el("div", "ubs-mask");
  mask.id = DLG_ID;
  const box = el("div", "ubs-dlg");

  const head = el("div", "ubs-head");
  const headMain = el("div", "ubs-head-main");
  headMain.appendChild(el("h3", "ubs-title", "气泡样式"));
  headMain.appendChild(el("p", "ubs-desc", "线下剧情里气泡的外观 · 改了自动保存，手机和电脑是同一份"));
  head.appendChild(headMain);
  const close = el("button", "ubs-close", ICON_X);
  close.type = "button";
  close.setAttribute("aria-label", "关闭");
  close.onclick = closeDialog;
  head.appendChild(close);
  box.appendChild(head);

  const body = el("div", "ubs-body");
  body.appendChild(el("div", "ubs-pv"));
  const ctlHost = el("div", "ubs-ctl-host");
  body.appendChild(ctlHost);
  box.appendChild(body);

  const foot = el("div", "ubs-foot");
  const reset = el("button", "ubs-btn ubs-btn-ghost", `${ICON_ROTATE}<span>恢复默认</span>`);
  reset.type = "button";
  reset.onclick = () => { state = clone(DEFAULTS); rebuildControls(); changed(); };
  const done = el("button", "ubs-btn ubs-btn-primary", `${ICON_CHECK}<span>完成</span>`);
  done.type = "button";
  done.onclick = closeDialog;
  foot.append(reset, done);
  box.appendChild(foot);

  mask.appendChild(box);
  mask.addEventListener("mousedown", (e) => { if (e.target === mask) closeDialog(); });
  document.body.appendChild(mask);
  if (escHandler) document.removeEventListener("keydown", escHandler);
  escHandler = (e) => { if (e.key === "Escape") closeDialog(); };
  document.addEventListener("keydown", escHandler);
  ctlHost.appendChild(buildControls());
  updatePreview();
}

/* ───────────────────────── 按钮注入 ───────────────────────── */

function makeStyleButton() {
  const b = el("button", "ubs-style-btn", `${ICON_PALETTE}<span>样式</span>`);
  b.id = BTN_ID;
  b.type = "button";
  b.title = "气泡样式";
  b.onclick = openDialog;
  return b;
}

function findAnchor() {
  const card = document.querySelector('section[data-anchor="线下模式"]');
  const h2 = card ? card.querySelector("h2") : null;
  if (h2) return h2;
  const btns = Array.from(document.querySelectorAll("button"));
  const newStory = btns.find((b) => /开启新剧情/.test(b.textContent || ""));
  if (newStory) return newStory;
  const byText = Array.from(document.querySelectorAll("h2")).find(
    (el) => (el.textContent || "").trim() === "线下模式",
  );
  return byText || null;
}

function isOfflinePage() {
  if (findAnchor()) return true;
  return /线下/.test(getCurrentLabel());
}

function overlayVisible() {
  const els = document.querySelectorAll('[class*="inset-0"]');
  for (let i = 0; i < els.length; i += 1) {
    if (getComputedStyle(els[i]).position === "fixed") return true;
  }
  return false;
}

function textRect(el) {
  try {
    const range = document.createRange();
    range.selectNodeContents(el);
    const r = range.getBoundingClientRect();
    if (r && r.width) return r;
  } catch {
  }
  return el.getBoundingClientRect();
}

function ensureButton() {
  const btn = document.getElementById(BTN_ID);
  if (!btn) return;
  const anchor = findAnchor();
  if (!anchor || overlayVisible()) {
    btn.style.display = "none";
    return;
  }
  const r = textRect(anchor);
  const vw = window.innerWidth || document.documentElement.clientWidth || 0;
  const vh = window.innerHeight || document.documentElement.clientHeight || 0;

  if ((!r.width && !r.height) || r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) {
    btn.style.display = "none";
    return;
  }

  btn.style.display = "inline-flex";
  const bw = btn.offsetWidth || 76;
  const bh = btn.offsetHeight || 28;
  const gap = 10;

  let left;
  if (r.right + gap + bw <= vw - 8) {
    left = r.right + gap;
  } else if (r.left - gap - bw >= 8) {
    left = r.left - gap - bw;
  } else {
    left = Math.max(8, Math.min(r.right + gap, vw - bw - 8));
  }

  let top = r.top + r.height / 2 - bh / 2;
  top = Math.max(4, Math.min(top, vh - bh - 4));

  btn.style.position = "fixed";
  btn.style.top = `${top}px`;
  btn.style.left = `${left}px`;
  btn.style.transform = "none";
}

export default function init(ctx) {
  pluginId = ctx?.id || "uranus-plugin-offline-deco";
  state = fromConfig(ctx?.config);
  applyStyle();
  markBubbles();

  if (!document.getElementById(BTN_ID)) {
    const b = makeStyleButton();
    b.style.display = "none";
    document.body.appendChild(b);
  }
  ensureButton();
  console.info("[气泡样式] v2.2.0 已加载", { mode: state.mode, id: pluginId });

  const jumpHost = buildJumpHost();
  function refreshJump() {
    if (!jumpHost) return;
    const box = scrollBox();
    jumpHost.style.display = isOfflinePage() && box && !overlayVisible() ? "flex" : "none";
  }
  refreshJump();

  observer = new MutationObserver(() => { markBubbles(); ensureButton(); refreshJump(); });
  observer.observe(document.body, { childList: true, subtree: true });
  tickTimer = setInterval(() => { markBubbles(); ensureButton(); refreshJump(); }, 400);

  window.addEventListener("scroll", ensureButton, { passive: true, capture: true });
  window.addEventListener("resize", ensureButton, { passive: true });

  window.addEventListener("beforeunload", () => {
    clearTimeout(saveTimer);
    clearInterval(tickTimer);
    observer?.disconnect();
    closeDialog();
    document.getElementById(BTN_ID)?.remove();
    document.getElementById(JUMP_NS)?.remove();
  });
}
