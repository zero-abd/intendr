// Durable Object: persistent per-workspace wallet. Holds cumulative spend + the live cap
// so the spend cap actually enforces ACROSS requests. The stateless Worker loads before a
// tool call and saves after a spend/cap change. SQLite-backed (free-plan compatible).
const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

interface WalletState {
  spentCents: number;
  spentByCategory: Record<string, number>;
  globalCapCents: number;
}

export class WalletDO {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: unknown,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const op = url.pathname.replace(/^\//, "");

    if (op === "load") {
      const defaultCap = Number(url.searchParams.get("defaultCapCents") ?? "2000");
      const spentCents = (await this.state.storage.get<number>("spentCents")) ?? 0;
      const spentByCategory = (await this.state.storage.get<Record<string, number>>("spentByCategory")) ?? {};
      const globalCapCents = (await this.state.storage.get<number>("globalCapCents")) ?? defaultCap;
      const out: WalletState = { spentCents, spentByCategory, globalCapCents };
      return json(out);
    }

    if (op === "save") {
      const body = (await request.json()) as WalletState;
      await this.state.storage.put({
        spentCents: body.spentCents ?? 0,
        spentByCategory: body.spentByCategory ?? {},
        globalCapCents: body.globalCapCents,
      });
      return json({ ok: true });
    }

    if (op === "reset") {
      await this.state.storage.deleteAll();
      return json({ ok: true });
    }

    return json({ error: `unknown op: ${op}` }, 404);
  }
}
