// @intendr/commerce — cross-cutting commerce infra shared by providers + agents.
// Virtual-card issuance, location→address resolution, and the Amazon automation
// service contract + mock backend.
export * from "./cards.js";
export * from "./location.js";
export * from "./amazon-agent.js";
// Re-export the HTTP seam so consumers (executor, adapters) get one import surface.
export type { FetchLike, HttpResponse, HttpRequestInit } from "@intendr/contracts";
