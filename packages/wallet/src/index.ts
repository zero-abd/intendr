// PaymentRail implementations. The rail chosen at runtime backs the budget engine.
import type { Cents, PaymentRail, WorkspaceId } from "@intendr/contracts";

interface WalletState {
  balanceCents: Cents;
  reservedCents: Cents;
  settledCents: Cents;
}

/** Default rail: in-memory prepaid ledger (integer cents). Deterministic; carries the demo. */
export class LocalWalletRail implements PaymentRail {
  readonly id = "local";
  private readonly wallets = new Map<string, WalletState>();

  constructor(private readonly openingBalanceCents: Cents = 5000) {}

  private get(workspaceId: WorkspaceId): WalletState {
    let state = this.wallets.get(workspaceId);
    if (!state) {
      state = { balanceCents: this.openingBalanceCents, reservedCents: 0, settledCents: 0 };
      this.wallets.set(workspaceId, state);
    }
    return state;
  }

  async tryReserve(workspaceId: WorkspaceId, cents: Cents, capCents: Cents): Promise<boolean> {
    const s = this.get(workspaceId);
    if (s.reservedCents + s.settledCents + cents > capCents) return false;
    if (cents > s.balanceCents - s.reservedCents) return false;
    s.reservedCents += cents;
    return true;
  }

  async settle(workspaceId: WorkspaceId, reservationCents: Cents, actualCents: Cents): Promise<void> {
    const s = this.get(workspaceId);
    s.reservedCents -= reservationCents;
    s.settledCents += actualCents;
    s.balanceCents -= actualCents;
  }

  async refund(workspaceId: WorkspaceId, cents: Cents): Promise<void> {
    this.get(workspaceId).reservedCents -= cents;
  }

  async remaining(workspaceId: WorkspaceId): Promise<Cents> {
    const s = this.get(workspaceId);
    return s.balanceCents - s.reservedCents;
  }
}

/** TODO: hold/charge a scoped Ramp Agent Card. */
export class RampCardRail implements PaymentRail {
  readonly id = "ramp";
  async tryReserve(): Promise<boolean> {
    throw new Error("RampCardRail not implemented yet");
  }
  async settle(): Promise<void> {
    throw new Error("RampCardRail not implemented yet");
  }
  async refund(): Promise<void> {
    throw new Error("RampCardRail not implemented yet");
  }
  async remaining(): Promise<Cents> {
    throw new Error("RampCardRail not implemented yet");
  }
}

/** TODO: Coinbase x402 / USDC settlement. */
export class X402Rail implements PaymentRail {
  readonly id = "x402";
  async tryReserve(): Promise<boolean> {
    throw new Error("X402Rail not implemented yet");
  }
  async settle(): Promise<void> {
    throw new Error("X402Rail not implemented yet");
  }
  async refund(): Promise<void> {
    throw new Error("X402Rail not implemented yet");
  }
  async remaining(): Promise<Cents> {
    throw new Error("X402Rail not implemented yet");
  }
}
