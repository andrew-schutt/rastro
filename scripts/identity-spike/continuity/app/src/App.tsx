// The continuity base app. Every interactive element carries `data-el`, its ground-truth
// identity, which fingerprints never read. See ../../README.md.
import { NavBar } from './NavBar.js';
import { SettingsPage } from './settings/SettingsPage.js';

export function App() {
  return (
    <main>
      <NavBar />
      <SettingsPage />
    </main>
  );
}
