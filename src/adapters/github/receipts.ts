import type { LedgerEntry, SettlementLedger } from "../../core/ledger.js";

/**
 * The PR conversation is the ledger.
 *
 * XOps is an artifact, not a service — there is no server to keep state in, so
 * the durable record of "this payout already happened" lives where the payout
 * was requested: as a receipt comment on the pull request. A later run finds it
 * by the canonical idempotency key and settles nothing.
 *
 * The key is carried in an HTML comment so it is exact and machine-readable,
 * while the visible body stays legible to whoever reads the thread.
 */

const MARKER = "xops-receipt";
const MARKER_PATTERN = new RegExp(`<!--\\s*${MARKER}:v1\\s+key=(\\S+)\\s*-->`);

export interface Receipt extends LedgerEntry {
  key: string;
}

export function formatReceipt(receipt: Receipt): string {
  const broadcasting = receipt.status === "broadcasting";

  const lines = [
    `<!-- ${MARKER}:v1 key=${receipt.key} -->`,
    broadcasting ? "**XOps — payout broadcasting**" : "**XOps — payout settled**",
    "",
  ];

  if (receipt.transaction) lines.push(`- Transaction: \`${receipt.transaction}\``);
  if (receipt.settledAt) lines.push(`- Settled: ${receipt.settledAt}`);

  lines.push(
    "",
    "This receipt is the idempotency record. While it is present, a re-run of",
    "this payout settles nothing and reports it as already paid.",
  );

  if (broadcasting) {
    lines.push(
      "",
      "It was written **before** broadcasting, so the transaction above may or may",
      "not have landed. Check it on a block explorer. If it never landed, re-run",
      "with `round` bumped to deliberately pay again — XOps will not decide that",
      "for you, because paying twice cannot be undone.",
    );
  }

  return lines.join("\n");
}

/** The key a receipt comment carries, or undefined if the body is not a receipt. */
export function parseReceiptKey(body: string): string | undefined {
  return MARKER_PATTERN.exec(body)?.[1];
}

export interface CommentLike {
  body?: string | null | undefined;
  user?: { login?: string | null | undefined; type?: string | null | undefined } | null | undefined;
  author_association?: string | null | undefined;
}

/**
 * Only receipts written by the automation or by someone who can already spend
 * the project's money are believed.
 *
 * A forged receipt withholds a payment rather than causing one, so this is
 * griefing protection rather than theft protection — but a contributor should
 * not be able to block someone else's payout with a comment.
 */
const TRUSTED_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

export function isTrustedReceiptAuthor(comment: CommentLike): boolean {
  if ((comment.user?.type ?? "") === "Bot") return true;
  return TRUSTED_ASSOCIATIONS.has((comment.author_association ?? "").toUpperCase());
}

/** Finds a trusted receipt for `key` among comments. Pure, so it is testable. */
const TRANSACTION_PATTERN = /^- Transaction: `([^`]+)`/m;

/**
 * A settled payout leaves two comments — the pre-broadcast record and the
 * confirmation. Both carry the same key, so the whole thread is scanned and the
 * strongest status wins. Returning the first match would report a completed
 * payout as still broadcasting, which is safe but wrong, and would send someone
 * to a block explorer for no reason.
 */
export function findReceipt(comments: readonly CommentLike[], key: string): Receipt | undefined {
  let found: Receipt | undefined;

  for (const comment of comments) {
    const body = comment.body ?? "";
    if (parseReceiptKey(body) !== key) continue;
    if (!isTrustedReceiptAuthor(comment)) continue;

    const transaction = TRANSACTION_PATTERN.exec(body)?.[1];
    const receipt: Receipt = {
      key,
      // An unconfirmed record still blocks a re-pay. Reading it as anything
      // weaker would reintroduce the double-payment window it exists to close.
      status: body.includes("payout settled") ? "settled" : "broadcasting",
      ...(transaction === undefined ? {} : { transaction }),
    };

    if (receipt.status === "settled") return receipt;
    found ??= receipt;
  }

  return found;
}

export interface PullRequestRef {
  /** `owner/repo`. */
  repo: string;
  /** Issue or PR number. */
  number: number;
  token: string;
  apiBase?: string;
}

async function githubJson(url: string, token: string): Promise<CommentLike[]> {
  const response = await fetch(url, {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
      "user-agent": "xops",
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub API ${response.status} for ${url}`);
  }
  return (await response.json()) as CommentLike[];
}

/**
 * A ledger backed by the PR's comments.
 *
 * `lookup` pages through every comment: a receipt buried under later discussion
 * still has to be found, because missing it means paying twice.
 */
export class PullRequestReceiptLedger implements SettlementLedger {
  readonly id = "github-pr-receipt";
  private readonly ref: PullRequestRef;

  constructor(ref: PullRequestRef) {
    this.ref = ref;
  }

  private base(): string {
    const api = this.ref.apiBase ?? "https://api.github.com";
    return `${api}/repos/${this.ref.repo}/issues/${this.ref.number}/comments`;
  }

  async lookup(key: string): Promise<LedgerEntry | undefined> {
    for (let page = 1; page <= 20; page += 1) {
      const batch = await githubJson(`${this.base()}?per_page=100&page=${page}`, this.ref.token);
      const found = findReceipt(batch, key);
      if (found) return found;
      if (batch.length < 100) return undefined;
    }
    // Bailing out silently would mean paying twice on a very long thread.
    throw new Error(
      `Could not scan all comments on ${this.ref.repo}#${this.ref.number} for a receipt; refusing to settle`,
    );
  }

  private async post(key: string, entry: LedgerEntry): Promise<Response> {
    return fetch(this.base(), {
      method: "POST",
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${this.ref.token}`,
        "content-type": "application/json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "xops",
      },
      body: JSON.stringify({ body: formatReceipt({ key, ...entry }) }),
    });
  }

  /**
   * Called before broadcasting. Throwing here is the safe outcome: nothing has
   * moved, so the payout simply does not happen and can be retried cleanly.
   */
  async record(key: string, entry: LedgerEntry): Promise<void> {
    const response = await this.post(key, entry);
    if (!response.ok) {
      throw new Error(
        `Refusing to broadcast: could not record the payout for ${key} ` +
          `(GitHub API ${response.status}). Nothing was settled.`,
      );
    }
  }

  /**
   * Called after a successful broadcast. Deliberately does not throw — the
   * record written by `record()` already carries the transaction, so a failure
   * here costs legibility only, and turning a settled payout into a reported
   * failure would be far worse than a missing confirmation.
   */
  async confirm(key: string, entry: LedgerEntry): Promise<void> {
    const response = await this.post(key, entry);
    if (!response.ok) {
      console.warn(
        `Payout ${key} settled, but the confirmation comment failed ` +
          `(GitHub API ${response.status}). The earlier record still carries the transaction.`,
      );
    }
  }
}
