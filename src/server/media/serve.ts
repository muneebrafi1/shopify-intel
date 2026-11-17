/**
 * Streams captured media from R2 with long-lived immutable caching. Keys are content-addressed
 * (they include the capture timestamp), so a key never changes meaning.
 * Placeholder paths (/media/placeholder/...) are never R2 objects and always 404 here; they are
 * served by their own, more specific routes.
 */
const IMMUTABLE = 'public, max-age=31536000, immutable';

const notFound = () =>
  new Response('Not found', {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=60' },
  });

/** True for keys we will look up in R2. */
export function isServableKey(key: string): boolean {
  return (
    key.length > 0 &&
    key.length <= 512 &&
    !key.startsWith('placeholder/') &&
    !key.startsWith('/') &&
    !key.split('/').some((part) => part === '' || part === '.' || part === '..')
  );
}

export async function serveMedia(
  bucket: R2Bucket,
  key: string,
  request: Request,
): Promise<Response> {
  if (!isServableKey(key)) return notFound();
  const head = request.method === 'HEAD';
  const object = await bucket.get(key, { onlyIf: request.headers });
  if (!object) return notFound();

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('ETag', object.httpEtag);
  headers.set('Cache-Control', IMMUTABLE);
  headers.set('X-Content-Type-Options', 'nosniff');
  // A failed precondition (If-None-Match matched) returns the object without a body.
  if (!('body' in object)) return new Response(null, { status: 304, headers });
  headers.set('Content-Length', String(object.size));
  return new Response(head ? null : object.body, { status: 200, headers });
}
