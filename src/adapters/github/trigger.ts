import { XOpsError } from "../../core/errors.js";

/**
 * L0 TRIGGER. Turns a PR comment into the makings of an Intent.
 *
 * Knows nothing about chains, tokens or addresses — the recipient is an opaque
 * string for a resolver to interpret, and the amount stays as the human typed it
 * until something that knows the asset's decimals converts it (I1, I4).
 */
export interface SendCommand {
  /** Opaque payout identity, verbatim. Never validated as an address here. */
  recipient: string;
  /** Decimal amount as typed. Not yet atomic units. */
  amount: string;
  /** Asset symbol if the author named one, otherwise undefined. */
  asset: string | undefined;
}

const SEND_LINE = /^\s*\/send\b(.*)$/;
/** `10`, `2.5`, or `10usdc` with the symbol run onto the number. */
const AMOUNT_WITH_ASSET = /^([0-9]+(?:\.[0-9]+)?)\s*([a-zA-Z][a-zA-Z0-9]{0,11})?$/;
const ASSET = /^[a-zA-Z][a-zA-Z0-9]{0,11}$/;

const USAGE = "usage: `/send <recipient> <amount> [asset]` — e.g. `/send 0xabc…def 10 USDC`";

/**
 * Finds a `/send` command anywhere in a comment body.
 *
 * Returns `undefined` when the comment simply isn't a command — that is the
 * common case and not an error. Throws only when a line *is* a `/send` but
 * cannot be read, because silently misreading an amount is far worse than
 * refusing it.
 */
export function parseSendCommand(body: string): SendCommand | undefined {
  for (const line of body.split(/\r?\n/)) {
    const match = SEND_LINE.exec(line);
    if (!match) continue;

    const tokens = (match[1] ?? "").trim().split(/\s+/).filter(Boolean);
    if (tokens.length < 2) {
      throw new Error(`\`/send\` needs a recipient and an amount. ${USAGE}`);
    }
    if (tokens.length > 3) {
      throw new Error(
        `\`/send\` got ${tokens.length} arguments and expected at most 3. ${USAGE}`,
      );
    }

    const [recipient, second, third] = tokens as [string, string, string?];

    const amountMatch = AMOUNT_WITH_ASSET.exec(second);
    if (!amountMatch) {
      throw new Error(`"${second}" is not a valid amount. ${USAGE}`);
    }
    const [, amount, attachedAsset] = amountMatch as unknown as [string, string, string?];

    if (attachedAsset && third) {
      throw new Error(
        `the asset was given twice, as "${attachedAsset}" and "${third}". ${USAGE}`,
      );
    }

    const asset = attachedAsset ?? third;
    if (asset !== undefined && !ASSET.test(asset)) {
      throw new Error(`"${asset}" is not a valid asset symbol. ${USAGE}`);
    }

    return { recipient, amount, asset };
  }

  return undefined;
}

/**
 * Author associations GitHub reports for people who can be trusted to spend the
 * project's money. Everything else — CONTRIBUTOR, FIRST_TIME_CONTRIBUTOR, NONE —
 * is denied, so a drive-by commenter cannot trigger a payout to themselves.
 *
 * This is L1 POLICY and it is evaluated offline, before anything reaches a driver.
 */
const MAINTAINER_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

export function assertMaintainer(association: string | undefined): void {
  const value = (association ?? "").trim().toUpperCase();
  if (!MAINTAINER_ASSOCIATIONS.has(value)) {
    throw new XOpsError(
      "POLICY_DENIED",
      `\`/send\` is restricted to maintainers. Author association was "${association ?? "unknown"}".`,
      { association: association ?? null },
    );
  }
}
