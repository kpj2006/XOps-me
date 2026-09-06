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
  const lines = [
    `<!-- ${MARKER}:v1 key=${receipt.key} -->`,
    "**XOps — payout settled**",
    "",
  ];

  if (receipt.transaction) lines.push(`- Transaction: \`${receipt.transaction}\``);
  if (receipt.explorerUrl) lines.push(`- Explorer: ${receipt.explorerUrl}`);
  if (receipt.settledAt) lines.push(`- Settled: ${receipt.settledAt}`);

  lines.push(
    "",
    "This receipt is the idempotency record. While it is present, a re-run of",
    "this payout settles nothing and reports it as already paid.",
  );

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
export function findReceipt(comments: readonly CommentLike[], key: string): Receipt | undefined {
  for (const comment of comments) {
    const body = comment.body ?? "";
    if (parseReceiptKey(body) !== key) continue;
    if (!isTrustedReceiptAuthor(comment)) continue;
    return { key };
  }
  return undefined;
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

  async record(key: string, entry: LedgerEntry): Promise<void> {
    const response = await fetch(this.base(), {
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
    if (!response.ok) {
      throw new Error(
        `Failed to write the receipt for ${key}: GitHub API ${response.status}. ` +
          "The payout settled but is unrecorded, so a re-run would pay again.",
      );
    }
  }
}
