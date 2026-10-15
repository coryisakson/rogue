import { createRequire } from 'node:module';
import { dedupeFindings, isQrCandidate, type QrFinding } from '@rogue/core';

/**
 * Find QR codes in a PDF by decoding its embedded square images (a QR code in a rulebook is an image).
 * Best effort: any failure returns what was found so far and never blocks ingest.
 * pdfjs-dist is used directly (not via unpdf) because it exposes the decoded image pixels per page.
 */
export async function scanPdfForQr(bytes: Uint8Array, budgetMs = 90_000): Promise<{ findings: QrFinding[]; scanned: number; error?: string }> {
  const started = Date.now();
  const found: QrFinding[] = [];
  let scanned = 0;
  let savedWorker: unknown;
  try {
    // unpdf registers its own (older) pdf.js worker globally; pdf.js then refuses to run with a different API version.
    // Hide it while we run our own copy, then put it back for unpdf.
    savedWorker = (globalThis as any).pdfjsWorker;
    delete (globalThis as any).pdfjsWorker;
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const jsQR = (await import('jsqr')).default;
    // JPEG2000 images (common in print-ready rulebooks) need the OpenJPEG wasm shipped next to the package.
    const pkgDir = createRequire(import.meta.url).resolve('pdfjs-dist/package.json').replace(/package\.json$/, '');
    const task = pdfjs.getDocument({ data: new Uint8Array(bytes), wasmUrl: `${pkgDir}wasm/`, verbosity: 0 });
    const pdf = await task.promise;
    const seenImages = new Set<string>();
    for (let p = 1; p <= pdf.numPages && Date.now() - started < budgetMs; p++) {
      const page = await pdf.getPage(p);
      const ops = await page.getOperatorList();
      for (let i = 0; i < ops.fnArray.length; i++) {
        if (ops.fnArray[i] !== pdfjs.OPS.paintImageXObject) continue;
        const [id, w, h] = ops.argsArray[i] as [string, number, number];
        if (!isQrCandidate(w, h) || seenImages.has(id)) continue;
        seenImages.add(id);
        const img = await Promise.race([
          new Promise<any>((res) => page.objs.get(id, res)),
          new Promise<null>((res) => setTimeout(() => res(null), 2000)),
        ]);
        if (!img?.data) continue;
        const rgba = toRgba(img.data as Uint8Array, img.width, img.height);
        if (!rgba) continue;
        scanned++;
        const hit = jsQR(rgba, img.width, img.height, { inversionAttempts: 'attemptBoth' });
        if (hit?.data) found.push({ url: hit.data, page: p });
      }
      page.cleanup();
    }
    await task.destroy();
    return { findings: dedupeFindings(found), scanned };
  } catch (e) {
    return { findings: dedupeFindings(found), scanned, error: (e as Error).message };
  } finally {
    if (savedWorker) (globalThis as any).pdfjsWorker = savedWorker;
  }
}

/** pdf.js hands back RGB or RGBA depending on the image; jsQR needs RGBA. Other layouts are skipped. */
function toRgba(data: Uint8Array, w: number, h: number): Uint8ClampedArray | null {
  const out = new Uint8ClampedArray(w * h * 4);
  if (data.length === w * h * 4) { out.set(data); return out; }
  if (data.length === w * h * 3) {
    for (let s = 0, d = 0; s < data.length; s += 3, d += 4) { out[d] = data[s]; out[d + 1] = data[s + 1]; out[d + 2] = data[s + 2]; out[d + 3] = 255; }
    return out;
  }
  return null;
}
