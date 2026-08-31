// examples/demo-app/src/main.tsx
// The whole integration, exactly as the README advertises it.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RastroProvider, otlpExporter } from 'rastro-react';
import { App } from './App.js';

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
    >
      <App />
    </RastroProvider>
  </StrictMode>,
);
