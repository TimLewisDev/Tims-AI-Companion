// Tatty's task types: Task, Bug, Story and Epic, and the small icon that shows a
// task's type. The icon is a line drawing in the type's colour (theme.css's
// --type-* variables, set on .ttype in tasks.css), with the type's name as its
// label and tooltip, so the type is never shown by colour alone.
// Used by tasks.js and the task board's cards and panel.
"use strict";

const TASK_TYPES = ["Task", "Bug", "Story", "Epic"];

// Line icons on a 24 grid, drawn in the text colour like modes.js's ICONS.
const TASK_TYPE_PATHS = {
  Task: ["M4 4h16v16H4Z", "M8 12.5l2.5 2.5L16 9"],
  Bug: ["M9 7.5a3 3 0 0 1 6 0", "M8 12a4 4 0 0 1 8 0v3a4 4 0 0 1-8 0Z", "M12 11v8", "M8 12H4", "M16 12h4",
    "M8.5 16l-3 2", "M15.5 16l3 2", "M8.5 9l-3-2", "M15.5 9l3-2"],
  Story: ["M7 3h10v18l-5-4-5 4Z"],
  Epic: ["M13 2 4 14h7l-1 8 9-12h-7Z"],
};

// Any case; blank, missing or unknown is a task.
const taskTypeName = v => TASK_TYPES.find(n => n.toLowerCase() === String(v || "").trim().toLowerCase()) || "Task";

// A span holding the type's icon. Built with createElementNS and attributes, not
// a style attribute: the page's content security policy has no inline styles. No
// <title> child, which would add text to a card (the board filter reads it).
function taskTypeIcon(type) {
  const name = taskTypeName(type);
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  for (const [k, v] of Object.entries({
    viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": "1.8",
    "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true", width: "16", height: "16",
  })) svg.setAttribute(k, v);
  for (const d of TASK_TYPE_PATHS[name]) {
    const path = document.createElementNS(NS, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  const span = document.createElement("span");
  span.className = "ttype ttype-" + name.toLowerCase();
  span.setAttribute("role", "img");
  span.setAttribute("aria-label", name);
  span.title = name;
  span.append(svg);
  return span;
}
