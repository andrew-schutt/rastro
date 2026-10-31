import { Toolbar } from './Toolbar.js';

export function ProfilePanel() {
  return (
    <div className="panel">
      <ProfileForm />
    </div>
  );
}

function ProfileForm() {
  return (
    <form>
      <input type="email" aria-label="Email" data-el="email" />
      <Toolbar />
    </form>
  );
}
