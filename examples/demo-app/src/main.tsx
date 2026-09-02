// examples/demo-app/src/main.tsx
// The whole integration, exactly as the README advertises it.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RastroProvider, otlpExporter } from 'rastro-react';
import { App } from './App.js';
import './styles.css';

const container = document.getElementById('root');
if (container === null) throw new Error('#root missing from index.html');

createRoot(container).render(
  <StrictMode>
    <RastroProvider
      app="demo-app"
      version="0.0.0"
      // Same-origin thanks to the Vite proxy; swap for consoleExporter() to run with no
      // backend at all, or multiExporter([...]) to fan out (§19.6).
      exporter={otlpExporter({ endpoint: '/v1/logs' })}
      // §4.2.1: keep the raw components so fingerprints can be re-derived without
      // re-collecting, and so drift is eyeballable while identity is being tuned.
      // `accessibleName` stays off — it is redacted, but it is the closest thing to page
      // content that leaves the browser.
      // `sourceFile` is on because this app HAS the build plugin, so the file composes its
      // fingerprints — and the parts invariant means what composed the identity is what
      // explains a later drift in it.
      optIn={{ componentChain: true, role: true, sourceFile: true }}
    >
      <App />
    </RastroProvider>
  </StrictMode>,
);
