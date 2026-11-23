// Cloudflare Worker for OG-LOG's static site. The asset layer answers every
// request that matches a built file, and every page navigation (with the
// single-page-application fallback to index.html). Only requests that are
// neither reach this code, e.g. a script, image or fetch for a missing file:
// they get a plain 404 instead of the HTML page. No data is read or logged.

const NOT_FOUND_HEADERS: Record<string, string> = {
  'content-type': 'text/plain; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
};

export default {
  async fetch(): Promise<Response> {
    return new Response('Not found', { status: 404, headers: NOT_FOUND_HEADERS });
  },
};
