// Transport-agnostic MCP tool registry + the atomic pay orchestration.
// apps/edge mounts this over a Durable-Object-backed spend store; apps/mcp mounts it
// over a local in-process wallet. The orchestration is identical.
import type {
  BudgetPolicy,
  IdempotencyKey,
  PaymentRail,
  ReservationId,
  ServiceDetails,
  ToolSpec,
  WorkspaceId,
} from "@intendr/contracts";
import { fmtCents } from "@intendr/contracts";
import { checkGuardrails, type GuardrailConfig, type GuardrailState } from "@intendr/guardrails";
import { distill } from "@intendr/harness";
import { ProviderRegistry } from "@intendr/providers";

const MAX_CAP_CENTS = 1_000_000; // $10,000 safety ceiling on raise_cap
let idemCounter = 0;

export interface McpDeps {
  workspaceId: WorkspaceId;
  registry: ProviderRegistry;
  budget: BudgetPolicy;
  rail: PaymentRail;
  guardrails: GuardrailConfig;
  state: GuardrailState;
}

export interface ToolDef {
  spec: ToolSpec;
  handler: (input: Record<string, unknown>) => Promise<unknown>;
}

/** Names of required params absent from the call, as `bucket.name` labels. */
function missingRequiredParams(schema: ServiceDetails["inputSchema"], params: Record<string, unknown>): string[] {
  const s = schema as { query?: unknown[]; body?: unknown[]; path?: unknown[] } | null;
  if (!s || typeof s !== "object") return [];
  const missing: string[] = [];
  for (const bucket of ["query", "body", "path"] as const) {
    for (const p of s[bucket] ?? []) {
      if (p && typeof p === "object" && (p as { required?: unknown }).required === true) {
        const name = (p as { name?: unknown }).name;
        if (typeof name !== "string") continue;
        const provided = (params[bucket] as Record<string, unknown> | undefined)?.[name];
        if (provided === undefined || provided === "") missing.push(`${bucket}.${name}`);
      }
    }
  }
  return missing;
}

export function buildTools(deps: McpDeps): ToolDef[] {
  const { registry, budget, guardrails, state, workspaceId } = deps;

  return [
    {
      spec: { name: "get_wallet", description: "Balance, caps, spent, and remaining budget.", inputSchema: {} },
      handler: async () => ({
        remainingCents: await budget.remaining(workspaceId),
        globalCapCents: guardrails.globalCapCents,
        categoryCapsCents: guardrails.categoryCapsCents,
        spentCents: state.spentCents,
      }),
    },
    {
      spec: {
        name: "search_services",
        description: "Discover paid capabilities across all providers (data + commerce).",
        inputSchema: { query: "string" },
      },
      handler: async (input) => registry.search(String(input.query ?? "")),
    },
    {
      spec: {
        name: "get_service",
        description: "Schema, price, and side-effect class for one capability.",
        inputSchema: { id: "string" },
      },
      handler: async (input) => {
        const id = String(input.id);
        const provider = registry.find(id);
        if (!provider) throw new Error(`no provider handles ${id}`);
        return provider.details(id);
      },
    },
    {
      spec: {
        name: "pay_and_run",
        description: "Atomic: guardrails -> reserve -> run -> settle/refund -> receipt. Returns BLOCKED if a cap trips or a param is missing.",
        inputSchema: { id: "string", input: "object" },
      },
      handler: async (input) => {
        const id = String(input.id);
        const provider = registry.find(id);
        if (!provider) throw new Error(`no provider handles ${id}`);

        const details = await provider.details(id);
        const category = provider.name;
        const params = (input.input as Record<string, unknown>) ?? {};

        // Local pre-validation: never make a paid call missing a required param.
        const missing = missingRequiredParams(details.inputSchema, params);
        if (missing.length > 0) {
          return { status: "error", reason: `missing required argument(s): ${missing.join(", ")}` };
        }

        // Confirmation for a write can arrive as top-level `confirm` or inside `body.confirm`.
        const body = params.body as Record<string, unknown> | undefined;
        const confirmed = params.confirm === true || body?.confirm === true;

        const verdict = checkGuardrails(guardrails, state, {
          provider: provider.name,
          category,
          cents: details.priceCents,
          sideEffect: details.sideEffect,
          confirmed,
        });
        if (!verdict.allow) {
          // Surface a live, no-charge preview (e.g. a cart total) so the user can approve
          // with full context, if the provider supports it.
          let preview: unknown;
          if (verdict.needsApproval && provider.preview) {
            preview = await provider.preview(id, params).catch((e) => ({ previewError: String(e) }));
          }
          return { status: "BLOCKED", reason: verdict.reason, needsApproval: verdict.needsApproval, preview };
        }

        const check = await budget.checkEstimate(workspaceId, details.priceCents);
        if (check.decision === "denied") {
          return { status: "BLOCKED", reason: check.reason };
        }

        const idem = `idem_${id}_${++idemCounter}` as IdempotencyKey;
        let reservation: ReservationId;
        try {
          reservation = await budget.reserve(workspaceId, details.priceCents, idem);
        } catch {
          // Atomic store refused (cap would be exceeded under concurrency) — surface as BLOCKED.
          return { status: "BLOCKED", reason: "spend cap would be exceeded" };
        }

        try {
          const result = await provider.run(id, params, idem);
          await budget.settle(workspaceId, reservation, result.priceCents);
          state.spentCents += result.priceCents;
          state.spentByCategoryCents[category] = (state.spentByCategoryCents[category] ?? 0) + result.priceCents;
          return {
            status: "ok",
            requestId: result.requestId,
            summary: distill(result.data).summary,
            priceCents: result.priceCents,
            balanceCents: await budget.remaining(workspaceId),
          };
        } catch (err) {
          await budget.refund(workspaceId, reservation);
          throw err;
        }
      },
    },
    {
      spec: { name: "get_spend_summary", description: "Spent, overspend blocked ($ saved), remaining.", inputSchema: {} },
      handler: async () => ({
        spentCents: state.spentCents,
        spent: fmtCents(state.spentCents),
        remainingCents: await budget.remaining(workspaceId),
        globalCapCents: guardrails.globalCapCents,
      }),
    },
    {
      spec: {
        name: "approve",
        description: "Resolve a pending approval: approve / raise_cap / skip. newCapCents (with raise_cap) raises the global cap.",
        inputSchema: { decision: "string", newCapCents: "number?" },
      },
      handler: async (input) => {
        const decision = String(input.decision ?? "");
        if (decision !== "approve" && decision !== "raise_cap" && decision !== "skip") {
          return { ok: false, reason: `unknown decision "${decision}" (expected approve | raise_cap | skip)` };
        }
        if (input.newCapCents !== undefined) {
          const n = input.newCapCents;
          if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > MAX_CAP_CENTS) {
            return { ok: false, reason: `newCapCents must be a number between 0 and ${MAX_CAP_CENTS}` };
          }
          guardrails.globalCapCents = Math.round(n);
        }
        return { ok: true, decision, globalCapCents: guardrails.globalCapCents };
      },
    },
  ];
}
