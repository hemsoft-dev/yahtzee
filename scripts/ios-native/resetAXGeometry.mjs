import { bounds } from "./geometry.mjs";

const empty = (code, visited = 0) => ({ code, visited, viewport: null, viewportAncestors: [], target: null,
  targetAncestors: [], enabled: null, ancestorIntersection: null, ancestorContained: null });
const contains = (a, b) => b.left >= a.left && b.top >= a.top && b.right <= a.right && b.bottom <= a.bottom;
const intersection = (a, b) => {
  const left = Math.max(a.left, b.left), top = Math.max(a.top, b.top), right = Math.max(left, Math.min(a.right, b.right)), bottom = Math.max(top, Math.min(a.bottom, b.bottom));
  return { left, top, right, bottom, width: right - left, height: bottom - top };
};

/** Existing AX result only. No labels, IDs, node data or native correspondence are exported. */
export function resetAXGeometry(screen) {
  let visited = 0;
  try {
    if (screen?.ui_schema?.platform !== "ios" || screen.ui_schema.defaults?.enabled !== true || !Array.isArray(screen.elements)) return empty(5);
    const nodes = [], stack = screen.elements.map(node => ({ node, parents: [] }));
    if (stack.length > 512) return empty(6);
    while (stack.length) {
      const { node, parents } = stack.pop();
      if (++visited > 512 || parents.length > 24) return empty(6, Math.min(visited, 512));
      const entry = { node, parents, rect: bounds(node.b) }; nodes.push(entry);
      if (node.c !== undefined) {
        if (!Array.isArray(node.c)) return empty(5, visited);
        if (visited + stack.length + node.c.length > 512) return empty(6, visited);
        for (const child of node.c) stack.push({ node: child, parents: [...parents, entry] });
      }
    }
    const helps = nodes.filter(x => x.node.rid === "help-viewport");
    if (helps.length !== 1) return empty(helps.length ? 2 : 1, visited);
    const help = helps[0], result = empty(3, visited);
    result.viewportAncestors = help.parents.map(x => x.rect);
    result.viewport = result.viewportAncestors.reduce(intersection, help.rect);
    const targets = nodes.filter(x => x.parents.includes(help) && x.node.a11y === "Delete all local data" && !x.node.c?.length);
    if (targets.length !== 1) { result.code = targets.length ? 4 : 3; return result; }
    const target = targets[0]; result.code = 0; result.target = target.rect; result.targetAncestors = target.parents.map(x => x.rect);
    result.enabled = target.node.enabled === undefined ? true : typeof target.node.enabled === "boolean" ? target.node.enabled : null;
    // This intersects actual AX ancestor rectangles. It does not assert native clipping flags.
    result.ancestorIntersection = result.targetAncestors.reduce(intersection, target.rect);
    result.ancestorContained = result.targetAncestors.every(rect => contains(rect, target.rect));
    return result;
  } catch { return empty(5, visited); }
}
