"use strict";
// The tokens-used widget: what a session has used, to drop in wherever the app
// wants it. usageWidget(usage, { compact }) returns { node, update(usage) }; the
// usage is what the mod reports (server.py clean_usage): { input, output, cacheRead,
// cacheWrite, model, context?: { tokens?, window }, costUsd? }, or null before the
// first turn. Uses app.js's el, at call time.

function fmtTokens(n) {
  n = Math.max(0, Math.round(n || 0));
  if (n < 1000) return String(n);
  if (n < 1e6) return (n / 1000).toFixed(n < 1e4 ? 1 : 0).replace(/\.0$/, "") + "k";
  return (n / 1e6).toFixed(n < 1e7 ? 2 : 1).replace(/\.?0+$/, "") + "M";
}
const fmtUsd = v => "$" + (v < 1 ? v.toFixed(3).replace(/0$/, "") : v.toFixed(2));

const usageTotal = u => u.input + u.output + u.cacheRead + u.cacheWrite;
// The context window's fill, 0-100, or null when the engine gave no figure.
const usageFill = u => u.context && u.context.window && u.context.tokens != null
  ? Math.min(100, Math.round(100 * u.context.tokens / u.context.window)) : null;

function usageWidget(usage, opts) {
  const compact = Boolean(opts && opts.compact);
  const node = el("section", { class: compact ? "usage usage-compact" : "card usage" });

  function figure(label, n, title) {
    return el("div", { class: "usage-fig", title }, el("strong", {}, fmtTokens(n)), el("span", { class: "dim small" }, label));
  }
  // (Width set through the DOM: the page's CSP refuses inline style attributes.)
  function contextBar(u, fill) {
    const span = el("span");
    span.style.width = fill + "%";
    const label = `Context ${fmtTokens(u.context.tokens)} of ${fmtTokens(u.context.window)} · ${fill}%`;
    return el("div", { class: "bar usage-context" + (fill >= 90 ? " bad" : fill >= 70 ? " warn" : ""), title: label }, span, el("em", {}, label));
  }

  function update(u) {
    node.replaceChildren();
    if (!u) {
      node.append(compact ? el("span", { class: "dim small" }, "No usage yet") : el("h4", {}, "Tokens used"),
        compact ? "" : el("p", { class: "dim small" }, "No usage reported yet; it appears after the session's first reply."));
      return;
    }
    const fill = usageFill(u);
    if (compact) {
      node.append(el("span", { class: "usage-line", title: `${u.input} in · ${u.output} out · ${u.cacheRead} cache read · ${u.cacheWrite} cache written` },
        `${fmtTokens(usageTotal(u))} tokens`, fill != null ? ` · ${fill}% context` : "", u.costUsd != null ? ` · ${fmtUsd(u.costUsd)}` : ""));
      return;
    }
    node.append(
      el("div", { class: "usage-head" }, el("h4", {}, "Tokens used"), u.model ? el("span", { class: "dim small mono" }, u.model) : "",
        u.costUsd != null ? el("span", { class: "right usage-cost", title: "Cost so far" }, fmtUsd(u.costUsd)) : ""),
      el("div", { class: "usage-total" }, el("strong", {}, fmtTokens(usageTotal(u))), el("span", { class: "dim small" }, " tokens in all")),
      el("div", { class: "usage-figures" },
        figure("Input", u.input, "Input tokens the prompt cache did not serve"),
        figure("Output", u.output, "Tokens the model wrote"),
        figure("Cache read", u.cacheRead, "Input tokens served from the prompt cache"),
        figure("Cache write", u.cacheWrite, "Input tokens written to the prompt cache")),
      fill != null ? contextBar(u, fill) : "");
  }
  update(usage);
  return { node, update };
}
