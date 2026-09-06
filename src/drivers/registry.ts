import { XOpsError } from "../core/errors.js";
import type { PaymentPayload, PaymentRequirements, SettlementResponse } from "../core/types.js";
import type {
  RequirementsContext,
  SettlementDriver,
  Tier,
  VerifyResult,
} from "./types.js";

function tierViolationMessage(id: string): string {
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
export class DriverRegistry {
  readonly tier: Tier;
  private readonly drivers: SettlementDriver[] = [];

  constructor(tier: Tier = 0) {
    this.tier = tier;
  }

  /** I3: a driver needing secrets or custody cannot register in Tier 0. */
  register(driver: SettlementDriver): void {
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

  list(): readonly SettlementDriver[] {
    return this.drivers;
  }

  resolve(network: string, scheme: string): SettlementDriver {
    const driver = this.drivers.find((d) => d.supports(network, scheme));
    if (!driver) {
      throw new XOpsError(
        "DRIVER_NOT_FOUND",
        `No driver registered for scheme "${scheme}" on network "${network}"`,
        { network, scheme, registered: this.drivers.map((d) => d.id) },
      );
    }
    return driver;
  }

  buildRequirements(ctx: RequirementsContext): PaymentRequirements {
    const driver = this.resolve(ctx.intent.network, ctx.intent.scheme);
    return driver.buildRequirements(ctx);
  }

  async verify(p: PaymentPayload, r: PaymentRequirements): Promise<VerifyResult> {
    return this.resolve(r.network, r.scheme).verify(p, r);
  }

  /** I9: refuse before the driver is reached if it declares no exactly-once guarantee. */
  async settle(p: PaymentPayload, r: PaymentRequirements): Promise<SettlementResponse> {
    const driver = this.resolve(r.network, r.scheme);
    if (this.tier === 0 && !driver.capabilities.nativeReplayProtection) {
      throw new XOpsError(
        "NO_REPLAY_PROTECTION",
        `Driver ${driver.id} declares no replay protection and cannot settle in Tier 0`,
        { driver: driver.id, tier: this.tier },
      );
    }
    return driver.settle(p, r);
  }
}
