import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { useEffect, type ReactNode } from 'react';
import { useAuth, AuthProvider } from './contexts/AuthContext.js';
import Layout from './components/Layout.js';
import { LoginPage, RegisterPage } from './pages/Auth.js';
import DashboardPage from './pages/Dashboard.js';
import LeadsPage from './pages/Leads.js';
import ClientsPage from './pages/Clients.js';
import ProjectsPage from './pages/Projects.js';
import SettingsPage from './pages/Settings.js';
import LedgerPage from './pages/Ledger.js';
import ReviewsPage from './pages/Reviews.js';
import InvoicingPage from './pages/Invoicing.js';

function Protected({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-page">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function PublicOnly({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function ScrollToTop() {
  const { pathname } = window.location;
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ScrollToTop />
        <Routes>
          <Route
            path="/login"
            element={
              <PublicOnly>
                <LoginPage />
              </PublicOnly>
            }
          />
          <Route
            path="/register"
            element={
              <PublicOnly>
                <RegisterPage />
              </PublicOnly>
            }
          />
          <Route
            path="/"
            element={
              <Protected>
                <Layout />
              </Protected>
            }
          >
            <Route index element={<DashboardPage />} />
            <Route path="/leads" element={<LeadsPage />} />
            <Route path="/clients" element={<ClientsPage />} />
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/reviews" element={<ReviewsPage />} />
            <Route path="/invoicing" element={<InvoicingPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/ledger" element={<LedgerPage />} />
          </Route>
          {/* Shared document links — the invoicing-public edge function
              renders share pages directly from the token; these client-side
              routes forward browsers there (no CRM login needed). */}
          <Route path="/q/:token" element={<PublicDocumentForwarder kind="quote" />} />
          <Route path="/i/:token" element={<PublicDocumentForwarder kind="invoice" />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

// The share page itself is rendered by the invoicing-public edge function on
// the project's Supabase URL; these SPA routes just redirect there so links
// survive whichever host serves them.
function PublicDocumentForwarder({ kind }: { kind: 'quote' | 'invoice' }) {
  const { token } = useParams();
  useEffect(() => {
    const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || '';
    if (!supabaseUrl || !token) {
      window.location.href = `https://supabase.co/functions/v1/invoicing-public/${kind}/${encodeURIComponent(token ?? '')}`;
      return;
    }
    window.location.replace(`${supabaseUrl.replace(/\/+$/, '')}/functions/v1/invoicing-public/${kind}/${encodeURIComponent(token)}`);
  }, [kind, token]);
  return (
    <div className="flex min-h-screen items-center justify-center bg-page">
      <p className="text-sm text-muted">Opening shared document…</p>
    </div>
  );
}