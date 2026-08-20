import type { IdempotencyKey, Intent } from "./types.js";

/**
 * Returns a canonical string. No hashing, no rail primitives — a driver derives
 * its rail's replay token from this string.
 *
 * `amount` is excluded on purpose: with amount in the key, `/send alice 50`
 * corrected to `/send alice 500` yields two keys and Alice receives 550.
 * Excluded, the correction collides and requires an explicit `round` bump.
 */
export function canonical(k: IdempotencyKey): string {
  return (
    `xops:v${k.v}|${k.source.platform}:${k.source.repo}#${k.source.ref}` +
    `|${k.recipient.toLowerCase()}|${k.network}|${k.asset}|${k.round}`
  );
}

export function keyFor(intent: Intent): IdempotencyKey {
  const { source } = intent;
  return {
    v: 1,
    source: {
      platform: source.platform,
      repo: source.platform === "github" ? source.repo : source.project,
      ref: source.ref,
    },
    recipient: intent.recipient,
    asset: intent.asset,
    network: intent.network,
    round: intent.round,
  };
}
