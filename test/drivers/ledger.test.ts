import assert from "node:assert/strict";
import { test } from "node:test";

import type { LedgerEntry, SettlementLedger } from "../../src/core/ledger.js";
import type { PaymentPayload, PaymentRequirements } from "../../src/core/types.js";
import { DriverRegistry } from "../../src/drivers/registry.js";
import type { Capabilities, SettlementDriver } from "../../src/drivers/types.js";

const NETWORK = "eip155:11155111";
const KEY = "xops:v1|github:o/r#refs/pull/1|0xdead|eip155:11155111|USDC|0";

const REQUIREMENTS: PaymentRequirements = {
  scheme: "allowance",
  network: NETWORK,
  amount: "2500000",
  asset: "USDC",
  payTo: "0xdead",
  maxTimeoutSeconds: 60,
};
const PAYLOAD: PaymentPayload = {
  x402Version: 2,
  scheme: "allowance",
  network: NETWORK,
  payload: {},
};

function driver(caps: Partial<Capabilities> = {}): SettlementDriver & { settled: number } {
  const self = {
    id: "test-driver",
    settled: 0,
    capabilities: {
      offlineVerify: true,
      needsGas: true,
      needsSecret: false,
      custodial: false,
      nativeReplayProtection: false,
      ...caps,
    },
    supports: (n: string) => n === NETWORK,
    buildRequirements: () => REQUIREMENTS,
    verify: () => Promise.resolve({ isValid: true }),
    settle: () => {
      self.settled += 1;
      return Promise.resolve({ success: true, transaction: `0xtx${self.settled}`, network: NETWORK });
    },
  };
  return self;
}

function ledger(): SettlementLedger & { entries: Map<string, LedgerEntry> } {
  const entries = new Map<string, LedgerEntry>();
  return {
    id: "test-ledger",
    entries,
    lookup: (key) => Promise.resolve(entries.get(key)),
    record: (key, entry) => {
      entries.set(key, entry);
      return Promise.resolve();
    },
  };
}

test("a driver with no replay protection cannot settle without a ledger", async () => {
  const registry = new DriverRegistry(0);
  registry.register(driver());
  await assert.rejects(registry.settle(PAYLOAD, REQUIREMENTS), {
    code: "NO_REPLAY_PROTECTION",
  });
});

/**
 * The hole this closes. The guard used to read `tier === 0 && !nativeReplayProtection`,
 * so a driver that pays twice on a retry became settleable simply by constructing
 * the registry at tier 1 — silently, with double payment as the failure mode.
 */
test("bumping the tier does not buy a way past the replay guard", async () => {
  for (const tier of [1, 2] as const) {
    const registry = new DriverRegistry(tier);
    registry.register(driver());
    await assert.rejects(
      registry.settle(PAYLOAD, REQUIREMENTS),
      { code: "NO_REPLAY_PROTECTION" },
      `tier ${tier} must still refuse`,
    );
  }
});

test("a ledger satisfies the guard and the first payout goes through", async () => {
  const registry = new DriverRegistry(1);
  const d = driver();
  registry.register(d);

  const response = await registry.settle(PAYLOAD, REQUIREMENTS, {
    idempotencyKey: KEY,
    ledger: ledger(),
  });

  assert.equal(response.success, true);
  assert.equal(d.settled, 1);
});

test("a re-run settles nothing and reports already paid (I8)", async () => {
  const registry = new DriverRegistry(1);
  const d = driver();
  registry.register(d);
  const l = ledger();

  const first = await registry.settle(PAYLOAD, REQUIREMENTS, { idempotencyKey: KEY, ledger: l });
  const second = await registry.settle(PAYLOAD, REQUIREMENTS, { idempotencyKey: KEY, ledger: l });

  assert.equal(d.settled, 1, "the driver must be reached exactly once");
  assert.equal(second.success, true, "a repeat is a success, never a failure");
  assert.equal(second.errorReason, "AUTH_ALREADY_USED");
  assert.equal(second.transaction, first.transaction, "and it reports the original transaction");
});

test("a different payout on the same PR is not blocked by the first receipt", async () => {
  const registry = new DriverRegistry(1);
  const d = driver();
  registry.register(d);
  const l = ledger();

  await registry.settle(PAYLOAD, REQUIREMENTS, { idempotencyKey: KEY, ledger: l });
  await registry.settle(PAYLOAD, REQUIREMENTS, {
    idempotencyKey: KEY.replace("0xdead", "0xbeef"),
    ledger: l,
  });

  assert.equal(d.settled, 2);
});

test("a rail with native replay protection needs no ledger", async () => {
  const registry = new DriverRegistry(0);
  registry.register(driver({ nativeReplayProtection: true }));
  const response = await registry.settle(PAYLOAD, REQUIREMENTS);
  assert.equal(response.success, true);
});

test("a failed settlement is not recorded, so a retry may still pay", async () => {
  const registry = new DriverRegistry(1);
  const l = ledger();
  const failing: SettlementDriver = {
    ...driver(),
    settle: () => Promise.resolve({ success: false, errorReason: "RPC_UNAVAILABLE" }),
  };
  registry.register(failing);

  await registry.settle(PAYLOAD, REQUIREMENTS, { idempotencyKey: KEY, ledger: l });
  assert.equal(l.entries.size, 0, "recording a failure would strand the payout forever");
});
