import { createRequire as __WEBPACK_EXTERNAL_createRequire } from "module";
/******/ /* webpack/runtime/compat */
/******/ 
/******/ if (typeof __nccwpck_require__ !== 'undefined') __nccwpck_require__.ab = new URL('.', import.meta.url).pathname.slice(import.meta.url.match(/^file:\/\/\/\w:/) ? 1 : 0, -1) + "/";
/******/ 
/************************************************************************/
var __webpack_exports__ = {};

;// CONCATENATED MODULE: ./src/adapters/github/inputs.ts
/**
 * Reads a GitHub Actions input.
 *
 * The empty-string handling is the whole point. A *declared* input that a
 * workflow does not pass arrives as `INPUT_NAME=""`, not as absent. So
 * `input("repo") ?? process.env.GITHUB_REPOSITORY` silently yields `""` —
 * `??` only falls through on null and undefined — and every downstream
 * fallback and default is defeated by a value that looks present.
 *
 * Treating blank as absent is what callers actually mean, and it makes
 * declaring an input a safe, behaviour-preserving change.
 */
function readInput(name) {
    const value = process.env[`INPUT_${name.toUpperCase().replace(/ /g, "_")}`];
    if (value === undefined)
        return undefined;
    return value.trim() === "" ? undefined : value;
}

;// CONCATENATED MODULE: external "node:fs"
const external_node_fs_namespaceObject = __WEBPACK_EXTERNAL_createRequire(import.meta.url)("node:fs");
;// CONCATENATED MODULE: external "node:crypto"
const external_node_crypto_namespaceObject = __WEBPACK_EXTERNAL_createRequire(import.meta.url)("node:crypto");
;// CONCATENATED MODULE: ./src/adapters/github/outputs.ts


/**
 * Written on every path, including failures. The delimiter is random per call so
 * a value containing a newline cannot forge another output.
 */
function writeOutputs(values) {
    const file = process.env["GITHUB_OUTPUT"];
    if (!file)
        return;
    const delimiter = `XOPS_EOF_${(0,external_node_crypto_namespaceObject.randomUUID)()}`;
    let block = "";
    for (const [name, value] of Object.entries(values)) {
        block += `${name}<<${delimiter}\n${value ?? ""}\n${delimiter}\n`;
    }
    if (block)
        (0,external_node_fs_namespaceObject.appendFileSync)(file, block, "utf8");
}

;// CONCATENATED MODULE: ./src/core/errors.ts
const ERROR_CODES = (/* unused pure expression or super */ null && ([
    "AUTH_ALREADY_USED",
    "AUTH_EXPIRED",
    "AUTH_NOT_YET_VALID",
    "SIGNER_MISMATCH",
    "DOMAIN_MISMATCH",
    "AMOUNT_MISMATCH",
    "RECIPIENT_MISMATCH",
    "IDENTITY_UNRESOLVED",
    "POLICY_DENIED",
    "AMOUNT_CAP_EXCEEDED",
    "INSUFFICIENT_BALANCE",
    "INSUFFICIENT_GAS",
    "SIMULATION_REVERT",
    "RPC_UNAVAILABLE",
    "DRIVER_NOT_FOUND",
    "TIER_VIOLATION",
    "NO_REPLAY_PROTECTION",
]));
const ERRORS = {
    AUTH_ALREADY_USED: {
        meaning: "Authorization nonce already consumed",
        comment: "Already paid — see the original transaction.",
        retry: "no",
        success: true,
    },
    AUTH_EXPIRED: {
        meaning: "Past validBefore",
        comment: "Authorization expired. Re-sign; the window is 15 minutes.",
        retry: "user",
        success: false,
    },
    AUTH_NOT_YET_VALID: {
        meaning: "Before validAfter",
        comment: "Clock skew between signer and node. Wait 60 seconds and retry.",
        retry: "auto",
        success: false,
    },
    SIGNER_MISMATCH: {
        meaning: "Recovered signer is not the expected payer",
        comment: "Wrong wallet connected. Sign with the treasury account.",
        retry: "user",
        success: false,
    },
    DOMAIN_MISMATCH: {
        meaning: "Typed-data domain does not match the asset registry",
        comment: "Check the network and asset in `.xops.yml`.",
        retry: "no",
        success: false,
    },
    AMOUNT_MISMATCH: {
        meaning: "Payload amount differs from requirements",
        comment: "The payload was tampered with and was not settled.",
        retry: "no",
        success: false,
    },
    RECIPIENT_MISMATCH: {
        meaning: "Payload recipient differs from requirements",
        comment: "The payload was tampered with and was not settled.",
        retry: "no",
        success: false,
    },
    IDENTITY_UNRESOLVED: {
        meaning: "No resolver matched the recipient identity",
        comment: "Register a payout address or use an inline address.",
        retry: "user",
        success: false,
    },
    POLICY_DENIED: {
        meaning: "A policy condition failed",
        comment: "A required policy condition was not met. Nothing was settled.",
        retry: "no",
        success: false,
    },
    AMOUNT_CAP_EXCEEDED: {
        meaning: "Amount above policy.max_per_payout",
        comment: "Above the configured per-payout cap. Raise the cap or split the payout.",
        retry: "no",
        success: false,
    },
    INSUFFICIENT_BALANCE: {
        meaning: "Treasury balance short of the payout",
        comment: "The treasury does not hold enough of the asset.",
        retry: "user",
        success: false,
    },
    INSUFFICIENT_GAS: {
        meaning: "Broadcasting account cannot pay fees",
        comment: "Fund the broadcasting account with the network's native token.",
        retry: "user",
        success: false,
    },
    SIMULATION_REVERT: {
        meaning: "Pre-broadcast simulation reverted",
        comment: "Simulation reverted before broadcast, so no fees were spent.",
        retry: "no",
        success: false,
    },
    RPC_UNAVAILABLE: {
        meaning: "Every configured endpoint failed",
        comment: "No endpoint responded. Retryable; set `rpc_url` to override.",
        retry: "auto",
        success: false,
    },
    DRIVER_NOT_FOUND: {
        meaning: "No driver registered for this network and scheme",
        comment: "Unsupported network/scheme combination.",
        retry: "no",
        success: false,
    },
    TIER_VIOLATION: {
        meaning: "Driver requires secrets or custody and cannot run in Tier 0",
        comment: "This driver must run as a separate service you operate.",
        retry: "no",
        success: false,
    },
    NO_REPLAY_PROTECTION: {
        meaning: "Driver does not declare an exactly-once guarantee",
        comment: "Cannot settle without replay protection.",
        retry: "no",
        success: false,
    },
};
class XOpsError extends Error {
    code;
    details;
    constructor(code, message, details = {}) {
        super(message ?? `${code}: ${ERRORS[code].meaning}`);
        this.name = "XOpsError";
        this.code = code;
        this.details = details;
    }
}
function isErrorCode(value) {
    return typeof value === "string" && ERROR_CODES.includes(value);
}
/** I8 lives here: one code in the taxonomy is a success. */
function isSuccessCode(code) {
    return ERRORS[code].success;
}

;// CONCATENATED MODULE: ./src/adapters/github/trigger.ts

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
function parseSendCommand(body) {
    for (const line of body.split(/\r?\n/)) {
        const match = SEND_LINE.exec(line);
        if (!match)
            continue;
        const tokens = (match[1] ?? "").trim().split(/\s+/).filter(Boolean);
        if (tokens.length < 2) {
            throw new Error(`\`/send\` needs a recipient and an amount. ${USAGE}`);
        }
        if (tokens.length > 3) {
            throw new Error(`\`/send\` got ${tokens.length} arguments and expected at most 3. ${USAGE}`);
        }
        const [recipient, second, third] = tokens;
        const amountMatch = AMOUNT_WITH_ASSET.exec(second);
        if (!amountMatch) {
            throw new Error(`"${second}" is not a valid amount. ${USAGE}`);
        }
        const [, amount, attachedAsset] = amountMatch;
        if (attachedAsset && third) {
            throw new Error(`the asset was given twice, as "${attachedAsset}" and "${third}". ${USAGE}`);
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
function assertMaintainer(association) {
    const value = (association ?? "").trim().toUpperCase();
    if (!MAINTAINER_ASSOCIATIONS.has(value)) {
        throw new XOpsError("POLICY_DENIED", `\`/send\` is restricted to maintainers. Author association was "${association ?? "unknown"}".`, { association: association ?? null });
    }
}

;// CONCATENATED MODULE: ./src/core/amount.ts
// Human amounts in, atomic units out. Pure string arithmetic — floats are not
// allowed anywhere near money, and `parseFloat("0.1")` is exactly why.
const DECIMAL = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;
/**
 * Converts a human-typed decimal amount into atomic units.
 *
 * `toAtomic("10", 6)` is `"10000000"`. `toAtomic("2.5", 6)` is `"2500000"`.
 *
 * `decimals` is passed in, never inferred — the asset registry owns that value
 * (`REFERENCES.md`: resolve decimals from the registry, never infer). Getting it
 * wrong is a 10^n error in someone's payout, so this throws rather than guesses.
 */
function toAtomic(human, decimals) {
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
        throw new Error(`decimals must be an integer between 0 and 36, got "${decimals}"`);
    }
    const value = human.trim();
    if (!DECIMAL.test(value)) {
        throw new Error(`amount must be a positive decimal number without separators, got "${human}"`);
    }
    const [whole, fraction = ""] = value.split(".");
    if (fraction.length > decimals) {
        throw new Error(`amount "${human}" has ${fraction.length} decimal places, but the asset has only ${decimals}`);
    }
    // Strip leading zeros but always leave one digit behind.
    const atomic = `${whole}${fraction.padEnd(decimals, "0")}`.replace(/^0+(?=[0-9])/, "");
    if (/^0+$/.test(atomic)) {
        throw new Error(`amount must be greater than zero, got "${human}"`);
    }
    return atomic;
}

;// CONCATENATED MODULE: ./src/core/defaults.ts
/** I5. Real settlement is always an explicit opt-in. */
const DEFAULT_SETTLEMENT_MODE = "dry-run";
/** Kill switch default. Honored before policy evaluation. */
const DEFAULT_SETTLEMENT_ENABLED = true;
/** Clock-skew allowance and authorization window, in seconds. */
const VALID_AFTER_SKEW_SECONDS = 60;
const VALID_BEFORE_WINDOW_SECONDS = 900;

;// CONCATENATED MODULE: ./src/core/idempotency.ts
/**
 * Returns a canonical string. No hashing, no rail primitives — a driver derives
 * its rail's replay token from this string.
 *
 * `amount` is excluded on purpose: with amount in the key, `/send alice 50`
 * corrected to `/send alice 500` yields two keys and Alice receives 550.
 * Excluded, the correction collides and requires an explicit `round` bump.
 */
function canonical(k) {
    return (`xops:v${k.v}|${k.source.platform}:${k.source.repo}#${k.source.ref}` +
        `|${k.recipient.toLowerCase()}|${k.network}|${k.asset}|${k.round}`);
}
function keyFor(intent) {
    const { source } = intent;
    return {
        v: 1,
        source: {
            platform: source.platform,
            repo: source.platform === "github" ? source.repo : source.project,
            ref: source.ref,
        },
        recipient: intent.recipient,
        asset: intent.asset,
        network: intent.network,
        round: intent.round,
    };
}

;// CONCATENATED MODULE: ./src/core/intent.ts
// CAIP-2: namespace:reference. Says nothing about what the namespace means.
const CAIP2 = /^[-a-z0-9]{3,8}:[-_a-zA-Z0-9]{1,32}$/;
const ATOMIC_AMOUNT = /^[0-9]+$/;
function required(raw, field) {
    const value = raw[field]?.trim();
    if (!value)
        throw new Error(`Missing required intent field: ${field}`);
    return value;
}
function parseIntent(raw) {
    const platform = (raw.platform ?? "github").trim();
    if (platform !== "github" && platform !== "gitlab") {
        throw new Error(`Unsupported platform: ${platform}`);
    }
    const repo = required(raw, "repo");
    const ref = required(raw, "ref");
    const actor = required(raw, "actor");
    const recipient = required(raw, "recipient");
    const amount = required(raw, "amount");
    const asset = required(raw, "asset");
    const network = required(raw, "network");
    const scheme = required(raw, "scheme");
    if (!ATOMIC_AMOUNT.test(amount)) {
        throw new Error(`amount must be a whole number of atomic units as a string, got "${amount}"`);
    }
    if (!CAIP2.test(network)) {
        throw new Error(`network must be a CAIP-2 identifier, got "${network}"`);
    }
    const round = Number(raw.round ?? "0");
    if (!Number.isInteger(round) || round < 0) {
        throw new Error(`round must be a non-negative integer, got "${raw.round}"`);
    }
    const source = platform === "github"
        ? { platform, repo, ref, actor }
        : { platform, project: repo, ref, actor };
    return { source, recipient, amount, asset, network, scheme, round };
}

;// CONCATENATED MODULE: ./src/drivers/registry.ts

function tierViolationMessage(id) {
    return [
        `Driver ${id} takes custody of funds and cannot run in-process.`,
        "Custodial settlement must run as a separate service you operate:",
        "  settlement: { mode: facilitator, url: https://your-service }",
    ].join("\n");
}
/**
 * The only layer that knows rails exist is the driver behind this registry.
 * Everything above resolves `(network × scheme)` and gets an interface back.
 */
class DriverRegistry {
    tier;
    drivers = [];
    constructor(tier = 0) {
        this.tier = tier;
    }
    /** I3: a driver needing secrets or custody cannot register in Tier 0. */
    register(driver) {
        const { needsSecret, custodial } = driver.capabilities;
        if (this.tier === 0 && (needsSecret || custodial)) {
            throw new XOpsError("TIER_VIOLATION", tierViolationMessage(driver.id), {
                driver: driver.id,
                needsSecret,
                custodial,
                tier: this.tier,
            });
        }
        if (this.drivers.some((d) => d.id === driver.id)) {
            throw new Error(`Driver ${driver.id} is already registered`);
        }
        this.drivers.push(driver);
    }
    list() {
        return this.drivers;
    }
    resolve(network, scheme) {
        const driver = this.drivers.find((d) => d.supports(network, scheme));
        if (!driver) {
            throw new XOpsError("DRIVER_NOT_FOUND", `No driver registered for scheme "${scheme}" on network "${network}"`, { network, scheme, registered: this.drivers.map((d) => d.id) });
        }
        return driver;
    }
    buildRequirements(ctx) {
        const driver = this.resolve(ctx.intent.network, ctx.intent.scheme);
        return driver.buildRequirements(ctx);
    }
    async verify(p, r) {
        return this.resolve(r.network, r.scheme).verify(p, r);
    }
    /** I9: refuse before the driver is reached if it declares no exactly-once guarantee. */
    async settle(p, r) {
        const driver = this.resolve(r.network, r.scheme);
        if (this.tier === 0 && !driver.capabilities.nativeReplayProtection) {
            throw new XOpsError("NO_REPLAY_PROTECTION", `Driver ${driver.id} declares no replay protection and cannot settle in Tier 0`, { driver: driver.id, tier: this.tier });
        }
        return driver.settle(p, r);
    }
}

;// CONCATENATED MODULE: ./src/resolvers/inline-address.ts
const INLINE_PREFIX = "inline:";
/**
 * Takes the payout address verbatim from the identity string. It does not
 * validate the address format — the format belongs to a rail, and only the
 * driver for that rail may judge it.
 *
 * Accepts `inline:<value>` and bare values. `@handle` identities are left for
 * lookup-based resolvers.
 */
class InlineAddressResolver {
    id = "inline-address";
    canResolve(identity) {
        const value = strip(identity);
        return value.length > 0 && !value.startsWith("@") && !/\s/.test(value);
    }
    resolve(identity, ctx) {
        return Promise.resolve({
            rail: ctx.rail,
            address: strip(identity),
            resolvedBy: this.id,
        });
    }
}
function strip(identity) {
    const trimmed = identity.trim();
    return trimmed.startsWith(INLINE_PREFIX) ? trimmed.slice(INLINE_PREFIX.length).trim() : trimmed;
}

;// CONCATENATED MODULE: ./src/resolvers/index.ts


class ResolverChain {
    resolvers;
    constructor(resolvers = []) {
        this.resolvers = resolvers;
    }
    use(resolver) {
        this.resolvers.push(resolver);
        return this;
    }
    async resolve(identity, ctx) {
        for (const resolver of this.resolvers) {
            if (resolver.canResolve(identity)) {
                return resolver.resolve(identity, ctx);
            }
        }
        throw new XOpsError("IDENTITY_UNRESOLVED", `No resolver matched "${identity}"`, {
            identity,
            tried: this.resolvers.map((r) => r.id),
        });
    }
}

;// CONCATENATED MODULE: ./src/main.ts










async function run() {
    // L0 TRIGGER. A comment body, when given, is the source of truth for who gets
    // paid and how much — it beats the workflow's static inputs, because a person
    // typed it deliberately.
    const body = readInput("comment");
    const command = body === undefined ? undefined : parseSendCommand(body);
    if (body !== undefined && command === undefined) {
        console.log("no /send command in this comment — nothing to do.");
        writeOutputs({ STATUS: "skipped", ERROR_CODE: "" });
        return 0;
    }
    if (command) {
        // L1 POLICY, offline, before anything else happens.
        assertMaintainer(readInput("actor_association"));
        const decimals = Number(readInput("decimals") ?? "6");
        console.log(`/send parsed: recipient=${command.recipient} amount=${command.amount}` +
            `${command.asset ? ` asset=${command.asset}` : ""} (decimals=${decimals})`);
    }
    const decimals = Number(readInput("decimals") ?? "6");
    const intent = parseIntent({
        platform: "github",
        repo: readInput("repo") ?? process.env["GITHUB_REPOSITORY"],
        ref: readInput("ref") ?? process.env["GITHUB_REF"],
        actor: readInput("actor") ?? process.env["GITHUB_ACTOR"],
        recipient: command?.recipient ?? readInput("recipient"),
        amount: command ? toAtomic(command.amount, decimals) : readInput("amount"),
        asset: command?.asset ?? readInput("asset"),
        network: readInput("network"),
        scheme: readInput("scheme"),
        round: readInput("round"),
    });
    const idempotencyKey = canonical(keyFor(intent));
    const resolvers = new ResolverChain([new InlineAddressResolver()]);
    const target = await resolvers.resolve(intent.recipient, { rail: intent.network });
    console.log("intent:");
    console.log(JSON.stringify(intent, null, 2));
    console.log("payout target:");
    console.log(JSON.stringify(target, null, 2));
    console.log(`idempotency key: ${idempotencyKey}`);
    const mode = readInput("mode") ?? DEFAULT_SETTLEMENT_MODE;
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
run().then((code) => {
    process.exitCode = code;
}, (err) => {
    const code = err instanceof XOpsError ? err.code : "";
    const message = err instanceof Error ? err.message : String(err);
    console.error(message);
    writeOutputs({ STATUS: "error", ERROR_CODE: code });
    process.exitCode = 1;
});

