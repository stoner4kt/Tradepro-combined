import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useEffect, type ReactNode } from 'react';
import { useAuth, AuthProvider } from './contexts/AuthContext.js';
import Layout from './components/Layout.js';
import { LoginPage, RegisterPage } from './pages/Auth.js';
import { CheckYourInboxPage, ForgotPasswordPage, ResetPasswordPage, VerifyEmailPage } from './pages/AuthFlows.js';
import DashboardPage from './pages/Dashboard.js';
import LeadsPage from './pages/Leads.js';
import ClientsPage from './pages/Clients.js';
import ProjectsPage from './pages/Projects.js';
import SettingsPage from './pages/Settings.js';
import LedgerPage from './pages/Ledger.js';
import ReviewsPage from './pages/Reviews.js';
import InvoicingPage from './pages/Invoicing.js';
import PublicDocumentPage from './pages/PublicDocument.js';

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
  const { pathname } = useLocation();
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
          <Route path="/check-your-inbox" element={<CheckYourInboxPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/verify-email" element={<VerifyEmailPage />} />
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
          <Route path="/q/:token" element={<PublicDocumentPage kind="quote" />} />
          <Route path="/i/:token" element={<PublicDocumentPage kind="invoice" />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

function NotFoundPage() {
  return <main className="flex min-h-screen items-center justify-center bg-page p-6"><section className="max-w-md rounded-xl border border-line bg-white p-8 text-center"><h1 className="text-2xl font-bold text-ink">Page not found</h1><p className="mt-2 text-sm text-muted">The page you requested does not exist.</p><a href="/" className="mt-5 inline-block rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white">Go to dashboard</a></section></main>;
}
