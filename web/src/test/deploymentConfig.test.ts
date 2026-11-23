import { describe, expect, it } from 'vitest';

import headers from '../../public/_headers?raw';
import indexHtml from '../../index.html?raw';
import wranglerConfig from '../../wrangler.jsonc?raw';
import worker from '../../worker/index';

// The static-host configuration shipped with the build (public/_headers).
const policy = headers.match(/Content-Security-Policy: (.+)/)?.[1] ?? '';
const directive = (name: string) => policy.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name} `)) ?? '';

describe('deployment security headers', () => {
  it('only runs the app’s own scripts', () => {
    expect(directive('script-src')).toBe("script-src 'self'");
    expect(policy).not.toMatch(/unsafe-inline|unsafe-eval/);
    expect(directive('object-src')).toBe("object-src 'none'");
  });

  it('allows network and images only from the app and Supabase', () => {
    expect(directive('connect-src')).toBe("connect-src 'self' https://*.supabase.co");
    expect(directive('img-src')).toBe("img-src 'self' blob: data: https://*.supabase.co"); // data: for the authenticator QR code
  });

  it('cannot be framed and sends no referrer', () => {
    expect(directive('frame-ancestors')).toBe("frame-ancestors 'none'");
    expect(headers).toContain('X-Frame-Options: DENY');
    expect(headers).toContain('Referrer-Policy: no-referrer');
  });

  it('keeps the page free of inline scripts the policy would block', () => {
    const scripts = [...indexHtml.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
    expect(scripts.length).toBeGreaterThan(0);
    for (const [, attributes, body] of scripts) {
      expect(attributes).toMatch(/\bsrc=/);
      expect(body!.trim()).toBe('');
    }
  });
});

// Cloudflare Workers static assets (wrangler.jsonc + worker/index.ts).
const wrangler = JSON.parse(wranglerConfig.replace(/^\s*\/\/.*$/gm, '')) as {
  name: string;
  main: string;
  compatibility_date: string;
  assets: { directory: string; not_found_handling: string; run_worker_first?: unknown };
};

describe('Cloudflare routing', () => {
  it('serves the app for direct visits to browser routes (single-page fallback)', () => {
    expect(wrangler.name).toBe('oglog-beta');
    expect(wrangler.assets).toEqual({ directory: './dist', not_found_handling: 'single-page-application' });
    // Navigation requests must reach the asset layer before the Worker
    // (assets_navigation_prefers_asset_serving, default from 2025-04-01).
    expect(wrangler.compatibility_date >= '2025-04-01').toBe(true);
    expect(wrangler.assets.run_worker_first).toBeUndefined();
  });

  it('answers 404 for other requests that match no file, without HTML', async () => {
    expect(wrangler.main).toBe('worker/index.ts');
    const response = await worker.fetch();
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-security-policy')).toBe("default-src 'none'; frame-ancestors 'none'");
    expect(await response.text()).toBe('Not found');
  });
});
