// packages/core/src/redact.test.ts
import { describe, expect, it } from 'vitest';
import { REDACTED, redact } from './redact.js';

describe('redact', () => {
  it('strips an email out of an accessible name', () => {
    expect(redact('Delete account for jane@x.com')).toBe(`Delete account for ${REDACTED}`);
  });

  it('strips long digit runs', () => {
    expect(redact('Order 100482931')).toBe(`Order ${REDACTED}`);
  });

  it('leaves ordinary labels alone', () => {
    expect(redact('Save Profile')).toBe('Save Profile');
  });

  it.todo('tokenizes ids out of url.path (/users/42/settings → /users/:id/settings)');
  it.todo('supports an allow/deny model per attribute rather than one blanket pass');
  it.todo('exposes a noopRedactor for trusted internal apps');
});
