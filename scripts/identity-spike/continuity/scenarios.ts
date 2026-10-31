// scripts/identity-spike/continuity/scenarios.ts
// Known edits to the base app, each with the elements whose fingerprint it must change.
//
// The expectations were written from the fingerprint rules BEFORE the harness first ran, and
// each says why. A disagreement means the tooling or the rules are not what we think — found
// here, on an app whose answer we know, instead of in corpus numbers nobody can check. Never
// "fix" an expectation to match a run without being able to say which rule produced it.
//
// Elements (`data-el` in app/src):
//   nav-home, nav-help  App > NavBar                                         (shallow)
//   page-docs           App > SettingsPage                                   (shallow)
//   email               App > SettingsPage > ProfilePanel > ProfileForm      (exactly 4)
//   save                … > ProfilePanel > ProfileForm > Toolbar > SaveButton (6: capped at 4)
//   cancel              … > ProfilePanel > ProfileForm > Toolbar > CancelButton
//   pref-dark           Switch, inside Row, inside PreferenceRow — which writes no host element
import type { Files, Strategy } from './harness.js';

export interface Scenario {
  name: string;
  description: string;
  edit: (files: Files) => Map<string, string>;
  /** Elements whose fingerprint must change, per strategy. Every other element must not. */
  changes: Record<Strategy, string[]>;
}

/** Replace exactly one occurrence, or fail: an edit that silently missed tests nothing. */
function replace(files: Map<string, string>, path: string, from: string, to: string): void {
  const source = files.get(path);
  if (source === undefined) throw new Error(`no such file: ${path}`);
  const count = source.split(from).length - 1;
  if (count !== 1) throw new Error(`expected one "${from}" in ${path}, found ${count}`);
  files.set(path, source.replace(from, to));
}

const edit =
  (apply: (files: Map<string, string>) => void) =>
  (files: Files): Map<string, string> => {
    const copy = new Map(files);
    apply(copy);
    return copy;
  };

const everywhere = (elements: string[]): Record<Strategy, string[]> => ({
  'attribute+file': elements,
  attribute: elements,
  fiber: elements,
});

export const SCENARIOS: Scenario[] = [
  {
    name: 'rebuild',
    description: 'No source change. Fingerprints must be deterministic across builds.',
    edit: edit(() => {}),
    changes: everywhere([]),
  },
  {
    name: 'heading-copy',
    description: 'Edit text no interactive element is named by. Nothing interactive changes.',
    edit: edit((f) => replace(f, 'src/settings/SettingsPage.tsx', '<h1>Settings</h1>', '<h1>Account settings</h1>')),
    changes: everywhere([]),
  },
  {
    name: 'provider-wrapper',
    description: 'Wrap the whole app in a ThemeProvider that renders a <div>. NOISE drops *Provider names.',
    edit: edit((f) => {
      f.set(
        'src/ThemeProvider.tsx',
        `import type { ReactNode } from 'react';\n\nexport function ThemeProvider({ children }: { children: ReactNode }) {\n  return <div className="theme">{children}</div>;\n}\n`,
      );
      replace(f, 'src/App.tsx', "import { NavBar } from './NavBar.js';", "import { NavBar } from './NavBar.js';\nimport { ThemeProvider } from './ThemeProvider.js';");
      replace(f, 'src/App.tsx', '<main>', '<ThemeProvider>\n      <main>');
      replace(f, 'src/App.tsx', '</main>', '</main>\n      </ThemeProvider>');
    }),
    changes: everywhere([]),
  },
  {
    name: 'layout-wrapper',
    description:
      'Insert a Layout component between App and SettingsPage. Chains keep the 4 innermost ' +
      'components, so only elements with fewer than 4 below Layout change.',
    edit: edit((f) => {
      f.set(
        'src/Layout.tsx',
        `import type { ReactNode } from 'react';\n\nexport function Layout({ children }: { children: ReactNode }) {\n  return <div className="layout">{children}</div>;\n}\n`,
      );
      replace(f, 'src/App.tsx', "import { NavBar } from './NavBar.js';", "import { Layout } from './Layout.js';\nimport { NavBar } from './NavBar.js';");
      replace(f, 'src/App.tsx', '<SettingsPage />', '<Layout>\n        <SettingsPage />\n      </Layout>');
    }),
    changes: {
      // DOM walk: pref-dark's stamps are Switch, Row, SettingsPage, App, so Layout enters its
      // four. save and cancel already fill four below ProfilePanel.
      'attribute+file': ['email', 'page-docs', 'pref-dark'],
      attribute: ['email', 'page-docs', 'pref-dark'],
      // Fiber walk: pref-dark's four are Switch, Row, PreferenceRow, SettingsPage. The fiber
      // tree sees PreferenceRow, which the DOM cannot, so the cap keeps Layout out.
      fiber: ['email', 'page-docs'],
    },
  },
  {
    name: 'label-edit',
    description: 'Change the Save button\'s text. The accessible name is in every fingerprint.',
    edit: edit((f) => replace(f, 'src/ui/SaveButton.tsx', '      Save\n', '      Save changes\n')),
    changes: everywhere(['save']),
  },
  {
    name: 'rename-component',
    description: 'Rename Toolbar to ActionBar, in place. It is in the chain of both toolbar buttons.',
    edit: edit((f) => {
      replace(f, 'src/settings/Toolbar.tsx', 'export function Toolbar()', 'export function ActionBar()');
      replace(f, 'src/settings/ProfilePanel.tsx', "import { Toolbar } from './Toolbar.js';", "import { ActionBar } from './Toolbar.js';");
      replace(f, 'src/settings/ProfilePanel.tsx', '<Toolbar />', '<ActionBar />');
    }),
    changes: everywhere(['cancel', 'save']),
  },
  {
    name: 'move-file',
    description: 'Move SaveButton.tsx from ui/ to settings/. Only the file part can see a move.',
    edit: edit((f) => {
      const source = f.get('src/ui/SaveButton.tsx');
      if (source === undefined) throw new Error('src/ui/SaveButton.tsx is missing');
      f.delete('src/ui/SaveButton.tsx');
      f.set('src/settings/SaveButton.tsx', source);
      replace(f, 'src/settings/Toolbar.tsx', "from '../ui/SaveButton.js'", "from './SaveButton.js'");
    }),
    changes: { 'attribute+file': ['save'], attribute: [], fiber: [] },
  },
  {
    name: 'tooltip-wrap',
    description: 'Wrap the Save button in a Tooltip that renders a <span>. A new innermost ancestor.',
    edit: edit((f) => {
      f.set(
        'src/ui/Tooltip.tsx',
        `import type { ReactNode } from 'react';\n\nexport function Tooltip({ children }: { children: ReactNode }) {\n  return <span className="tooltip">{children}</span>;\n}\n`,
      );
      replace(f, 'src/ui/SaveButton.tsx', 'export function SaveButton() {', "import { Tooltip } from './Tooltip.js';\n\nexport function SaveButton() {");
      replace(f, 'src/ui/SaveButton.tsx', '    <button', '    <Tooltip>\n    <button');
      replace(f, 'src/ui/SaveButton.tsx', '</button>', '</button>\n    </Tooltip>');
    }),
    changes: everywhere(['save']),
  },
  {
    name: 'rename-composer',
    description:
      'Rename PreferenceRow, which composes only design-system primitives. Stamping cannot ' +
      'see it, so the attribute chain is blind to the rename; the fiber walk is not.',
    edit: edit((f) => {
      replace(f, 'src/settings/PreferenceRow.tsx', 'export function PreferenceRow(', 'export function SettingRow(');
      replace(f, 'src/settings/SettingsPage.tsx', "import { PreferenceRow } from './PreferenceRow.js';", "import { SettingRow } from './PreferenceRow.js';");
      replace(f, 'src/settings/SettingsPage.tsx', '<PreferenceRow ', '<SettingRow ');
    }),
    changes: { 'attribute+file': [], attribute: [], fiber: ['pref-dark'] },
  },
];
