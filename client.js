/**
 * 剧情四钮跳转 · 前端插件
 *
 * 在线下剧情页右缘加四个圆钮：回顶 / 上一条我的发言 / 下一条我的发言 / 回底。
 * 纯 DOM 操作，不改任何源码、不碰存档、不发网络请求。
 *
 * 只在「线下模式」页显示：靠导航按钮上的 aria-current="page" 判断，
 * 认它有 "线下" 两个字。🔴 导航轨收起时按钮里只有图标、文字在 aria-label 上，
 * 所以 aria-label 和 textContent 都要读（上游 shell.jsx 的 RailButton 行为）。
 *
 * 「我的发言」定位兼容两种环境：纯上游用原版天然类名 flex-row-reverse
 * （见 offline.jsx 的 Bubble）；装了 04 源码补丁则优先用更精确的 data-turn-user。
 */
const NS = "uranus-jump-buttons-v1";

/**
 * 当前页判断。🔴 不能只读 textContent：桌面导航轨收起时按钮里只有图标，
 * 文字只写在 aria-label 上（见上游 shell.jsx 的 RailButton：expanded 才渲染
 * <span>{label}</span>，但 aria-label 永远是 label）。所以两种都认。
 * 取所有 aria-current="page" 的元素拼起来，桌面轨 + 手机抽屉任一命中即可。
 */
function getCurrentLabel() {
  const nodes = Array.from(document.querySelectorAll('[aria-current="page"]'));
  return nodes
    .map((el) => `${el.getAttribute("aria-label") || ""} ${el.textContent || ""}`)
    .join(" ");
}

function isOfflinePage() {
  return /线下/.test(getCurrentLabel());
}

function scrollBox() {
  return document.querySelector("main[data-scroll]");
}

/**
 * 气泡节点。兼容两种环境：
 * - 纯上游（玩家机器）：气泡外层是 `flex items-start gap-3`，我那侧多一个 flex-row-reverse。
 * - 装了 04 源码补丁（本机）：用户气泡额外带 `data-turn-user`，更精确，优先用它。
 */
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

/** 内容坐标：节点相对滚动容器顶部的位置（含已滚过的量）。 */
function contentTop(el, box) {
  return el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
}

function jumpEdge(edge) {
  const box = scrollBox();
  if (!box) return;
  if (edge === "top") {
    box.scrollTo({ top: 0, behavior: "smooth" });
  } else {
    box.scrollTo({ top: box.scrollHeight, behavior: "smooth" });
  }
}

/**
 * 单箭头：在我的发言之间跳。
 * 往下按「视口底」找屏幕下方还没看到的那条；往上按「视口顶」找已滚出去的。
 * 目标落在视口上三分处，避开头顶悬停的标题栏。
 */
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

function makeButton(label, title, svg) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = `${NS}-btn`;
  b.setAttribute("aria-label", title);
  b.title = title;
  b.dataset.act = label;
  b.innerHTML = svg;
  return b;
}

const ICON = {
  top: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 11l7-7 7 7"/><path d="M5 18l7-7 7 7"/></svg>',
  prev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 15l6-6 6 6"/></svg>',
  next: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
  bottom: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 6l7 7 7-7"/><path d="M5 13l7 7 7-7"/></svg>',
};

export default function init() {
  if (document.getElementById(NS)) return;

  const host = document.createElement("div");
  host.id = NS;
  host.className = `${NS}-host`;
  host.append(
    makeButton("top", "回到最上面", ICON.top),
    makeButton("prev", "上一次我的发言", ICON.prev),
    makeButton("next", "下一次我的发言", ICON.next),
    makeButton("bottom", "跳到最新", ICON.bottom),
  );
  document.body.appendChild(host);

  host.addEventListener("click", (e) => {
    const btn = e.target.closest(`.${NS}-btn`);
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === "top") jumpEdge("top");
    else if (act === "bottom") jumpEdge("bottom");
    else if (act === "prev") jumpUser(-1);
    else if (act === "next") jumpUser(1);
  });

  function refresh() {
    const box = scrollBox();
    // 和原版对齐：原版是「story && 四个钮」，只要剧情在就显示，不要求已经有气泡。
    // 之前这里多要求 turnNodes().length，剧情刚开、还没人说话时按钮就不出现。
    host.style.display = isOfflinePage() && box ? "flex" : "none";
  }
  // 导航切换与剧情切换都不 reload，用轮询 + 事件兜底；开销极小。
  refresh();
  const timer = setInterval(refresh, 300);
  document.addEventListener("click", refresh, { passive: true });
  window.addEventListener("resize", refresh, { passive: true });
  window.addEventListener("beforeunload", () => {
    clearInterval(timer);
    document.removeEventListener("click", refresh);
    window.removeEventListener("resize", refresh);
    host.remove();
  });
}
