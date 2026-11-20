// The model and effort pickers: what a workflow session starts on, and (in
// settings.js) the models of each step. The models are the ones of the connected
// LLMs (the toolbox's tt-connections), asked of the server once and again when a
// connection changes. A model that is connected but can't run a session yet is
// listed greyed out.
// Uses app.js's el and api.
"use strict";

let modelsAsked = null; // the /api/llms answer, as a promise, and when it was asked
let modelsAt = 0;
let modelRefreshFlight = null;
const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"];
const OWN = "Claude Code's own";
const modelPickers = new Set();
let modelRefreshTimer = 0;
let modelRefreshPending = false;
let modelRefreshRunning = false;

function loadModels(fresh) {
  if (fresh && modelRefreshFlight) return modelRefreshFlight;
  if (!modelsAsked || fresh || Date.now() - modelsAt > 10000) {
    modelsAt = Date.now();
    modelsAsked = api("/api/llms").catch(() => null);
    if (fresh) {
      modelRefreshFlight = modelsAsked;
      const flight = modelRefreshFlight;
      flight.finally(() => { if (modelRefreshFlight === flight) modelRefreshFlight = null; });
    }
  }
  return modelsAsked;
}

function modelValue(m) {
  return m.id.includes(":") ? m.id : `${m.provider}:${m.id}`;
}

// The options for a model select: Claude Code's own, then each provider's models.
// A specific version (scope "session": sonnet 5.5, ...) is listed under its alias,
// which comes first and follows the latest model; indented so they read as a group.
function modelOptions(models, first = OWN) {
  const groups = [...new Set(models.map(m => m.provider))].map(p =>
    el("optgroup", { label: p }, models.filter(m => m.provider === p).map(m => {
      const label = m.runnable ? m.label : `${m.label} (not yet runnable)`;
      return el("option", { value: modelValue(m), disabled: !m.runnable }, m.scope === "session" ? `   ${label}` : label); // no-break spaces: a normal one is dropped
    })));
  return [el("option", { value: "" }, first), ...groups];
}

function modelSelectOptions(models, saved, first = OWN) {
  const options = modelOptions(models, first);
  const savedModel = models.find(m => modelValue(m) === saved);
  if (savedModel) {
    const option = options.flatMap(group => group.tagName === "OPTGROUP" ? [...group.children] : [group])
      .find(item => item.value === saved);
    if (option) {
      option.selected = true;
      if (!savedModel.runnable) option.textContent = `${savedModel.label} (unavailable)`;
    }
  } else if (saved) {
    options.push(el("option", { value: saved, disabled: true, selected: true }, `${saved} (unavailable)`));
  }
  return options;
}

function queueModelPickerRefresh() {
  modelsAt = 0;
  modelRefreshPending = true;
  clearTimeout(modelRefreshTimer);
  modelRefreshTimer = setTimeout(refreshModelPickers, 120);
}

async function refreshModelPickers() {
  if (!modelRefreshPending || modelRefreshRunning) return;
  for (const picker of modelPickers) if (!picker.isConnected()) modelPickers.delete(picker);
  const open = [...modelPickers].filter(picker => picker.isConnected());
  const ready = open.filter(picker => !picker.isEditing());
  if (!open.length) { modelRefreshPending = false; return; }
  if (!ready.length) return;
  modelRefreshPending = false;
  modelRefreshRunning = true;
  try {
    const data = await loadModels(true);
    if (data && data.models) {
      for (const picker of ready) {
        if (picker.isConnected() && !picker.isEditing()) picker.refresh(data);
      }
    } else {
      modelsAsked = null;
      modelsAt = 0;
    }
  } finally {
    modelRefreshRunning = false;
    modelRefreshPending = modelRefreshPending || open.some(picker => picker.isConnected() && picker.isEditing());
    if (modelRefreshPending && !open.some(picker => picker.isConnected() && picker.isEditing())) queueModelPickerRefresh();
  }
}

document.addEventListener("tt-models-changed", queueModelPickerRefresh);
document.addEventListener("focusout", () => {
  if (modelRefreshPending) queueModelPickerRefresh();
});

// The efforts a model takes (all of them when it names none, or none is chosen).
function effortsOf(models, id) {
  const m = models.find(x => modelValue(x) === id && x.runnable);
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
  const fillEfforts = saved => {
    const was = saved === undefined ? effort.value : saved;
    const list = effortsOf(models || [], model.value);
    const options = effortOptions(list);
    if (was && !list.includes(was)) options.push(el("option", { value: was, disabled: true, selected: true }, `${was} (unavailable)`));
    effort.replaceChildren(...options);
    effort.value = was || "";
  };
  model.addEventListener("change", () => fillEfforts());
  const node = el("div", { class: "model-picker small", id }, el("span", { class: "dim small" }, "Starts on"), model,
    el("span", { class: "dim small" }, "effort"), effort);
  const apply = (d, initial = false) => {
    if (!d || !d.models) return;
    const selectedModel = initial ? (d.session && d.session.model || "") : model.value;
    const selectedEffort = initial ? (d.session && d.session.effort || "") : effort.value;
    models = d.models;
    model.replaceChildren(...modelSelectOptions(models, selectedModel));
    model.value = selectedModel;
    fillEfforts(selectedEffort);
  };
  const picker = {
    isConnected: () => node.isConnected,
    isEditing: () => node.contains(document.activeElement),
    refresh: d => apply(d),
  };
  modelPickers.add(picker);
  loadModels().then(d => apply(d, true));
  return {
    node,
    fields: () => (models ? { model: model.value, effort: effort.value } : {}),
  };
}
