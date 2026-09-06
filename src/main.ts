import { writeOutputs } from "./adapters/github/outputs.js";
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
  const intent = parseIntent({
    platform: "github",
    repo: input("repo") ?? process.env["GITHUB_REPOSITORY"],
    ref: input("ref") ?? process.env["GITHUB_REF"],
    actor: input("actor") ?? process.env["GITHUB_ACTOR"],
    recipient: input("recipient"),
    amount: input("amount"),
    asset: input("asset"),
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
