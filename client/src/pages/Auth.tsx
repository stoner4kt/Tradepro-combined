import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.js';
import { Alert, Button, Field, Input, Select } from '../components/ui.js';

function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-page px-4 py-8">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-600 text-xl font-extrabold text-white shadow-sm shadow-brand-600/30">
            T
          </div>
          <h1 className="text-xl font-bold text-ink">TradePro</h1>
          <p className="mt-1 text-sm text-muted">{subtitle}</p>
        </div>
        <div className="rounded-xl border border-line bg-white p-6 shadow-sm sm:p-7">
          <h2 className="mb-4 text-lg font-semibold text-ink">{title}</h2>
          {children}
        </div>
      </div>
    </div>
  );
}

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Welcome back" subtitle="Sign in to manage leads, clients & projects">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Email">
          <Input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@business.com" />
        </Field>
        <Field label="Password">
          <Input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
        </Field>
        {error ? <Alert tone="error">{error}</Alert> : null}
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
        <p className="text-center text-sm text-muted">
          New to TradePro?{' '}
          <Link to="/register" className="font-semibold text-brand-600 transition duration-150 hover:text-brand-700">
            Create an account
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}

export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    fullName: '',
    businessName: '',
    businessType: '',
    email: '',
    password: '',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await register(form);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Start your 14-day trial" subtitle="Built for plumbers, electricians, roofers & more">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Your name">
          <Input required value={form.fullName} onChange={set('fullName')} placeholder="Jane Smith" />
        </Field>
        <Field label="Business name">
          <Input required value={form.businessName} onChange={set('businessName')} placeholder="Smith Electrical" />
        </Field>
        <Field label="Trade">
          <Select value={form.businessType} onChange={set('businessType')}>
            <option value="">Select your trade…</option>
            <option value="plumbing">Plumbing</option>
            <option value="electrical">Electrical</option>
            <option value="roofing">Roofing</option>
            <option value="hvac">HVAC</option>
            <option value="landscaping">Landscaping</option>
            <option value="general">General contractor</option>
            <option value="other">Other</option>
          </Select>
        </Field>
        <Field label="Work email">
          <Input type="email" required value={form.email} onChange={set('email')} placeholder="jane@smithmail.com" />
        </Field>
        <Field label="Password" hint="At least 8 characters">
          <Input type="password" required value={form.password} onChange={set('password')} placeholder="••••••••" />
        </Field>
        {error ? <Alert tone="error">{error}</Alert> : null}
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? 'Creating account…' : 'Create account'}
        </Button>
        <p className="text-center text-sm text-muted">
          Already have an account?{' '}
          <Link to="/login" className="font-semibold text-brand-600 transition duration-150 hover:text-brand-700">
            Sign in
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}