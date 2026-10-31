import { SaveButton } from '../ui/SaveButton.js';

export function Toolbar() {
  return (
    <div role="toolbar">
      <SaveButton />
      <CancelButton />
    </div>
  );
}

function CancelButton() {
  return (
    <button type="button" data-el="cancel">
      Cancel
    </button>
  );
}
