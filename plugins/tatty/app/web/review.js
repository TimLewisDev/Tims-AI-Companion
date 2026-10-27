// The review step's Start panel. The toolbox offers "review the branch" (tt-branch-review) once a build
// is complete, as /tt-branch-review [branch]. The skill reviews the repo its session starts in, which is
// not always the feature's project (a feature's sessions may run in one repo while its work is in
// another), so this panel asks which repo and branch, fills them in from what Tatty knows of the
// feature, and starts the session in that repo for this one session only (the server's review_request).

function reviewStart(f, onChange) {
  const enc = encodeURIComponent;
  const branch = el("input", { placeholder: "blank: the branch that is checked out", "aria-label": "branch to review", id: "review-branch" });
  const against = el("input", { placeholder: "blank: the repo's default branch", "aria-label": "compare with", id: "review-against" });
  const repoLine = el("div", { class: "project-line small", id: "review-repo" });
  const node = el("div", { class: "review-start" }, repoLine,
    el("div", { class: "start-inputs" },
      el("label", {}, el("span", { class: "dim small" }, "branch to review"), branch),
      el("label", {}, el("span", { class: "dim small" }, "compare with"), against)),
    el("div", { class: "small dim" }, "The review reads the repo the session starts in, so choose the repo the branch is in. ",
      "It is chosen for this session only: the feature keeps its own project."));
  let info = { repo: "" };

  const draw = () => {
    const same = info.repo && info.project && info.repo.replace(/\/+$/, "").toLowerCase() === info.project.replace(/\/+$/, "").toLowerCase();
    repoLine.replaceChildren("Reviews the repo ",
      info.repo ? copyable(info.repo) : el("strong", { class: "st missing" }, "no repository yet"),
      el("button", { type: "button", id: "review-change", onclick: change }, "Change…"),
      info.note ? el("div", { class: "st missing" }, info.note) : "",
      info.repo && !same && info.project ? el("div", { class: "dim" }, `The session starts in it, not in this feature's project (${info.project}).`) : "");
  };

  async function load(repo) {
    try { info = await api("/api/review?name=" + enc(f.name) + (repo ? "&repo=" + enc(repo) : "")); }
    catch (e) { info = { repo: "", note: String(e.message || e) }; }
    if (info.branch) branch.value = info.branch;
    draw();
    onChange();
  }

  async function change() {
    try {
      const path = await pickFolder(`Choose the repo to review for ${f.name}`, info.repo || info.project || "");
      if (path) await load(path);
    } catch (e) { alert(e.message || e); }
  }

  branch.addEventListener("input", onChange);
  against.addEventListener("input", onChange);
  draw();
  load("");
  return {
    node,
    ready: () => !!info.repo,
    cmd: () => ["/tt-branch-review", branch.value.trim(), against.value.trim() ? "against " + against.value.trim() : ""].filter(Boolean).join(" "),
    fields: () => ({ review: { repo: info.repo, branch: branch.value.trim(), against: against.value.trim() } }),
  };
}
