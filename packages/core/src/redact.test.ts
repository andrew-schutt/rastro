// packages/core/src/redact.test.ts
import { describe, expect, it } from 'vitest';
import { PATH_PARAM, REDACTED, noopRedactor, redact, tokenizePath } from './redact.js';

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

  it.todo('supports an allow/deny model per attribute rather than one blanket pass');
});

describe('tokenizePath', () => {
  it('tokenizes a numeric id', () => {
    expect(tokenizePath('/users/42/settings')).toBe(`/users/${PATH_PARAM}/settings`);
  });

  it('tokenizes a UUID', () => {
    expect(tokenizePath('/orders/5f2c8b1e-9a3d-4c7f-8e21-0b6d4a9f3c17')).toBe(
      `/orders/${PATH_PARAM}`,
    );
  });

  it('tokenizes the §4.9 example: an email in the path', () => {
    expect(tokenizePath('/users/john@example.com/settings')).toBe(
      `/users/${PATH_PARAM}/settings`,
    );
  });

  it('tokenizes an ObjectId / hex token', () => {
    expect(tokenizePath('/docs/507f1f77bcf86cd799439011')).toBe(`/docs/${PATH_PARAM}`);
  });

  it('tokenizes a nanoid-shaped segment', () => {
    expect(tokenizePath('/p/V1StGXR8Z5jdHi6B')).toBe(`/p/${PATH_PARAM}`);
  });

  it('drops the query string — ?token= is the highest-yield leak', () => {
    expect(tokenizePath('/reset?token=abc123&email=jane@x.com')).toBe('/reset');
  });

  it('drops the fragment', () => {
    expect(tokenizePath('/callback#access_token=abc123')).toBe('/callback');
  });

  it('leaves static route names alone', () => {
    expect(tokenizePath('/settings/profile')).toBe('/settings/profile');
  });

  it('leaves a short versioned segment alone', () => {
    expect(tokenizePath('/v1/logs')).toBe('/v1/logs');
  });

  it('is idempotent — an already-tokenized path is unchanged', () => {
    const tokenized = tokenizePath('/users/42/settings');

    expect(tokenizePath(tokenized)).toBe(tokenized);
  });

  it('preserves a RouteAdapter param name rather than flattening it to :id', () => {
    expect(tokenizePath('/users/:userId/settings')).toBe('/users/:userId/settings');
  });

  it('handles the root path', () => {
    expect(tokenizePath('/')).toBe('/');
  });

  it('handles an empty path', () => {
    expect(tokenizePath('')).toBe('/');
  });

  // The honest limit, asserted so it is a visible decision rather than a silent hole.
  // Fixing these needs the RouteAdapter seam (§4.6), not a cleverer regex.
  it('KNOWN GAP: does not catch a username, which has no identifier shape', () => {
    expect(tokenizePath('/users/johndoe')).toBe('/users/johndoe');
  });

  it('KNOWN GAP: does not catch a content slug', () => {
    expect(tokenizePath('/posts/my-great-post')).toBe('/posts/my-great-post');
  });
});

describe('noopRedactor', () => {
  it('leaves text and paths untouched for a trusted internal app', () => {
    expect(noopRedactor.redact('jane@x.com')).toBe('jane@x.com');
    expect(noopRedactor.tokenizePath('/users/42')).toBe('/users/42');
  });
});
