import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../auth/AuthProvider";
import { getWallet } from "../api/wallet";
import { getProfile } from "../api/profile";
import { listTransactions } from "../api/transactions";
import type { Profile, Transaction, Wallet } from "../api/types";

interface DataState {
  wallet: Wallet | null;
  profile: Profile | null;
  transactions: Transaction[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  setWallet: (w: Wallet) => void;
  setProfile: (p: Profile) => void;
  setTransactions: (t: Transaction[] | ((prev: Transaction[]) => Transaction[])) => void;
}

const DataCtx = createContext<DataState | null>(null);

export function DataProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadedFor = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    if (!user) return;
    setError(null);
    try {
      const [w, p, t] = await Promise.all([getWallet(user.id), getProfile(user.id), listTransactions()]);
      setWallet(w);
      setProfile(p);
      setTransactions(t);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [user]);

  // Initial load, keyed on user id (defer off the auth callback per Supabase guidance).
  useEffect(() => {
    if (!user) {
      loadedFor.current = null;
      setWallet(null);
      setProfile(null);
      setTransactions([]);
      return;
    }
    if (loadedFor.current === user.id) return;
    loadedFor.current = user.id;
    setLoading(true);
    void refresh();
  }, [user, refresh]);

  // Realtime: live balance/cap updates + new transactions land without a refetch.
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`wallet:${user.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "wallets", filter: `user_id=eq.${user.id}` },
        (payload) => setWallet(payload.new as Wallet),
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "transactions", filter: `user_id=eq.${user.id}` },
        (payload) => setTransactions((prev) => [payload.new as Transaction, ...prev]),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user]);

  return (
    <DataCtx.Provider
      value={{ wallet, profile, transactions, loading, error, refresh, setWallet, setProfile, setTransactions }}
    >
      {children}
    </DataCtx.Provider>
  );
}

export function useData(): DataState {
  const ctx = useContext(DataCtx);
  if (!ctx) throw new Error("useData must be used within <DataProvider>");
  return ctx;
}

export const useWallet = () => {
  const { wallet, setWallet, loading, refresh } = useData();
  return { wallet, setWallet, loading, refresh };
};

export const useProfile = () => {
  const { profile, setProfile, loading } = useData();
  return { profile, setProfile, loading };
};

export const useTransactions = () => {
  const { transactions, setTransactions, loading } = useData();
  return { transactions, setTransactions, loading };
};
