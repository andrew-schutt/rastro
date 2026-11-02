import { Picker } from '../../vendor/picker.js';

// Composes only the library, so it writes no host element and stamping cannot see it.
export function ThemePicker() {
  return <Picker label="Theme" el="pick-theme" />;
}
