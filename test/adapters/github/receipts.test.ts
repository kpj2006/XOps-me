import assert from "node:assert/strict";
import { test } from "node:test";

import {
  findReceipt,
  formatReceipt,
  isTrustedReceiptAuthor,
  parseReceiptKey,
} from "../../../src/adapters/github/receipts.js";

const KEY = "xops:v1|github:kpj2006/demo-XOps#refs/pull/1|0xdead|eip155:11155111|USDC|0";
const BOT = { user: { type: "Bot", login: "github-actions[bot]" } };

test("a formatted receipt round-trips its key", () => {
  const body = formatReceipt({ key: KEY, status: "settled", transaction: "0xabc", settledAt: "2026-09-06T00:00:00Z" });
  assert.equal(parseReceiptKey(body), KEY);
});

test("the key is machine-readable but invisible in the rendered body", () => {
  const body = formatReceipt({ key: KEY, status: "settled" });
  assert.ok(body.startsWith("<!--"), "the marker is an HTML comment");
  assert.ok(body.includes("payout settled"), "and there is something for a human to read");
});

test("an ordinary comment carries no key", () => {
  assert.equal(parseReceiptKey("lgtm"), undefined);
  assert.equal(parseReceiptKey("/send 0xdead 10 USDC"), undefined);
  assert.equal(parseReceiptKey("<!-- unrelated marker -->"), undefined);
});

test("finds a receipt among unrelated conversation", () => {
  const comments = [
    { body: "nice work", ...BOT },
    { body: "/send 0xdead 10 USDC", author_association: "OWNER" },
    { body: formatReceipt({ key: KEY, status: "settled", transaction: "0xabc" }), ...BOT },
    { body: "merging", author_association: "OWNER" },
  ];
  assert.deepEqual(findReceipt(comments, KEY), { key: KEY, status: "settled", transaction: "0xabc" });
});

/**
 * The distinction that matters: a *different* payout's receipt must not be
 * mistaken for this one, or the second contributor never gets paid.
 */
test("a receipt for a different key does not match", () => {
  const other = KEY.replace("refs/pull/1", "refs/pull/2");
  const comments = [{ body: formatReceipt({ key: other, status: "settled" }), ...BOT }];
  assert.equal(findReceipt(comments, KEY), undefined);
  assert.deepEqual(findReceipt(comments, other), { key: other, status: "settled" });
});

test("a round differences makes it a different payout", () => {
  const rerun = `${KEY.slice(0, -1)}1`;
  const comments = [{ body: formatReceipt({ key: KEY, status: "settled" }), ...BOT }];
  assert.equal(findReceipt(comments, rerun), undefined, "round 1 is a deliberate re-pay");
});

test("only bots and people who can already spend are believed", () => {
  assert.ok(isTrustedReceiptAuthor(BOT));
  assert.ok(isTrustedReceiptAuthor({ author_association: "OWNER" }));
  assert.ok(isTrustedReceiptAuthor({ author_association: "collaborator" }));
  assert.ok(!isTrustedReceiptAuthor({ author_association: "CONTRIBUTOR" }));
  assert.ok(!isTrustedReceiptAuthor({ author_association: "NONE" }));
  assert.ok(!isTrustedReceiptAuthor({}));
});

test("a contributor cannot block a payout by forging a receipt", () => {
  const forged = [{ body: formatReceipt({ key: KEY, status: "settled" }), author_association: "CONTRIBUTOR" }];
  assert.equal(findReceipt(forged, KEY), undefined);
});

test("an empty or bodyless comment is skipped rather than throwing", () => {
  assert.equal(findReceipt([{ body: null }, { body: undefined }, {}], KEY), undefined);
});
