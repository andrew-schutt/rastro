// examples/demo-app/src/Nav.tsx
// Split out of App.tsx deliberately, and the reason is telemetry rather than tidiness: the
// fingerprint's `@<source file>` qualifier names the file defining the INNERMOST component in
// the chain, so a single-file demo can never show that it tracks the component rather than
// the entry point. With this here, `App>Nav@src/Nav.tsx` and `App>SettingsForm@src/App.tsx`
// come off the same page — across a module boundary, through a minified bundle.
import { useEffect, useState, type ReactElement } from 'react';

/** Routes with a dynamic segment, so path tokenization is visible in the dashboard. */
const ROUTES = ['/', '/users/42/settings', '/orders/10482'] as const;

export function Nav(): ReactElement {
  const [path, setPath] = useState(location.pathname);

  // A hand-rolled router: pushState with no reload, which is exactly what the
  // historyRouteAdapter patches. A real app would use React Router here.
  useEffect(() => {
    const onPopState = (): void => setPath(location.pathname);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const go = (to: string): void => {
    history.pushState({}, '', to);
    setPath(to);
  };

  return (
    <nav>
      {ROUTES.map((route) => (
        <button
          key={route}
          type="button"
          onClick={() => go(route)}
          aria-current={route === path ? 'page' : undefined}
        >
          {route}
        </button>
      ))}
    </nav>
  );
}
