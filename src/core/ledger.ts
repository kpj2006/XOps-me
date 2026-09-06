/**
 * Exactly-once has to come from somewhere.
 *
 * Some rails give it natively: EIP-3009 consumes a nonce, so a replayed
 * authorization reverts and a retry is a no-op. Safe's AllowanceModule does not
 * — on the `msg.sender == delegate` path it checks caller identity only and
 * never compares the nonce against a stored value, so an identical second call
 * transfers again while the allowance has headroom.
 *
 * For a rail like that, a ledger supplies what the chain will not: a durable
 * record, keyed by the canonical idempotency key, that a later run can find.
 *
 * Core defines only the shape. It never learns where the record is kept.
 */

export interface LedgerEntry {
  /** Rail transaction identifier, when the settlement produced one. */
  transaction?: string | undefined;
  /** Human-followable link to the settlement. */
  explorerUrl?: string | undefined;
  /** When the entry was written, ISO 8601. */
  settledAt?: string | undefined;
}

export interface SettlementLedger {
  readonly id: string;
  /** A prior settlement for this key, or undefined if there is none. */
  lookup(key: string): Promise<LedgerEntry | undefined>;
  /** Records a settlement so a later run finds it instead of paying again. */
  record(key: string, entry: LedgerEntry): Promise<void>;
}

/**
 * A ledger lookup narrows a race, it does not close one. Two runs can both look
 * up, both miss, and both settle. Anything driving a non-idempotent rail needs
 * mutual exclusion around the whole check-settle-record sequence — for GitHub
 * Actions that is a `concurrency:` group keyed on the payout.
 */
export const LEDGER_RACE_WARNING =
  "A ledger lookup is check-then-act. Serialize payouts with a concurrency group.";
