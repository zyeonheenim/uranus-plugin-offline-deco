/**
 * 线下剧情增强 · 前端插件 v2.0.0
 *
 * 两件套合成一个插件：
 *
 * 1. **四钮跳转**（右缘四个圆钮）：回顶 / 上一条我的发言 / 下一条我的发言 / 跳到最新。
 *    长剧情里不用一指一指往上划。
 * 2. **气泡样式**（「线下模式」标题旁的「样式」按钮）：实时预览 + 跟随主题/自定义
 *    + 我这边/角色那边分别调底色/透明度/边框/文字/圆角。改完防抖写回插件 config，
 *    存在服务端，手机调完电脑一样。
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
  user: { bg: "#e6f0fa", bgAlpha: 100, border: "#b9cfe4", borderAlpha: 100, borderWidth: 1, text: "#2f3a4a", radius: 16 },
  assistant: { bg: "#fdf6e8", bgAlpha: 100, border: "#e8dcc0", borderAlpha: 100, borderWidth: 1, text: "#3f3a30", radius: 16 },
};

const KEYMAP = {
  user: { bg: "userBg", bgAlpha: "userBgAlpha", border: "userBorder", borderAlpha: "userBorderAlpha", borderWidth: "userBorderWidth", text: "userText", radius: "userRadius" },
  assistant: { bg: "assistantBg", bgAlpha: "assistantBgAlpha", border: "assistantBorder", borderAlpha: "assistantBorderAlpha", borderWidth: "assistantBorderWidth", text: "assistantText", radius: "assistantRadius" },
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
    // 显示判断已不再依赖气泡（改看在线下页 + 有滚动容器），这里仅在别处用到时保留全量。
    return all;
  }
  // mineOnly：优先用补丁的精确标记（含 [data-turn-user] 的外层或自身）。
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
 *
 * 🔴 回底时多留一点余量（3 行文字高）：原版用 scrollIntoView({block:"nearest"})
 * 钉底，气泡底边刚好贴着视口边 —— 最后一行文字会被切掉一半（看着像显示不全）。
 * 多留这几十像素，最后一行就完整落在屏幕里了。
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
 * 只扫 row.children 会命中头像（它也带 border-line + bg-sunken），
 * 而且真正的气泡在孙辈：row > 中间层 div > 气泡 div。
 * 所以用 querySelectorAll('div') 打到孙辈，span 头像自然排除。
 *
 * 标记同样用 setAttribute —— 理由见 applyStyle 里的说明。
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
/* 关闭：原版 Modal 右上角的 X（lucide X，18px） */
const ICON_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
/* 恢复默认：原版 footer 里的 RotateCcw */
const ICON_ROTATE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>';
/* 完成：原版 footer 里的 Check */
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
  // 不用 replaceChildren —— Safari 老版本没有这个方法
  area.innerHTML = "";
  area.appendChild(previewBubble(false, "「你来了，手怎么这么凉。」他把外套往你肩上搭。"));
  area.appendChild(previewBubble(true, "没多久。刚到。"));
}

/**
 * 一行控件：标签 + 控件 + 数值。
 *
 * 🔴 第三个参数必须是**元素**而不是文本 —— 传文本的话这里会自己 new 一个
 * span，而滑块那边更新的是另一个元素，结果就是「示意图在变、数值不动」。
 */
function makeRow(label, control, valueEl) {
  const r = el("div", "ubs-row");
  r.appendChild(el("span", "ubs-row-label", label));
  const box = el("div", "ubs-row-ctl");
  box.appendChild(control);
  r.appendChild(box);
  if (valueEl) r.appendChild(valueEl);
  return r;
}

/**
 * 弹窗里的控件区。
 *
 * 🔴 结构照原版 BubbleStyleDialog：模式切换（跟随主题/自定义）和侧切换
 * （我这边/角色那边）在**锁定区外面**；被锁的只是下面那几行具体控件。
 * 之前把切换按钮也放进了会被锁的容器里 —— 点「跟随主题」后连「自定义」
 * 都点不动了，自己把自己锁死了。
 *
 * 这层（切换按钮）只建一次；切到另一侧时只换下面的 .ubs-locked 行。
 */
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

/** 具体的控件行：底色/透明度/边框/文字/圆角。切侧时整体重建。 */
function buildRows() {
  const box = el("div");   // 临时容器，调用方把里面的行搬走
  const s = state[currentSide];

  const mkColor = (key) => {
    const inp = el("input");
    inp.type = "color";
    inp.className = "ubs-color";
    inp.value = s[key];
    const onPick = () => { state[currentSide][key] = inp.value; changed(); };
    // 原生取色器：有的浏览器只给 onchange，有的只给 oninput，两个都挂上
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

/**
 * 同步两组切换按钮的高亮态，并决定要不要锁住下面那几行控件。
 *
 * 靠 class 名反查元素（而不是闭包持有）—— 控件区会被重建，闭包里的
 * 元素引用会指向已经被替换掉的旧节点，高亮就永远停在旧状态。
 */
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


/**
 * 切到另一侧时重建控件行。
 *
 * 🔴 只重建「被锁的那几行」，不重建整个控件区 —— 整个重建会把模式/侧切换
 * 按钮也换掉，它们的 onclick 闭包和高亮态都会丢。现在切换按钮是常驻的，
 * 控件行是它的子节点，单独换。
 */
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

/** Esc 监听器：挂在 document 上，弹窗关掉时必须摘掉，否则每开一次漏一个。 */
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

  // 头部：标题 + 说明 + 右上角关闭按钮（照原版 Modal 的结构）
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

  // 正文：预览 + 控件
  const body = el("div", "ubs-body");
  body.appendChild(el("div", "ubs-pv"));
  const ctlHost = el("div", "ubs-ctl-host");
  body.appendChild(ctlHost);
  box.appendChild(body);

  // 底部：按钮靠右（照原版 Modal footer 的 justify-end）
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
  // Esc 关闭：原版 Modal 也是 Esc 关
  if (escHandler) document.removeEventListener("keydown", escHandler);
  escHandler = (e) => { if (e.key === "Escape") closeDialog(); };
  document.addEventListener("keydown", escHandler);
  // 首次打开：把完整的控件区建出来（切换按钮 + 控件行）
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

/**
 * 找「样式」按钮的锚点：线下模式那张卡片的标题。
 *
 * 🔴 判据用「页面上有没有标题写着『线下模式』的卡片」，**不**用
 * 「导航栏名字含不含『线下』」——导航项是角色/场景名（用户自己起的名字），
 * 一个都不含『线下』，按导航名判断会全线失灵（气泡颜色会变、按钮却永远不出现）。
 * offline.jsx 里那张 Card 的 title 固定是「线下模式」，且只要 state 存在就渲染，
 * 所有线下模式页面都长这样 —— 是通用的锚点。
 *
 * 兜底还是「提示词」按钮（同样只在 offline 面板里）。
 */
function findAnchor() {
  // Card 的 title 是字符串时，ui.jsx 会写成 <section data-anchor="线下模式">
  const card = document.querySelector('section[data-anchor="线下模式"]');
  const h2 = card ? card.querySelector("h2") : null;
  if (h2) return h2;
  // 退一步：按标题文字找 h2
  const byText = Array.from(document.querySelectorAll("h2")).find(
    (el) => (el.textContent || "").trim() === "线下模式",
  );
  if (byText) return byText;
  // 再退一步：工具栏里的「提示词」
  const btns = Array.from(document.querySelectorAll("button"));
  return (
    btns.find((b) => /提示词/.test(b.textContent || "")) ||
    btns.find((b) => /总结/.test(b.textContent || "")) ||
    btns.find((b) => /开启新剧情|开始演/.test(b.textContent || "")) ||
    null
  );
}

/**
 * 当前是不是线下剧情页。
 *
 * 🔴 判据用「页面内有没有『线下模式』这张卡片」（锚点法），不只看导航栏名字。
 * 导航项可能叫角色名或场景名（用户自己起的），不一定含「线下」；
 * 而 offline 面板那张卡的标题固定是「线下模式」，所有线下页都长这样。
 * 导航名那条留作兜底。
 */
function isOfflinePage() {
  if (findAnchor()) return true;
  return /线下/.test(getCurrentLabel());
}

/**
 * 元素里**文字**的实际包围盒。
 *
 * h2 是块级元素，宽度等于整个容器 —— 直接用 getBoundingClientRect()
 * 量出来的 right 是容器右边缘（页面最右），按钮会被甩到屏幕外。
 * 用 Range 只量文字，才能贴着「线下模式」这几个字放。
 */
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

/**
 * 把「样式」按钮贴在锚点旁边。
 *
 * 🔴 按钮不插进 React 管理的 DOM 里 —— 那是 React 的地盘，它下次重渲染
 * 会把不认识的节点一起清掉，按钮就凭空消失了（这正是之前「颜色变了但按钮没有」
 * 的第二个原因）。改成常驻 body、用 fixed 定位贴在锚点旁边：
 * React 碰不到它，它也不会因为重渲染而消失。
 *
 * 锚点是页面左上角的「线下模式」标题，怎么缩窗口它都在，不会被推出屏幕。
 */
function ensureButton() {
  const btn = document.getElementById(BTN_ID);
  if (!btn) return;
  const anchor = findAnchor();
  if (!anchor) {
    btn.style.display = "none";
    return;
  }
  const r = textRect(anchor);
  const vw = window.innerWidth || document.documentElement.clientWidth || 0;
  const vh = window.innerHeight || document.documentElement.clientHeight || 0;

  // 锚点没渲染出来（宽高都是 0），或者已经滚出视野 → 藏起来
  if ((!r.width && !r.height) || r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) {
    btn.style.display = "none";
    return;
  }

  btn.style.display = "inline-flex";
  // 先显示再量：display:none 时 offsetWidth 是 0，位置会算歪
  const bw = btn.offsetWidth || 76;
  const bh = btn.offsetHeight || 28;
  const gap = 10;

  // 优先贴右边；右边放不下就贴左边；两边都不行就夹在视口里
  let left;
  if (r.right + gap + bw <= vw - 8) {
    left = r.right + gap;
  } else if (r.left - gap - bw >= 8) {
    left = r.left - gap - bw;
  } else {
    left = Math.max(8, Math.min(r.right + gap, vw - bw - 8));
  }

  // 垂直居中对齐；顶出屏幕就往下压，别让按钮上半截没了
  let top = r.top + r.height / 2 - bh / 2;
  top = Math.max(4, Math.min(top, vh - bh - 4));

  btn.style.position = "fixed";
  btn.style.top = `${top}px`;
  btn.style.left = `${left}px`;
  btn.style.transform = "none";
}

export default function init(ctx) {
  pluginId = ctx?.id || "uranus-plugin-bubble-style";
  state = fromConfig(ctx?.config);
  applyStyle();
  markBubbles();

  // 按钮常驻 body，不进 React 的 DOM 树 —— 见 ensureButton 的说明
  if (!document.getElementById(BTN_ID)) {
    const b = makeStyleButton();
    b.style.display = "none";
    document.body.appendChild(b);
  }
  ensureButton();
  console.info("[气泡样式] v1.1.0 已加载", { mode: state.mode, id: pluginId });

  // 四钮：容器常驻 body，显示与否靠下面的 refreshJump 切
  const jumpHost = buildJumpHost();
  function refreshJump() {
    if (!jumpHost) return;
    const box = scrollBox();
    // 和原版对齐：原版是「story && 四个钮」，只要剧情在就显示，不要求已经有气泡。
    jumpHost.style.display = isOfflinePage() && box ? "flex" : "none";
  }
  refreshJump();

  observer = new MutationObserver(() => { markBubbles(); ensureButton(); refreshJump(); });
  observer.observe(document.body, { childList: true, subtree: true });
  tickTimer = setInterval(() => { markBubbles(); ensureButton(); refreshJump(); }, 400);

  // 滚动/改窗口大小时锚点位置会变，按钮要跟着挪
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
