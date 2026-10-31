import { PreferenceRow } from './PreferenceRow.js';
import { ProfilePanel } from './ProfilePanel.js';

export function SettingsPage() {
  return (
    <section>
      <h1>Settings</h1>
      <a href="#docs" data-el="page-docs">
        Docs
      </a>
      <ProfilePanel />
      <PreferenceRow label="Dark mode" el="pref-dark" />
    </section>
  );
}
