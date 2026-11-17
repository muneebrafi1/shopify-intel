/**
 * Removal form rules, shared by the server-side form handler (src/pages/opt-out/index.astro)
 * and the progressive-enhancement script, so both show the same messages. The API
 * (POST /api/v1/removal-requests) validates again; these rules match its schema.
 */
import { normalizeDomain } from '~/server/lib/slug';

/**
 * What a request can ask for. OWNER: draft — a screenshots-only removal also stops future
 * captures of that store (owner decision, 17 Nov 2026).
 */
export const SCOPES = [
  {
    value: 'store',
    label: 'Everything',
    hint: 'Hide the store everywhere, delete its screenshots and never scan it again.',
    short: 'Everything',
  },
  {
    value: 'screenshots',
    label: 'Screenshots only',
    hint: 'Delete its screenshots and stop all future captures. The theme and apps we detected stay listed.',
    short: 'Screenshots only',
  },
  {
    value: 'details',
    label: 'Correct a detail',
    hint: 'Something we show is wrong, such as the theme, an app or the store name. Nothing is removed.',
    short: 'Correction',
  },
] as const;
export type Scope = (typeof SCOPES)[number]['value'];

export const REASON_MIN = 10;
export const REASON_MAX = 2000;

export interface RemovalValues {
  domain: string;
  email: string;
  name: string;
  scope: Scope;
  reason: string;
  owner: boolean;
  website: string;
}

export type RemovalField = 'domain' | 'email' | 'name' | 'scope' | 'reason' | 'owner';
export type RemovalErrors = Partial<Record<RemovalField, string>>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isScope(value: unknown): value is Scope {
  return SCOPES.some((s) => s.value === value);
}

export function scopeLabel(value: string): string {
  return SCOPES.find((s) => s.value === value)?.short ?? 'Everything';
}

export { normalizeDomain };

/** Validate one field; returns the message to show, or null. */
export function validateField(field: RemovalField, v: RemovalValues): string | null {
  switch (field) {
    case 'domain':
      if (!v.domain.trim()) return 'Enter the store’s domain, like example.com.';
      if (!normalizeDomain(v.domain))
        return 'That doesn’t look like a domain. Try something like example.com.';
      return null;
    case 'email':
      if (!v.email.trim()) return 'Enter an email address so we can reply.';
      if (!EMAIL_RE.test(v.email.trim()) || v.email.length > 254) return 'Check the email address.';
      return null;
    case 'name':
      return v.name.length > 120 ? 'Keep the name under 120 characters.' : null;
    case 'scope':
      return isScope(v.scope) ? null : 'Choose what to remove.';
    case 'reason': {
      const n = v.reason.trim().length;
      if (n === 0) return 'Tell us briefly why. A sentence is enough.';
      if (n < REASON_MIN) return `A little more, please: at least ${REASON_MIN} characters.`;
      if (n > REASON_MAX) return `Keep it under ${REASON_MAX.toLocaleString('en-US')} characters.`;
      return null;
    }
    case 'owner':
      return v.owner ? null : 'Confirm that you own or manage this store.';
  }
}

export const FIELD_ORDER: RemovalField[] = ['domain', 'email', 'name', 'scope', 'reason', 'owner'];

export function validateRemoval(v: RemovalValues): RemovalErrors {
  const errors: RemovalErrors = {};
  for (const f of FIELD_ORDER) {
    const message = validateField(f, v);
    if (message) errors[f] = message;
  }
  return errors;
}

export function valuesFromForm(form: FormData): RemovalValues {
  const str = (k: string) => {
    const value = form.get(k);
    return typeof value === 'string' ? value : '';
  };
  const scope = str('scope');
  return {
    domain: str('domain').slice(0, 300),
    email: str('email').slice(0, 300),
    name: str('name').slice(0, 200),
    scope: isScope(scope) ? scope : 'store',
    reason: str('reason').slice(0, 4000),
    owner: str('owner') === 'yes',
    website: str('website').slice(0, 200),
  };
}

/** Reference ids look like RR-7KQ2M9XD (Crockford base32). */
export function isReference(value: string | null): value is string {
  return !!value && /^RR-[0-9A-HJKMNP-TV-Z]{8}$/.test(value);
}

/** Path of the confirmation state; the email is never put in the URL. */
export function sentPath(reference: string, domain: string, scope: Scope): string {
  const params = new URLSearchParams({ sent: reference, domain, scope });
  return `/opt-out?${params.toString()}`;
}
