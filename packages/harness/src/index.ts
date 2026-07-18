// Result distillation — keep large tool payloads out of the model's context.
// (The distilled summary goes into context; the full payload is fetched on demand
//  via expand_result, keyed by requestId.)

export interface Distilled {
  summary: string;
  rawBytes: number;
  truncated: boolean;
}

export function distill(data: unknown, maxChars = 800): Distilled {
  const json = typeof data === "string" ? data : JSON.stringify(data) ?? String(data);
  const rawBytes = json.length;
  const truncated = json.length > maxChars;
  return {
    summary: truncated ? `${json.slice(0, maxChars)}…` : json,
    rawBytes,
    truncated,
  };
}

// TODO: defensive HTTP client (timeout / retry / circuit breaker). It runs in the
// Worker (uses the platform `fetch`), so keep it in a Worker-scoped module — that way
// its DOM/global types don't leak into runtime-agnostic consumers of this package.
