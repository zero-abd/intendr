import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthProvider";
import { RequireAuth } from "./auth/RequireAuth";
import { DataProvider } from "./hooks/DataProvider";
import { AppShell } from "./components/AppShell";
import { AuthPage } from "./pages/AuthPage";
import { LandingPage } from "./pages/LandingPage";
import { DashboardPage } from "./pages/DashboardPage";
import { CardsPage } from "./pages/CardsPage";
import { TransactionsPage } from "./pages/TransactionsPage";
import { ProfilePage } from "./pages/ProfilePage";

/** Redirect signed-in users away from the auth screen. */
function LoginRoute() {
  const { session, loading } = useAuth();
  if (loading) return null;
  if (session) return <Navigate to="/dashboard" replace />;
  return <AuthPage />;
}

/** Public marketing page at `/`; signed-in users skip straight to their wallet. */
function LandingRoute() {
  const { session, loading } = useAuth();
  if (loading) return null;
  if (session) return <Navigate to="/dashboard" replace />;
  return <LandingPage />;
}

function Shell() {
  return (
    <DataProvider>
      <AppShell>
        <Routes>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/cards" element={<CardsPage />} />
          <Route path="/transactions" element={<TransactionsPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </AppShell>
    </DataProvider>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<LandingRoute />} />
          <Route path="/login" element={<LoginRoute />} />
          <Route element={<RequireAuth />}>
            <Route path="/*" element={<Shell />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
