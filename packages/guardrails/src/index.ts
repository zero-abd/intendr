// The spend-control brain: global cap + per-category cap + merchant allowlist + side-effect gate.
import type { Cents, SideEffectClass } from "@intendr/contracts";

export interface GuardrailConfig {
  globalCapCents: Cents;
  categoryCapsCents: Record<string, Cents>;
  merchantAllowlist: string[]; // provider names / merchant ids; empty = allow all
}

export interface GuardrailState {
  spentCents: Cents;
  spentByCategoryCents: Record<string, Cents>;
}

export type GuardrailVerdict =
  | { allow: true }
  | { allow: false; reason: string; needsApproval: boolean };

export interface GuardrailRequest {
  provider: string;
  category: string;
  cents: Cents;
  sideEffect: SideEffectClass;
  /**
   * Explicit per-call confirmation for a write/real-world action. The stateless
   * edge can't persist an "approved" flag between tool calls, so approval is
   * expressed as the caller re-invoking with confirm=true after the user says yes.
   * The cap/allowlist checks still apply — this only clears the side-effect gate.
   */
  confirmed?: boolean;
}

export function checkGuardrails(
  cfg: GuardrailConfig,
  state: GuardrailState,
  req: GuardrailRequest,
): GuardrailVerdict {
  if (cfg.merchantAllowlist.length > 0 && !cfg.merchantAllowlist.includes(req.provider)) {
    return { allow: false, reason: `${req.provider} is not on the allowlist`, needsApproval: false };
  }
  // Evaluate the side-effect gate BEFORE the cap: a write / real-world action must always
  // surface as needing confirmation, so raising the cap can never silently auto-approve it.
  // An explicit per-call confirmation (confirm=true, sent after the user approves) clears
  // this gate; the cap and allowlist checks below still apply.
  if (req.sideEffect === "write" && req.confirmed !== true) {
    return { allow: false, reason: "write / real-world action requires confirmation", needsApproval: true };
  }
  if (state.spentCents + req.cents > cfg.globalCapCents) {
    return { allow: false, reason: `global cap of ${cfg.globalCapCents}c would be exceeded`, needsApproval: true };
  }
  const categoryCap = cfg.categoryCapsCents[req.category];
  if (categoryCap !== undefined) {
    const spentInCategory = state.spentByCategoryCents[req.category] ?? 0;
    if (spentInCategory + req.cents > categoryCap) {
      return { allow: false, reason: `${req.category} cap of ${categoryCap}c would be exceeded`, needsApproval: true };
    }
  }
  return { allow: true };
}
