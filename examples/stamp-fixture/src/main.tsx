// examples/stamp-fixture/src/main.tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowCard,
  ColorList,
  Counter,
  Footer,
  LegacyPanel,
  MemoArrowLink,
  MemoBadge,
  Modal,
  RefInput,
  SettingsRow,
  Toggle,
} from './patterns.js';

function App() {
  return (
    <main>
      <SettingsRow label="Save" />
      <ColorList />
      <Counter />
      <MemoBadge text="new" />
      <ArrowCard title="card" />
      <RefInput name="email" />
      <MemoArrowLink />
      <LegacyPanel heading="legacy" />
      <Toggle on />
      <Toggle on={false} />
      <Footer />
      <Modal />
    </main>
  );
}

const root = document.getElementById('root');
if (root === null) throw new Error('#root is missing from index.html');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
