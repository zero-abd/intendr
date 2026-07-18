// reserve -> run -> settle/refund budget engine. The atomic cap lives in the store.
import type {
  BudgetDecision,
  BudgetPolicy,
  BudgetSettings,
  Cents,
  IdempotencyKey,
  ReservationId,
  SpendStorePort,
  WorkspaceId,
} from "@intendr/contracts";

export interface BudgetPolicyDeps {
  store: SpendStorePort;
  settings: BudgetSettings;
}

export function createBudgetPolicy(deps: BudgetPolicyDeps): BudgetPolicy {
  const { store, settings } = deps;
  const holds = new Map<ReservationId, { workspaceId: WorkspaceId; cents: Cents }>();
  let counter = 0;
  let sessionSpentCents: Cents = 0;

  return {
    async checkEstimate(workspaceId, estimateCents): Promise<BudgetDecision> {
      const remaining = await store.remaining(workspaceId);
      const base = {
        sessionSpentCents,
        sessionCapCents: settings.sessionCapCents,
        workspaceRemainingCents: remaining,
      };
      if (estimateCents > remaining) {
        return { decision: "denied", reason: `estimate ${estimateCents}c exceeds remaining ${remaining}c`, ...base };
      }
      if (estimateCents > settings.perCallWarnCents || sessionSpentCents + estimateCents > settings.sessionCapCents) {
        return { decision: "permission_required", reason: "over per-call warn or session cap", ...base };
      }
      return { decision: "ok", reason: "within budget", ...base };
    },

    async reserve(workspaceId, estimateCents, _idempotencyKey): Promise<ReservationId> {
      const ok = await store.tryReserve(workspaceId, estimateCents, settings.monthlyCapCents);
      if (!ok) throw new Error("reservation refused: monthly cap exceeded");
      const id = `res_${++counter}` as ReservationId;
      holds.set(id, { workspaceId, cents: estimateCents });
      return id;
    },

    async settle(workspaceId, reservationId, actualCents): Promise<void> {
      const hold = holds.get(reservationId);
      if (!hold) throw new Error(`unknown reservation ${reservationId}`);
      await store.settle(workspaceId, hold.cents, actualCents);
      sessionSpentCents += actualCents;
      holds.delete(reservationId);
    },

    async refund(workspaceId, reservationId): Promise<void> {
      const hold = holds.get(reservationId);
      if (!hold) return;
      await store.refund(workspaceId, hold.cents);
      holds.delete(reservationId);
    },

    remaining(workspaceId): Promise<Cents> {
      return store.remaining(workspaceId);
    },
  };
}
