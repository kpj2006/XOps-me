# ROADMAP.md — XOps, 6 Weeks

**Companion files:** `AGENTS.md` (rules) · `REFERENCES.md` (constants, release gate)
**Use:** point your agent at this file. Every week has **Build → Verify → Exit**. Exit criteria are
binary. If a box isn't ticked, the week isn't done — carry it, don't skip it.

---

## Scope

Weeks 1–5 build and harden a single network. Week 6 adds the rest. That ordering is the whole
plan: **multi-chain is only a week's work if the first five weeks made it a config entry.** If
week 6 turns into development, the architecture failed and week 6 is where you find out — which
is why it's last, not first.

| Weeks | Outcome |
|---|---|
| 1–5 | `exact` scheme, Base Sepolia, end-to-end from PR merge, `v1.0.0` tagged |
| 6 | Base mainnet + Monad, docs, CLI, templates |

Non-negotiable: the release gate (`REFERENCES.md` §2.4) closes at the end of week 5. **No second
network before it is green.**

---

## Ground rules — enforced every week from day one

These run on every push starting week 1. They are not a week-5 activity.

| Check | Enforces |
|---|---|
| Grep `src/core` + `src/adapters` for chain imports, hash primitives, addresses | I1 |
| Default config asserts `mode: dry-run` | I5 |
| `npm ls --omit=dev --all` ≤ 2 packages | I11 |
| Rebuild `dist/`, diff against committed | I12 |
| Golden vectors match | signing stability |

**Weekly discipline:** open a PR per unit of work, never commit to main. Every exit criterion
below should be provable by a linked CI run or a linked PR comment, because that is what an
evaluator can check without reading code.

---

## Week 1 — Skeleton and the boundary

The week that decides whether the other five work. Nothing here is glamorous and all of it is
load-bearing.

### Build
- [x] Repo, `action.yml` (`using: node20`), `ncc` bundle pipeline, committed `dist/`
- [x] `src/core/types.ts` — `PaymentRequirements`, `PaymentPayload`, `SettlementResponse`, `Intent`, `IdempotencyKey`, `PayoutTarget`
- [x] `src/core/idempotency.ts` — `canonical()`, returns a **string**, no hashing
- [x] `src/core/errors.ts` — full taxonomy from `REFERENCES.md` §6
- [x] `src/drivers/types.ts` + `registry.ts` with the tier gate
- [x] `src/resolvers/` — interface + inline-address resolver
- [x] `test/drivers/mock/` — in-memory `SettlementDriver`
- [x] **ESLint `no-restricted-imports` + CI grep for I1**

### Verify
- [x] Mock driver settles end-to-end through the registry
- [x] `canonical()` property test: same inputs → same string; `amount` changes → **same** string
- [x] Custodial mock driver **throws** at tier-0 registration (I3)
- [x] Driver with `nativeReplayProtection: false` refuses to settle (I9)
- [x] I1 lint fails on a deliberately added `import { keccak_256 }` in `src/core`

### Exit
- [x] `uses: <org>/xops@dev` runs in a workflow and prints a parsed `Intent`
- [x] Ground-rule checks green on every push
- [x] Runtime dependency count: **0** (nothing needs noble yet)

> The last line is the tell. If week 1 needs a crypto library, the boundary is already wrong.

**Evidence:** PR [#1](https://github.com/kpj2006/XOps/pull/1) · CI run
[32404913032](https://github.com/kpj2006/XOps/actions/runs/32404913032) — ground rules and the
`uses: ./` dry-run both green at `9902b1b`.

---

## Week 2 — The EIP-3009 driver, offline

No network this week. Everything is pure computation, which means everything is testable.

### Build
- [ ] `drivers/exact-eip155/eip712.ts` — domain separator, struct hash, digest
- [ ] `drivers/exact-eip155/sign.ts` — sign + recover (noble)
- [ ] `drivers/exact-eip155/abi.ts` — `transferWithAuthorization` encoder
- [ ] `drivers/exact-eip155/nonce.ts` — `canonical()` → `bytes32`
- [ ] `drivers/exact-eip155/verify.ts` — **offline** verification
- [ ] `assets/chains.json` — Base Sepolia entry only
- [ ] `src/cli.ts` — `xops verify`, `xops encode`

### Verify
- [ ] **Confirm Base Sepolia constants on-chain**: `name()`, `version()`, `decimals()`, and the USDC address against Circle's docs
- [ ] Recovered signer == treasury address (reproduces the on-chain check)
- [ ] Calldata is exactly **292 bytes**, selector `0xe3ee160e`
- [ ] Golden vectors committed: domain, digest, signature, recovered address, full calldata
- [ ] **Verify suite passes with networking disabled** (I6)
- [ ] Negative tests: wrong domain → `DOMAIN_MISMATCH`; tampered amount → `AMOUNT_MISMATCH`; tampered recipient → `RECIPIENT_MISMATCH`; expired → `AUTH_EXPIRED`

### Exit
- [ ] `npx xops verify <payload>` runs offline with no keys and no network
- [ ] Runtime dependencies: exactly **2** (`@noble/curves`, `@noble/hashes`)
- [ ] Golden vectors are the regression barrier for all later weeks

> The on-chain constant check is the first bullet for a reason. A wrong EIP-712 domain produces
> a structurally valid signature that fails with no useful error. Catch it here, not in week 3.

---

## Week 3 — First real settlement

### Build
- [ ] `drivers/exact-eip155/rpc.ts` — minimal JSON-RPC over `fetch`, bundled public endpoints, failover, retry classification
- [ ] `settle()` — broadcast, poll receipt, map results to error codes
- [ ] Idempotency wired end-to-end: `canonical()` → nonce → settle
- [ ] `AUTH_ALREADY_USED` mapped to **success**

### Verify
- [ ] Real USDC moves on Base Sepolia
- [ ] **Replay test:** settle, re-run identical inputs, expect **success** + `AUTH_ALREADY_USED` + original tx link (I8)
- [ ] Expiry test: sign with `validBefore` in the past → `AUTH_EXPIRED`
- [ ] RPC failover: point the first endpoint at a dead host, confirm the second is used
- [ ] Every error path writes `TX_HASH`, `EXPLORER_URL`, `STATUS`, `ERROR_CODE`, `IDEMPOTENCY_KEY` to `GITHUB_OUTPUT`

### Exit
- [ ] A payout settles on Base Sepolia and the tx is visible on the explorer
- [ ] The replay test is green **in CI**, not just locally
- [ ] Record the tx hash and the replay CI run — this is week 3's evidence artifact

---

## Week 4 — The PR loop

### Build
- [ ] `adapters/github/trigger.ts` — `/send` parsing, maintainer permission gate
- [ ] `adapters/github/comment.ts` — 402 challenge comment + receipt comment
- [ ] `adapters/github/outputs.ts`
- [x] `core/policy.ts` — named constants, evaluated **locally**, no network
- [ ] `core/receipt.ts` — machine-readable receipt emitted on every settlement
- [ ] `.xops.yml` loader with `version: 1`; unknown keys warn, never fail
- [x] Kill switch, as the `enabled` input, evaluated **first** among the conditions
      (`.xops.yml` is still the planned home for it)

### Verify
- [ ] Full loop: PR merge → 402 comment → `/settle` → receipt comment
- [x] Non-maintainer `/send` → `POLICY_DENIED`, nothing settles
- [x] `max_per_payout` blocks **before** any driver is reached (I10)
- [ ] Policy result table renders in the PR comment with per-condition evidence
- [x] Kill switch refuses regardless of the rest of the configuration. Note the deviation:
      it is the *first condition*, not a check ahead of evaluation. Conditions are pure and
      offline, so there is no work to skip, and evaluating all of them is what lets one run
      report every problem at once.
- [ ] Unknown `.xops.yml` key produces a warning, not a failure

### Exit
- [ ] A contributor is paid from a real merged PR with no manual steps outside GitHub
- [ ] `mode: dry-run` still the default; a fresh repo runs with **zero secrets**
- [ ] Screen recording of the full loop — evidence artifact

---

## Week 5 — Harden, then close the gate

### Build
- [ ] Simulation before broadcast: `eth_call` + `eth_estimateGas` + revert-reason decoding → `SIMULATION_REVERT`
- [ ] `drivers/facilitator/` — POST `/verify`, `/settle`; **zero secrets, zero gas**
- [ ] `settlement.mode: self | facilitator | auto`
- [ ] `signer/` — static EIP-712 signer page, GitHub Pages
- [ ] Offline-signing path: maintainer signs in their own wallet, CI holds no treasury key
- [ ] SBOM + build provenance in the release workflow
- [ ] JSON Schema for `.xops.yml`, validated in CI

### Verify
- [ ] A payout completes with **zero private keys in GitHub Secrets**
- [ ] `mode: facilitator` needs no gas wallet and no secrets
- [ ] Simulation catches an insufficient-balance case **without spending gas**
- [ ] `dist/` rebuild is byte-identical to committed (I12)
- [ ] **Soak: 20+ consecutive testnet settlements** including deliberate replays and expiries
- [ ] Fresh repo integrates in **under 5 minutes with zero secrets** — time it, on someone else's machine

### Exit
- [ ] **Every box in `REFERENCES.md` §2.4 is ticked**
- [ ] `v1.0.0` tagged; config schema frozen
- [ ] Multi-chain work is now unlocked. Not before.

---

## Week 6 — Multi-chain, docs, ship

Two networks, in order. Base mainnet first because it changes one variable (real money); Monad
second because it changes a different one (a different chain).

### Build
- [ ] Base mainnet via the §6.1 protocol
- [ ] Monad testnet, then Monad mainnet, via the §6.1 protocol
- [ ] `templates/caller/` — the two files an adopter copies
- [ ] `docs/` — QUICKSTART, SECURITY, DRIVERS
- [ ] README with the secrets ladder and the zero-core-changes diff

### Verify
- [ ] **The diff adding each network touches zero files under `src/core` and `src/adapters`** — paste the `git diff --stat` into the PR
- [ ] Per-chain golden vectors committed
- [ ] Wrong-domain negative test per chain
- [ ] All prior tests still green on Base Sepolia (no regression)

### Exit
- [ ] Three networks live, one driver, zero core changes — proven by diff
- [ ] `v1.1.0` tagged
- [ ] A person who has never seen the repo integrates it using only the README

---

## 6.1 Per-Chain Verification Protocol

Run this for **every** new network. It is the reusable artifact of week 6 — a fourth chain later
should cost the same as the second.

1. **Verify constants on-chain first.** Call `name()`, `version()`, `decimals()` on the token.
   Check the address against the issuer's own documentation. Never copy a sibling network's
   `eip712` block — Base mainnet and Base Sepolia may differ.
2. **Add a `chains.json` entry. Nothing else.** If you need to touch any other file, stop and
   fix the boundary instead. That is the finding, and it is more valuable than the chain.
3. **Confirm the diff.** `git diff --stat` must show no `src/core` or `src/adapters` changes.
4. **Dry-run and read the calldata.** Selector `0xe3ee160e`, 292 bytes, recipient and amount
   correct in the decoded words.
5. **Settle the smallest possible amount.**
6. **Replay test** → success + `AUTH_ALREADY_USED`.
7. **Expiry test** → `AUTH_EXPIRED`.
8. **Wrong-domain negative test** → `DOMAIN_MISMATCH`, using a neighbouring chain's domain.
9. **Commit a golden vector for this chain.**
10. **Record the tx hash** in `docs/VERIFIED_CHAINS.md`.

Mainnet only: start below $1, and confirm the treasury balance moved by exactly the expected
amount before doing anything larger.

---

## Scope Ladder — What to Cut If You're Behind

Cut from the top. Never from the bottom.

| Cut first | CLI polish · signer page styling · extra resolvers · `docs/DRIVERS.md` |
| Cut second | Monad (keep Base mainnet) · simulation layer · SBOM/provenance |
| Cut third | Base mainnet (ship testnet-only, say so plainly) |
| **Never cut** | golden vectors · offline verify · replay test · I1 lint · dry-run default · tier gate · the release gate itself |

Shipping one chain that is provably correct beats three chains that are probably fine. The
never-cut row is what makes the claim "provably" instead of "probably" — and the claim is the
deliverable.

---

## Risk Register

| Risk | Signal | Response |
|---|---|---|
| Wrong EIP-712 domain | signature valid locally, reverts on-chain | week 2 on-chain constant check |
| Public facilitator disappears | `/settle` 5xx | `mode: self` fallback, already built |
| RPC rate limits | intermittent `RPC_UNAVAILABLE` | multi-endpoint failover, week 3 |
| I1 erodes | a chain import appears in `src/core` | lint from week 1, fails the build |
| Week 6 becomes development | adding a network touches core files | **stop; fix the boundary.** This is a finding, not a delay |
| Replay reported as failure | red build on a successful payout | I8 test in CI from week 3 |
| noble v2 API traps | silent wrong output | golden vectors from week 2 |

Two traps worth naming explicitly: noble v2 requires `.js` extensions on imports, and
`toBytes()` takes a **boolean**, not `"uncompressed"`. Both produce plausible-looking wrong
results. `x402-min.js` has the working forms.

---

## Evidence Checklist

What an evaluator can verify without reading the code. Collect these as you go — reconstructing
them at the end is how good work looks unfinished.

- [ ] W2 — golden vectors + CI run showing offline verification
- [ ] W3 — testnet tx hash + CI run of the replay test
- [ ] W4 — screen recording of PR merge → 402 comment → settle → receipt
- [ ] W5 — payout completed with zero secrets configured; soak log of 20+ settlements
- [ ] W5 — `v1.0.0` tag with SBOM and provenance
- [ ] W6 — `git diff --stat` proving a network was added with zero core changes
- [ ] W6 — `docs/VERIFIED_CHAINS.md` with a tx hash per network
- [ ] Any week — dependency count of 2, shown by `npm ls`

The week-6 diff is the single most persuasive artifact in the project. It is the difference
between claiming an architecture and demonstrating one.
