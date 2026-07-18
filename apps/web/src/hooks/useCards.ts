import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { listFundingCards } from "../api/cards";
import { listVirtualCards } from "../api/virtualCards";
import { listCardEvents } from "../api/events";
import type { CardEvent, FundingCard, VirtualCard } from "../api/types";

/** True when the error indicates the card tables haven't been created yet (migration 002). */
function isMissingTable(err: unknown): boolean {
  const e = err as { code?: string; message?: string };
  return e?.code === "42P01" || /does not exist|find the table|schema cache/i.test(e?.message ?? "");
}

export function useCards() {
  const { user } = useAuth();
  const [fundingCards, setFundingCards] = useState<FundingCard[]>([]);
  const [virtualCards, setVirtualCards] = useState<VirtualCard[]>([]);
  const [events, setEvents] = useState<CardEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [needsMigration, setNeedsMigration] = useState(false);

  const refresh = useCallback(async () => {
    if (!user) return;
    setError(null);
    try {
      const [f, v, e] = await Promise.all([
        listFundingCards(user.id),
        listVirtualCards(user.id),
        listCardEvents(),
      ]);
      setFundingCards(f);
      setVirtualCards(v);
      setEvents(e);
      setNeedsMigration(false);
    } catch (err) {
      if (isMissingTable(err)) {
        setNeedsMigration(true);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);

  return {
    user,
    fundingCards,
    virtualCards,
    events,
    loading,
    error,
    needsMigration,
    refresh,
    setVirtualCards,
    setFundingCards,
  };
}
