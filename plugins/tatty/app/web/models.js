// The model and effort pickers: what a workflow session starts on, and (in
// settings.js) the models of each step. The models are the ones of the connected
// LLMs (the toolbox's tt-connections), asked of the server once and again when a
// connection changes. A model that is connected but can't run a session yet is
// listed greyed out.
// Uses app.js's el and api.
"use strict";

let modelsAsked = null; // the /api/llms answer, as a promise, and when it was asked
let modelsAt = 0;
const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"];
const OWN = "Claude Code's own";

function loadModels(fresh) {
  if (!modelsAsked || fresh || Date.now() - modelsAt > 10000) {
    modelsAt = Date.now();
    modelsAsked = api("/api/llms").catch(() => null);
  }
  return modelsAsked;
}

// The options for a model select: Claude Code's own, then each provider's models.
function modelOptions(models, first = OWN) {
  const groups = [...new Set(models.map(m => m.provider))].map(p =>
    el("optgroup", { label: p }, models.filter(m => m.provider === p).map(m =>
      el("option", { value: m.id, disabled: !m.runnable }, m.runnable ? m.label : `${m.label} (not yet runnable)`))));
  return [el("option", { value: "" }, first), ...groups];
}

// The efforts a model takes (all of them when it names none, or none is chosen).
function effortsOf(models, id) {
  const m = models.find(x => x.id === id && x.runnable);
  return m && m.efforts.length ? m.efforts : EFFORT_LEVELS;
}

function effortOptions(list, first = OWN) {
  return [el("option", { value: "" }, first), ...list.map(e => el("option", { value: e }, e))];
}

// A model select and an effort select for a Start. It starts on the toolbox's
// `session` setting (Settings) and fields() gives what to send with the Start:
// both, even when blank (blank = Claude Code's own); nothing until the models are
// known, so the server falls back to the same setting.
function modelPicker(id) {
  const model = el("select", { id: id + "-model", "aria-label": "Model" }, el("option", { value: "" }, OWN));
  const effort = el("select", { id: id + "-effort", "aria-label": "Effort" }, effortOptions(EFFORT_LEVELS));
  let models = null;
  const fillEfforts = () => {
    const was = effort.value, list = effortsOf(models || [], model.value);
    effort.replaceChildren(...effortOptions(list));
    effort.value = list.includes(was) ? was : "";
  };
  model.addEventListener("change", fillEfforts);
  loadModels().then(d => {
    if (!d || !d.models) return;
    models = d.models;
    model.replaceChildren(...modelOptions(models));
    const set = d.session || {};
    model.value = models.some(m => m.id === set.model && m.runnable) ? set.model : "";
    fillEfforts();
    if (effortsOf(models, model.value).includes(set.effort)) effort.value = set.effort;
  });
  return {
    node: el("div", { class: "model-picker small", id }, el("span", { class: "dim small" }, "Starts on"), model,
      el("span", { class: "dim small" }, "effort"), effort),
    fields: () => (models ? { model: model.value, effort: effort.value } : {}),
  };
}
