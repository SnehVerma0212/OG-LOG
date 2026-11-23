import { zipSync, type AsyncTerminable, type AsyncZipOptions, type AsyncZippable, type FlateCallback } from 'fflate/browser';

// `fflate` as used by the Excel export (vite.config.ts points `fflate` here).
// Its asynchronous zip() compresses any file over 160 kB in a Web Worker built
// from a blob: URL, which the site's Content Security Policy rightly blocks,
// so large workbooks would fail to export. This zip() compresses on the page
// instead (briefly blocking it) and keeps the same callback contract.
export * from 'fflate/browser';

export function zip(data: AsyncZippable, cb: FlateCallback): AsyncTerminable;
export function zip(data: AsyncZippable, opts: AsyncZipOptions, cb: FlateCallback): AsyncTerminable;
export function zip(data: AsyncZippable, optsOrCb: AsyncZipOptions | FlateCallback, maybeCb?: FlateCallback): AsyncTerminable {
  const cb = typeof optsOrCb === 'function' ? optsOrCb : maybeCb!;
  const opts = typeof optsOrCb === 'function' ? {} : optsOrCb;
  let cancelled = false;
  queueMicrotask(() => {
    if (cancelled) {
      return;
    }
    type Result = Parameters<FlateCallback>[1];
    let result: Result;
    try {
      // Same shape as zip()'s input; the async-only options are not used here.
      result = zipSync(data as Parameters<typeof zipSync>[0], opts) as Result;
    } catch (error) {
      cb(error as Parameters<FlateCallback>[0], null as unknown as Result);
      return;
    }
    cb(null, result);
  });
  return () => {
    cancelled = true;
  };
}
