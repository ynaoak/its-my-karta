import type { Env } from './types';

export const SITE_ORIGIN = 'https://yondetotte.oshi-katsu.com';

export async function publicPage(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const noindex = url.origin !== SITE_ORIGIN || url.searchParams.has('room');
  if (url.pathname === '/index.html') {
    const headers = new Headers({ Location: `${url.origin}/${url.search}` });
    if (noindex) headers.set('X-Robots-Tag', 'noindex, nofollow');
    return new Response(null, { status: 308, headers });
  }
  if (url.pathname === '/robots.txt' && url.origin !== SITE_ORIGIN) {
    return new Response(req.method === 'HEAD' ? null : 'User-agent: *\nDisallow: /\n', {
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Robots-Tag': 'noindex, nofollow' },
    });
  }
  const asset = await env.ASSETS.fetch(req);
  const headers = new Headers(asset.headers);
  if (url.pathname === '/sitemap.xml')
    headers.set('Content-Type', 'application/xml; charset=utf-8');
  if (url.pathname === '/robots.txt') headers.set('Content-Type', 'text/plain; charset=utf-8');
  if (noindex) {
    headers.set('X-Robots-Tag', 'noindex, nofollow');
    headers.set('Cache-Control', 'no-store');
  }
  const rewrite =
    noindex &&
    req.method === 'GET' &&
    asset.status === 200 &&
    headers.get('Content-Type')?.includes('text/html');
  if (rewrite) {
    headers.delete('Content-Length');
    headers.delete('ETag');
  }
  let response = new Response(asset.body, {
    status: asset.status,
    statusText: asset.statusText,
    headers,
  });
  if (rewrite) {
    response = new HTMLRewriter()
      .on('meta[name="robots"]', {
        element(element) {
          element.setAttribute('content', 'noindex, nofollow');
        },
      })
      .transform(response);
  }
  return response;
}
