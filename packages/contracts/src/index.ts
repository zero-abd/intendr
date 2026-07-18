// Frozen seams + shared types for intendr. Everything builds against these.

export type Brand<T, B extends string> = T & { readonly __brand: B };

export type Cents = number;
export type WorkspaceId = Brand<string, "WorkspaceId">;
export type ReservationId = Brand<string, "ReservationId">;
export type IdempotencyKey = Brand<string, "IdempotencyKey">;
export type RequestId = Brand<string, "RequestId">;

export type SideEffectClass = "read" | "write" | "unknown";
export type BudgetOutcome = "ok" | "permission_required" | "denied";

export interface BudgetSettings {
  sessionCapCents: Cents;
  monthlyCapCents: Cents;
  perCallWarnCents: Cents;
}

export interface BudgetDecision {
  decision: BudgetOutcome;
  reason: string;
  sessionSpentCents: Cents;
  sessionCapCents: Cents;
  workspaceRemainingCents: Cents;
}

/** The spend store — the injectable backend behind the budget engine and the wallet. */
export interface SpendStorePort {
  tryReserve(workspaceId: WorkspaceId, cents: Cents, capCents: Cents): Promise<boolean>;
  settle(workspaceId: WorkspaceId, reservationCents: Cents, actualCents: Cents): Promise<void>;
  refund(workspaceId: WorkspaceId, cents: Cents): Promise<void>;
  remaining(workspaceId: WorkspaceId): Promise<Cents>;
}

export interface BudgetPolicy {
  checkEstimate(workspaceId: WorkspaceId, estimateCents: Cents): Promise<BudgetDecision>;
  reserve(workspaceId: WorkspaceId, estimateCents: Cents, idempotencyKey: IdempotencyKey): Promise<ReservationId>;
  settle(workspaceId: WorkspaceId, reservationId: ReservationId, actualCents: Cents): Promise<void>;
  refund(workspaceId: WorkspaceId, reservationId: ReservationId): Promise<void>;
  remaining(workspaceId: WorkspaceId): Promise<Cents>;
}

/** A payment rail is a spend store backed by real (or simulated) money. */
export type PaymentRail = SpendStorePort & { readonly id: string };

/** A capability the agent can pay for — data API or real-world commerce. */
export interface ServiceRef {
  id: string; // convention: `${provider}:${localId}`
  provider: string;
  title: string;
}
export interface ServiceDetails extends ServiceRef {
  inputSchema: Record<string, unknown>;
  priceCents: Cents;
  dynamicPricing: boolean;
  sideEffect: SideEffectClass;
}
export interface RunResult {
  ok: boolean;
  priceCents: Cents;
  data: unknown;
  requestId: RequestId;
}

/** Every provider — Orthogonal, DoorDash, Uber — implements this identical shape. */
export interface CapabilityProvider {
  readonly name: string;
  search(query: string): Promise<ServiceRef[]>;
  details(id: string): Promise<ServiceDetails>;
  run(id: string, input: Record<string, unknown>, idemKey: IdempotencyKey): Promise<RunResult>;
}

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export type PermissionDecision = "approve" | "raise_cap" | "skip";
export interface PermissionResponse {
  decision: PermissionDecision;
  newCapCents?: Cents;
}

export type TraceEvent =
  | { type: "tool_call_started"; stepId: string; service: string; estCents: Cents }
  | { type: "tool_result"; stepId: string; requestId: RequestId; summary: string; priceCents: Cents; ok: boolean }
  | { type: "permission_required"; stepId: string; kind: "cost" | "side_effect"; estCents: Cents; reason: string }
  | { type: "cost_update"; spentCents: Cents; capCents: Cents; remainingCents: Cents }
  | { type: "blocked"; reason: string }
  | { type: "done" };

export const toCents = (dollars: number): Cents => Math.round(dollars * 100);
export const fmtCents = (c: Cents): string => `$${(c / 100).toFixed(2)}`;
