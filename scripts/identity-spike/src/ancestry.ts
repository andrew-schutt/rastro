// scripts/identity-spike/src/ancestry.ts
// Every first-party component above an element, with its file: what rule 2 judges "touched" by.
//
// VALIDATION-PLAN.md §3.2 rule 2: "An element is *touched* by a commit when the diff changes the
// app's own source of any component in that element's ancestry." Any component, so neither of
// the fingerprint walks will do:
//
// - They stop at `MAX_CHAIN_DEPTH`. An edit five levels up is exactly the propagation rule 2
//   suspects ("the depth-4 chain cap letting an edit several levels up silently re-identify
//   everything beneath it"), and a capped ancestry would call that element untouched.
// - They drop `NOISE`. An app's own `ThemeProvider` is still the app's own source, and editing
//   it touches everything it wraps.
//
// So this reads marks, uncapped and unfiltered: `name` and `file` string literals that the
// spike's mark plugin (mark-plugin.ts) attaches to every component the build plugin names,
// including ones that render no host element. The fiber's `.return` crosses portals, which DOM
// stamps cannot. The corpus builds carry marks in the app's own source only, so a library
// component never appears here.
import { getFiber, MARK_PROPERTY, type ComponentMark } from './fiber.ts';

/** The private fiber fields this reads. */
interface MarkedFiber {
  type?: unknown;
  elementType?: unknown;
  return?: MarkedFiber | null;
}

/** The mark carried by this value itself, never one inherited from a superclass. */
function ownMark(value: unknown): ComponentMark | null {
  if ((typeof value !== 'function' && typeof value !== 'object') || value === null) return null;
  if (!Object.prototype.hasOwnProperty.call(value, MARK_PROPERTY)) return null;
  const mark = (value as Record<string, unknown>)[MARK_PROPERTY];
  if (typeof mark !== 'object' || mark === null) return null;
  const { name, file } = mark as Record<string, unknown>;
  if (typeof name !== 'string' || name === '') return null;
  return typeof file === 'string' && file !== '' ? { name, file } : { name };
}

/** Unwrapping forwardRef (`render`) and memo (`type`) one level. */
function markOfType(type: unknown): ComponentMark | null {
  const own = ownMark(type);
  if (own !== null || typeof type !== 'object' || type === null) return own;
  const wrapper = type as { render?: unknown; type?: unknown };
  if (wrapper.render !== undefined) return ownMark(wrapper.render);
  if (wrapper.type !== undefined) return ownMark(wrapper.type);
  return null;
}

function markOf(fiber: MarkedFiber): ComponentMark | null {
  return markOfType(fiber.type) ?? (fiber.elementType === fiber.type ? null : markOfType(fiber.elementType));
}

/**
 * Every marked component above the element, outermost → innermost, each with its file when
 * the build emitted one. Not collapsed: a component counted twice by the fiber tree (a `memo`
 * with a comparator) appears twice.
 */
export function markedAncestry(element: Element): ComponentMark[] {
  const marks: ComponentMark[] = [];
  let fiber: MarkedFiber | null = getFiber(element);
  while (fiber !== null && fiber !== undefined) {
    const mark = markOf(fiber);
    if (mark !== null) marks.push(mark);
    fiber = fiber.return ?? null;
  }
  return marks.reverse();
}
