import { createPublicKey, verify } from 'node:crypto';

/** DER prefix that wraps a raw 32-byte Ed25519 public key into the SPKI form node:crypto understands. */
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const HEX = /^[0-9a-f]+$/i;

/** Discord signs `timestamp + rawBody`; replayed requests older than this are rejected. */
export const MAX_SKEW_SECONDS = 300;

/**
 * Verifies a Discord interactions request. Never throws: any malformed input is simply "not valid".
 * `body` must be the RAW request text (re-serialised JSON would not match the signature).
 * `nowSeconds` is injectable for tests; pass null to skip the freshness check.
 */
export function verifyDiscordSignature(
  publicKeyHex: string, signatureHex: string | null | undefined, timestamp: string | null | undefined, body: string,
  nowSeconds: number | null = Math.floor(Date.now() / 1000),
): boolean {
  try {
    if (!signatureHex || !timestamp) return false;
    if (!HEX.test(publicKeyHex) || publicKeyHex.length !== 64) return false;
    if (!HEX.test(signatureHex) || signatureHex.length !== 128) return false;
    if (nowSeconds !== null) {
      const ts = Number(timestamp);
      if (!Number.isFinite(ts) || Math.abs(nowSeconds - ts) > MAX_SKEW_SECONDS) return false;
    }
    const key = createPublicKey({ key: Buffer.concat([SPKI_PREFIX, Buffer.from(publicKeyHex, 'hex')]), format: 'der', type: 'spki' });
    return verify(null, Buffer.from(timestamp + body), key, Buffer.from(signatureHex, 'hex'));
  } catch {
    return false;
  }
}
