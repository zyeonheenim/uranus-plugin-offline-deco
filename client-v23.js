/**
 * 线下剧情增强 · 前端插件 v2.1.0（四钮跳转 + 气泡样式 + 彩色毛玻璃）
 *
 * 两件套合成一个插件：
 *
 * 1. **四钮跳转**（右缘四个圆钮）：回顶 / 上一条我的发言 / 下一条我的发言 / 跳到最新。
 *    长剧情里不用一指一指往上划。
 * 2. **气泡样式**（「线下模式」标题旁的「样式」按钮）：实时预览 + 跟随主题/自定义
 *    + 我这边/角色那边分别调底色/透明度/毛玻璃磨砂/边框/文字/圆角。改完防抖写回插件 config，
 *    存在服务端��手机调完电脑一样。
 *
 * 纯前端：不改源码、不碰存档、不发任何非同源请求。
 *
 * 「我的发言」定位兼容两种环境：纯上游用原版天然类名 flex-row-reverse
 * （见 offline.jsx 的 Bubble）；装了 04 源码补丁则优先用更精确的 data-turn-user。
 */
const NS = "uranus-bubble-style-v2";
/** 标记用的属性名。CSS 里写的就是它，两边必须一模一样。 */
const ATTR = "data-uranus-bubble-style-v2";
const JUMP_NS = "uranus-jump-buttons-v1";
const BTN_ID = "ubs-style-btn";
const DLG_ID = "ubs-style-dialog";
const SAVE_URL = (id) => `/api/plugins/${id}/config`;

/** 和 manifest 的 default 一一对应。theme 时一个样式都不盖。 */
const DEFAULTS = {
  mode: "custom",
  user: { bg: "#e6f0fa", bgAlpha: 100, blur: 0, border: "#b9cfe4", borderAlpha: 100, borderWidth: 1, text: "#2f3a4a", radius: 16 },
  assistant: { bg: "#fdf6e8", bgAlpha: 100, blur: 0, border: "#e8dcc0", borderAlpha: 100, borderWidth: 1, text: "#3f3a30", radius: 16 },
};

const KEYMAP = {
  user: { bg: "userBg", bgAlpha: "userBgAlpha", blur: "userBlur", border: "userBorder", borderAlpha: "userBorderAlpha", borderWidth: "userBorderWidth", text: "userText", radius: "userRadius" },
  assistant: { bg: "assistantBg", bgAlpha: "assistantBgAlpha", blur: "assistantBlur", border: "assistantBorder", borderAlpha: "assistantBorderAlpha", borderWidth: "assistantBorderWidth", text: "assistantText", radius: "assistantRadius" },
};

const COLOR_RE = /^#([0-9a-f]{6})$/i;

function clone(o) { return JSON.parse(JSON.stringify(o)); }
function num(v, d, min, max) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : d;
}
function color(v, d) { return COLOR_RE.test(String(v || "").trim()) ? String(v).trim().toLowerCase() : d; }

/** 从插件 config（扁平 key）还原成内存 state，缺项用默认值兜底。 */
function fromConfig(c) {
  const s = clone(DEFAULTS);
  if (!c || typeof c !== "object") return s;
  s.mode = c.mode === "theme" || c.mode === "custom" ? c.mode : DEFAULTS.mode;
  for (const side of ["user", "assistant"]) {
    const d = DEFAULTS[side];
    const m = KEYMAP[side];
    s[side] = {
      bg: color(c[m.bg], d.bg),
      bgAlpha: num(c[m.bgAlpha], d.bgAlpha, 0, 100),
      blur: num(c[m.blur], d.blur, 0, 30),
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

/** #rrggbb → rgb(r g b / a%)，theme 模式返回色值本身（由调用方跳过）。 */
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

/**
 * 把当前配色写进 html 上的 CSS 变量；theme 时摘掉标记＝完全跟随主题。
 *
 * 🔴 用 setAttribute 而不是 `root.dataset[NS]`：
 * dataset 是代理对象，键名走「驼峰→连字符」的转换，`NS` 里带连字符
 * （uranus-bubble-style-v2）会让 Safari 直接抛
 * 「SyntaxError: The string did not match the expected pattern.」
 * ——Chrome 不校验这个，所以本地 Chrome 测好好的，Safari 整个插件加载失败。
 * setAttribute 写的是原样属性名，和 CSS 选择器里的名字完全一致。
 */
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
    if (s.blur > 0) {
      set("filter", `blur(${s.blur}px) saturate(130%)`);
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
  if (!mineOnly) {
    return all;
  }
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

/**
 * 回顶 / 回底。
 */
function jumpEdge(edge) {
  const box = scrollBox();
  if (!box) return;
  if (edge === "top") {
    box.scrollTo({ top: 0, behavior: "smooth" });
  } else {
    const spare = 72; // 约 3 行文字
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

/** 建四钮的容器并挂上点击。 */
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

/**
 * 给气泡本体打 user / assistant 标记（CSS 靠这个区分两侧）。
 */
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

/** 防抖写回服务端配置。失败不声张，下次改动会再试。 */
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
    if (s.blur > 0) {
      b.style.webkitBackdropFilter = `blur(${s.blur}px) saturate(130%)`;
      b.style.backdropFilter = `blur(${s.blur}px) saturate(130%)`;
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
  area.appendChild(previewBubble(false, "「你来了，手怎么这么凉。」他把外套往你肩上搭。"));
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

  // 模式切换（不锁）
  const modeBox = el("div", "ubs-chips");
  const themeBtn = el("button", "ubs-chip", "跟随主题");
  const customBtn = el("button", "ubs-chip", "自定义");
  themeBtn.type = customBtn.type = "button";
  themeBtn.onclick = () => { state.mode = "theme"; syncModeUI(); changed(); };
  customBtn.onclick = () => { state.mode = "custom"; syncModeUI(); changed(); };
  modeBox.append(themeBtn, customBtn);
  wrap.appendChild(modeBox);

  // 侧切换（不锁）
  const sideBox = el("div", "ubs-chips ubs-side-chips");
  const userBtn = el("button", "ubs-chip", "我这边");
  const asstBtn = el("button", "ubs-chip", "角色那边");
  userBtn.type = asstBtn.type = "button";
  userBtn.onclick = () => { currentSide = "user"; rebuildControls(); };
  asstBtn.onclick = () => { currentSide = "assistant"; rebuildControls(); };
  sideBox.append(userBtn, asstBtn);
  wrap.appendChild(sideBox);

  // 会被锁的那几行
  const lockedBox = el("div", "ubs-locked");
  wrap.appendChild(lockedBox);

  const rows = buildRows();
  while (rows.childNodes.length) lockedBox.appendChild(rows.childNodes[0]);

  syncModeUI();
  syncSideUI();
  return wrap;
}

/** 具体的控件行：底色/透明度/毛玻璃磨砂/边框/文字/圆角。切侧时整体重建。 */
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
  const mkRange = (key, min, max, unit, zeroText) => {
    const inp = el("input");
    inp.type = "range";
    inp.className = "ubs-range";
    inp.min = min; inp.max = max; inp.value = s[key];
    const formatVal = (v) => (v === 0 && zeroText ? zeroText : `${v}${unit}`);
    const val = el("span", "ubs-row-val", formatVal(s[key]));
    inp.oninput = () => {
      const v = Number(inp.value);
      state[currentSide][key] = v;
      val.textContent = formatVal(v);
      changed();
    };
    return { inp, val };
  };

  const bg = mkColor("bg");
  const bgA = mkRange("bgAlpha", 0, 100, "%");
  const blur = mkRange("blur", 0, 30, "px", "关闭");
  box.appendChild(makeRow("背景颜色", bg));
  box.appendChild(makeRow("背景不透明度", bgA.inp, bgA.val));
  box.appendChild(makeRow("毛玻璃磨砂", blur.inp, blur.val));

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
    /* Range 拿不到就退回元素自身的盒子 */
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
  console.info("[气泡样式] v2.1.0 已加载", { mode: state.mode, id: pluginId });

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
