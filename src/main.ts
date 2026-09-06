import { writeOutputs } from "./adapters/github/outputs.js";
import { assertMaintainer, parseSendCommand } from "./adapters/github/trigger.js";
import { toAtomic } from "./core/amount.js";
import { DEFAULT_SETTLEMENT_MODE } from "./core/defaults.js";
import { XOpsError } from "./core/errors.js";
import { canonical, keyFor } from "./core/idempotency.js";
import { parseIntent } from "./core/intent.js";
import { DriverRegistry } from "./drivers/registry.js";
import { InlineAddressResolver, ResolverChain } from "./resolvers/index.js";

function input(name: string): string | undefined {
  return process.env[`INPUT_${name.toUpperCase().replace(/ /g, "_")}`];
}

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

  // No settlement driver ships yet. Registry resolution is the honest failure.
  const registry = new DriverRegistry(0);
  registry.resolve(intent.network, intent.scheme);
  return 0;
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
