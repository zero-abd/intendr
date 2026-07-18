import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "./AuthProvider";
import { FullBleedLoader } from "../components/FullBleedLoader";

/** Gate on `loading` before redirecting so a hydrating session doesn't flash to /login. */
export function RequireAuth() {
  const { session, loading } = useAuth();
  if (loading) return <FullBleedLoader />;
  if (!session) return <Navigate to="/login" replace />;
  return <Outlet />;
}
