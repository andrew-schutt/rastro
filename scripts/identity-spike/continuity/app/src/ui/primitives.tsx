// Design-system primitives. Components that compose only these write no host element of their
// own, so build-time stamping cannot see them: the degeneration docs/NOTES.md records.
import type { ReactNode } from 'react';

export function Row({ children }: { children: ReactNode }) {
  return <div className="row">{children}</div>;
}

export function Switch({ label, el }: { label: string; el: string }) {
  return <button type="button" role="switch" aria-checked="false" aria-label={label} data-el={el} />;
}
