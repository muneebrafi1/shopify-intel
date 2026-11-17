/** Small, strict readers for admin form posts (plain HTML forms, no client JS required). */

export class FormError extends Error {
  constructor(readonly flash: string) {
    super(flash);
    this.name = 'FormError';
  }
}

/** Trimmed text or '' (never null). Throws when longer than `max`. */
export function text(form: FormData, name: string, max = 500): string {
  const raw = form.get(name);
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (value.length > max) throw new FormError('too_long');
  return value;
}

/** Text or null when empty. */
export const optionalText = (form: FormData, name: string, max = 500): string | null =>
  text(form, name, max) || null;

export function int(form: FormData, name: string): number | null {
  const value = text(form, name, 20);
  if (!/^\d{1,12}$/.test(value)) return null;
  return Number(value);
}

export const checkbox = (form: FormData, name: string): boolean => {
  const v = form.get(name);
  return v === 'on' || v === '1' || v === 'true' || v === 'yes';
};

export function oneOf<T extends string>(form: FormData, name: string, allowed: readonly T[]): T | null {
  const value = text(form, name, 64);
  return (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

/** An absolute https URL (affiliate links, official URLs), or throws. */
export function httpsUrl(form: FormData, name: string, max = 2000): string {
  const value = text(form, name, max);
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !url.hostname.includes('.')) throw new Error('bad');
    if (url.username || url.password) throw new Error('credentials in URL');
    return url.toString();
  } catch {
    throw new FormError('bad_url');
  }
}

/**
 * Reads a form post, refusing oversize bodies (admin forms are tiny). The Origin check already
 * ran in the middleware.
 */
export async function readForm(request: Request, maxBytes = 32 * 1024): Promise<FormData> {
  const length = Number(request.headers.get('content-length') ?? '0');
  if (length > maxBytes) throw new FormError('too_long');
  const type = request.headers.get('content-type') ?? '';
  if (!/^(application\/x-www-form-urlencoded|multipart\/form-data)/i.test(type)) {
    throw new FormError('bad_request');
  }
  return request.formData();
}
