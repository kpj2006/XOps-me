import { readInput as input } from "./adapters/github/inputs.js";
import { writeOutputs } from "./adapters/github/outputs.js";
import { PullRequestReceiptLedger } from "./adapters/github/receipts.js";
import { SafeAllowanceDriver } from "./drivers/safe-allowance/driver.js";
import { assertMaintainer, parseSendCommand } from "./adapters/github/trigger.js";
import { toAtomic } from "./core/amount.js";
import { DEFAULT_SETTLEMENT_MODE } from "./core/defaults.js";
import { XOpsError } from "./core/errors.js";
import { canonical, keyFor } from "./core/idempotency.js";
import { parseIntent } from "./core/intent.js";
import { DriverRegistry } from "./drivers/registry.js";
import { InlineAddressResolver, ResolverChain } from "./resolvers/index.js";

async function run(): Promise<number> {
  // L0 TRIGGER. A comment body, when given, is the source of truth for who gets
  // paid and how much — it beats the workflow's static inputs, because a person
  // typed it deliberately.
  const body = input("comment");
  const command = body === undefined ? undefined : parseSendCommand(body);

  if (body !== undefined && command === undefined) {
    console.log("no /send command in this comment — nothing to do.");
    writeOutputs({ STATUS: "skipped", ERROR_CODE: "" });
    return 0;
  }

  if (command) {
    // L1 POLICY, offline, before anything else happens.
    assertMaintainer(input("actor_association"));

    const decimals = Number(input("decimals") ?? "6");
    console.log(
      `/send parsed: recipient=${command.recipient} amount=${command.amount}` +
        `${command.asset ? ` asset=${command.asset}` : ""} (decimals=${decimals})`,
    );
  }

  const decimals = Number(input("decimals") ?? "6");

  const intent = parseIntent({
    platform: "github",
    repo: input("repo") ?? process.env["GITHUB_REPOSITORY"],
    ref: input("ref") ?? process.env["GITHUB_REF"],
    actor: input("actor") ?? process.env["GITHUB_ACTOR"],
    recipient: command?.recipient ?? input("recipient"),
    amount: command ? toAtomic(command.amount, decimals) : input("amount"),
    asset: command?.asset ?? input("asset"),
    network: input("network"),
    scheme: input("scheme"),
    round: input("round"),
  });

  const idempotencyKey = canonical(keyFor(intent));
  const resolvers = new ResolverChain([new InlineAddressResolver()]);
  const target = await resolvers.resolve(intent.recipient, { rail: intent.network });

  console.log("intent:");
  console.log(JSON.stringify(intent, null, 2));
  console.log("payout target:");
  console.log(JSON.stringify(target, null, 2));
  console.log(`idempotency key: ${idempotencyKey}`);

  const mode = input("mode") ?? DEFAULT_SETTLEMENT_MODE;
  if (mode === "dry-run") {
    console.log("mode: dry-run — nothing was settled.");
    writeOutputs({ STATUS: "dry-run", IDEMPOTENCY_KEY: idempotencyKey, ERROR_CODE: "" });
    return 0;
  }

  const required = (name: string): string => {
    const value = input(name);
    if (!value) throw new Error(`Real settlement needs the "${name}" input`);
    return value;
  };

  const driver = new SafeAllowanceDriver({
    network: intent.network,
    chainId: BigInt(required("chain_id")),
    rpcUrl: required("rpc_url"),
    moduleAddress: required("allowance_module"),
    safeAddress: required("safe"),
    tokenAddress: required("token"),
    delegatePrivateKey: required("delegate_key"),
  });

  /**
   * Tier 1, not 0: CI holds the delegate key, so this is an adopter-operated
   * process with its own credentials. I3 would reject it at tier 0, correctly —
   * and I9 still applies here, which is why the ledger below is not optional.
   */
  const registry = new DriverRegistry(1);
  registry.register(driver);

  const ledger = new PullRequestReceiptLedger({
    repo:
      intent.source.platform === "github" ? intent.source.repo : intent.source.project,
    number: Number(required("pr")),
    token: required("github_token"),
  });

  const requirements = registry.buildRequirements({ intent, target, idempotencyKey });
  const verified = await driver.verify(
    { x402Version: 2, scheme: intent.scheme, network: intent.network, payload: {} },
    requirements,
  );
  if (!verified.isValid) {
    throw new XOpsError(verified.reason ?? "POLICY_DENIED", "The payout failed verification");
  }

  const response = await registry.settle(
    { x402Version: 2, scheme: intent.scheme, network: intent.network, payload: {} },
    requirements,
    { idempotencyKey, ledger },
  );

  const alreadyPaid = response.errorReason === "AUTH_ALREADY_USED";
  console.log(
    alreadyPaid
      ? `already paid — ${response.transaction ?? "no transaction recorded"}`
      : `settled: ${response.transaction ?? "(no transaction)"}`,
  );

  writeOutputs({
    STATUS: response.success ? (alreadyPaid ? "already-paid" : "settled") : "error",
    TX_HASH: response.transaction ?? "",
    IDEMPOTENCY_KEY: idempotencyKey,
    ERROR_CODE: response.success ? "" : (response.errorReason ?? ""),
  });

  return response.success ? 0 : 1;
}

run().then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    const code = err instanceof XOpsError ? err.code : "";
    const message = err instanceof Error ? err.message : String(err);
    console.error(message);
    writeOutputs({ STATUS: "error", ERROR_CODE: code });
    process.exitCode = 1;
  },
);
