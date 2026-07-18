// Transport-agnostic MCP tool registry + the atomic pay orchestration.
// apps/edge mounts this over Cloudflare's McpAgent; a stdio bin can mount it locally.
import type { BudgetPolicy, IdempotencyKey, PaymentRail, ToolSpec, WorkspaceId } from "@intendr/contracts";
import { fmtCents } from "@intendr/contracts";
import { checkGuardrails, type GuardrailConfig, type GuardrailState } from "@intendr/guardrails";
import { distill } from "@intendr/harness";
import { ProviderRegistry } from "@intendr/providers";

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
        description: "Atomic: guardrails -> reserve -> run -> settle/refund -> receipt. Returns BLOCKED if a cap trips.",
        inputSchema: { id: "string", input: "object" },
      },
      handler: async (input) => {
        const id = String(input.id);
        const provider = registry.find(id);
        if (!provider) throw new Error(`no provider handles ${id}`);

        const details = await provider.details(id);
        const category = provider.name;

        const verdict = checkGuardrails(guardrails, state, {
          provider: provider.name,
          category,
          cents: details.priceCents,
          sideEffect: details.sideEffect,
        });
        if (!verdict.allow) {
          return { status: "BLOCKED", reason: verdict.reason, needsApproval: verdict.needsApproval };
        }

        const check = await budget.checkEstimate(workspaceId, details.priceCents);
        if (check.decision === "denied") {
          return { status: "BLOCKED", reason: check.reason };
        }

        const idem = `idem_${id}_${state.spentCents}` as IdempotencyKey;
        const reservation = await budget.reserve(workspaceId, details.priceCents, idem);
        try {
          const result = await provider.run(id, (input.input as Record<string, unknown>) ?? {}, idem);
          await budget.settle(workspaceId, reservation, result.priceCents);
          state.spentCents += result.priceCents;
          state.spentByCategoryCents[category] = (state.spentByCategoryCents[category] ?? 0) + result.priceCents;
          const summary = distill(result.data).summary;
          return {
            status: "ok",
            requestId: result.requestId,
            summary,
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
        description: "Resolve a pending approval: approve / raise_cap / skip.",
        inputSchema: { decision: "string", newCapCents: "number?" },
      },
      handler: async (input) => {
        if (input.decision === "raise_cap" && typeof input.newCapCents === "number") {
          guardrails.globalCapCents = input.newCapCents;
        }
        return { ok: true, globalCapCents: guardrails.globalCapCents };
      },
    },
  ];
}
