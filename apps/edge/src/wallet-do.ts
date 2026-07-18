// Durable Object: persistent per-workspace wallet with an ATOMIC reserve/settle store.
// State is held in memory (loaded once via blockConcurrencyWhile) and written through to
// SQLite storage. Because the DO runs one request at a time and each op's read-modify-write
// critical section has no interleaving await, concurrent pay_and_run calls can't lose an
// update or exceed the cap (fixes the round-1 concurrency under-charge).
const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

export class WalletDO {
  private spent = 0;
  private reserved = 0;
  private cap = 2000;
  private byCat: Record<string, number> = {};
  private readonly storage: DurableObjectStorage;

  constructor(state: DurableObjectState, _env: unknown) {
    this.storage = state.storage;
    state.blockConcurrencyWhile(async () => {
      this.spent = (await this.storage.get<number>("spentCents")) ?? 0;
      this.reserved = (await this.storage.get<number>("reservedCents")) ?? 0;
      this.cap = (await this.storage.get<number>("globalCapCents")) ?? 2000;
      this.byCat = (await this.storage.get<Record<string, number>>("spentByCategory")) ?? {};
    });
  }

  private async persist(): Promise<void> {
    await this.storage.put({
      spentCents: this.spent,
      reservedCents: this.reserved,
      globalCapCents: this.cap,
      spentByCategory: this.byCat,
    });
  }

  private snapshot() {
    return {
      spentCents: this.spent,
      reservedCents: this.reserved,
      globalCapCents: this.cap,
      remainingCents: this.cap - this.spent - this.reserved,
      spentByCategory: this.byCat,
    };
  }

  async fetch(request: Request): Promise<Response> {
    const op = new URL(request.url).pathname.replace(/^\//, "");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const arg: any = request.method === "POST" ? await request.json().catch(() => ({})) : {};

    switch (op) {
      case "state":
        return json(this.snapshot());

      case "reserve": {
        // Critical section: check + mutate run synchronously (no await between), so this is
        // atomic across concurrent requests to the same DO.
        const cents = Number(arg.cents) || 0;
        const cap = arg.capCents != null ? Number(arg.capCents) : this.cap;
        if (this.spent + this.reserved + cents > cap) {
          return json({ ok: false, reason: `global cap of ${cap}c would be exceeded` });
        }
        this.reserved += cents;
        await this.persist();
        return json({ ok: true });
      }

      case "settle": {
        const reservationCents = Number(arg.reservationCents) || 0;
        const actualCents = Number(arg.actualCents) || 0;
        const category = typeof arg.category === "string" ? arg.category : undefined;
        this.reserved = Math.max(0, this.reserved - reservationCents);
        this.spent += actualCents;
        if (category) this.byCat[category] = (this.byCat[category] ?? 0) + actualCents;
        await this.persist();
        return json({ ok: true, ...this.snapshot() });
      }

      case "refund": {
        this.reserved = Math.max(0, this.reserved - (Number(arg.cents) || 0));
        await this.persist();
        return json({ ok: true });
      }

      case "setCap": {
        this.cap = Number(arg.newCapCents);
        await this.persist();
        return json({ ok: true, globalCapCents: this.cap });
      }

      case "reset": {
        this.spent = 0;
        this.reserved = 0;
        this.byCat = {};
        await this.persist();
        return json({ ok: true });
      }

      default:
        return json({ error: `unknown op: ${op}` }, 404);
    }
  }
}
