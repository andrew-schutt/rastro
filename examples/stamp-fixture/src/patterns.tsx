// examples/stamp-fixture/src/patterns.tsx
// One component per authoring pattern babel-plugin-rastro has to stamp correctly. Each exists
// because it is a way an element's owning component can be lost or misread, and the audit
// (audit/audit.ts) fails the build if any host element here is unstamped or stamped with the
// wrong owner. Adding a pattern is adding a case: write it here and render it from App.
import { Component, forwardRef, memo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

// ── A design-system primitive, and an app component that only composes primitives ──────────
// SettingsRow writes no host element of its own, so nothing is stamped "SettingsRow": its
// markup is View's and Button's. That is the design-system degeneration docs/NOTES.md records,
// and it is correct behaviour for host-only stamping — pinned here so a change to it is seen.

export function View({ children }: { children?: ReactNode }) {
  return <div className="view">{children}</div>;
}

export function Button({ label, onPress }: { label: string; onPress?: () => void }) {
  return (
    <button type="button" onClick={onPress}>
      {label}
    </button>
  );
}

export function SettingsRow({ label }: { label: string }) {
  return (
    <View>
      <Button label={label} />
    </View>
  );
}

// ── A .map() callback that closes over nothing ─────────────────────────────────────────────
// The React Compiler hoists this callback out of the component into a top-level `_temp`
// function. Stamped after that hoist, the <li> has no capitalised ancestor left.
const SWATCHES = ['#ccc', '#999', '#666'];

export function ColorList() {
  return (
    <ul>
      {SWATCHES.map((color) => (
        <li key={color} style={{ background: color }}>
          {color}
        </li>
      ))}
    </ul>
  );
}

// ── A .map() callback that closes over component state ─────────────────────────────────────
// Not hoistable, so the compiler keeps it inside the component's memoized body instead.
export function Counter() {
  const [count, setCount] = useState(0);
  return (
    <section>
      {[1, 2].map((step) => (
        <button key={step} type="button" onClick={() => setCount(count + step)}>
          +{step}
        </button>
      ))}
      <output>{count}</output>
    </section>
  );
}

// ── Wrappers the plugin has to see through to the binding name ────────────────────────────
export const MemoBadge = memo(function MemoBadge({ text }: { text: string }) {
  return <span className="badge">{text}</span>;
});

export const ArrowCard = ({ title }: { title: string }) => <article>{title}</article>;

export const RefInput = forwardRef<HTMLInputElement, { name: string }>((props, ref) => (
  <input ref={ref} name={props.name} aria-label={props.name} />
));

export const MemoArrowLink = memo(() => <a href="#memo">memo arrow</a>);

export class LegacyPanel extends Component<{ heading: string }> {
  override render() {
    return <h2>{this.props.heading}</h2>;
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────────────────────
// A helper INSIDE a component is transparent: its markup belongs to the component.
// A helper at module scope belongs to no component, and is left unstamped by design.

function renderFooterNote(text: string) {
  return <small>{text}</small>; // unowned: no capitalised enclosing function
}

export function Footer() {
  const renderLink = (href: string) => <a href={href}>{href}</a>;
  return (
    <footer>
      {renderLink('#top')}
      {renderFooterNote('module-scope helper')}
    </footer>
  );
}

// ── Conditional and portaled markup ────────────────────────────────────────────────────────
export function Toggle({ on }: { on: boolean }) {
  return on ? <strong>on</strong> : <em>off</em>;
}

export function Modal() {
  return createPortal(<dialog open>portaled</dialog>, document.body);
}
