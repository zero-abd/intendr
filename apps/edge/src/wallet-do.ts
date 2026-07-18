// Durable Object: one instance per wallet/workspace.
// Owns the reserve->settle ledger holds, the approval queue, and out-of-context raw
// payloads (for expand_result) — the "one DO per unit" pattern applied to a wallet.
export class WalletDO implements DurableObject {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: unknown,
  ) {}

  async fetch(_request: Request): Promise<Response> {
    // TODO: back a SpendStorePort with this.state.storage (SQLite), serve wallet ops,
    // hold the approval queue, and stash raw payloads keyed by requestId.
    return new Response("WalletDO (scaffold)", { status: 200 });
  }
}
