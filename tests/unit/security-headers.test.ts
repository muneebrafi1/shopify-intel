import { describe, expect, it } from 'vitest';
import { withAdminHeaders, withSecurityHeaders } from '../../src/server/auth/guard.ts';

describe('withSecurityHeaders', () => {
  it('adds baseline headers to public responses', () => {
    const res = withSecurityHeaders(new Response('ok', { status: 200 }));
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(res.headers.get('x-frame-options')).toBe('SAMEORIGIN');
  });

  it('handles immutable redirect responses without throwing', () => {
    const redir = Response.redirect('https://example.test/next', 302);
    const res = withSecurityHeaders(redir);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://example.test/next');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('SAMEORIGIN');
  });

  it('preserves stricter admin headers from withAdminHeaders', () => {
    const adminRes = withSecurityHeaders(withAdminHeaders(new Response('secret', { status: 200 })));
    expect(adminRes.headers.get('x-frame-options')).toBe('DENY');
    expect(adminRes.headers.get('referrer-policy')).toBe('same-origin');
    expect(adminRes.headers.get('x-content-type-options')).toBe('nosniff');
    expect(adminRes.headers.get('cache-control')).toBe('no-store');
  });
});
