import { useEffect, useState } from 'react';
import * as api from '../lib/api.js';
import type { Settings } from '../types/api.js';
import { Alert, Button, Card, Field, Input, PageHeader, Select, Spinner, Textarea } from '../components/ui.js';
import { useAuth } from '../contexts/AuthContext.js';
import { Link } from 'react-router-dom';

export default function SettingsPage() {
  const { user, refreshUser } = useAuth();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    void api.getSettings().then((r) => setSettings(r.settings)).catch((e) => setError(e instanceof Error ? e.message : 'Failed to load settings'));
  }, []);

  const submitProfile = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setSaved(false);
    const f = new FormData(e.currentTarget);
    const payload = {
      fullName: String(f.get('fullName') ?? ''),
      businessName: String(f.get('businessName') ?? ''),
      businessType: String(f.get('businessType') ?? ''),
      phone: String(f.get('phone') ?? ''),
    };
    try {
      await api.updateProfile(payload);
      await refreshUser();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update profile');
    } finally {
      setBusy(false);
    }
  };

  const submitSettings = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setSaved(false);
    const f = new FormData(e.currentTarget);
    const payload = {
      businessName: String(f.get('businessName') ?? ''),
      businessType: String(f.get('businessType') ?? ''),
      replyToEmail: String(f.get('replyToEmail') ?? ''),
      currency: String(f.get('currency') ?? 'USD'),
      emailNotifications: f.get('emailNotifications') === 'on',
      allowedOrigins: String(f.get('allowedOrigins') ?? '').split(/\r?\n/).map((v) => v.trim()).filter(Boolean),
      dailyEmailCap: Number(f.get('dailyEmailCap') ?? 50),
    };
    try {
      await api.updateSettings(payload);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update settings');
    } finally {
      setBusy(false);
    }
  };

  if (!settings) return error ? <Alert tone="error">{error}</Alert> : <Spinner label="Loading settings…" />;

  return (
    <div className="space-y-5">
      <PageHeader section="Settings" subpage="Workspace">
        <p className="mt-0.5 text-[13px] text-muted">Your business profile, email defaults, and account security.</p>
      </PageHeader>

      {saved ? <Alert tone="success">Saved</Alert> : null}
      {error ? <Alert tone="error">{error}</Alert> : null}

      <div className="grid items-start gap-5 lg:grid-cols-2">
        <Card title="Business profile" subtitle="Shown on emails your customers receive">
          <form onSubmit={submitProfile} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Your name"><Input name="fullName" defaultValue={user?.fullName} /></Field>
              <Field label="Business name"><Input name="businessName" defaultValue={user?.businessName} /></Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Trade">
                <Select name="businessType" defaultValue={user?.businessType}>
                  <option value="">—</option>
                  <option value="plumbing">Plumbing</option>
                  <option value="electrical">Electrical</option>
                  <option value="roofing">Roofing</option>
                  <option value="hvac">HVAC</option>
                  <option value="landscaping">Landscaping</option>
                  <option value="general">General contractor</option>
                  <option value="other">Other</option>
                </Select>
              </Field>
              <Field label="Phone"><Input name="phone" defaultValue={user?.phone} /></Field>
            </div>
            <div className="flex justify-end border-t border-[#eef1f6] pt-4">
              <Button type="submit" disabled={busy} className="w-full sm:w-auto">{busy ? 'Saving…' : 'Save profile'}</Button>
            </div>
          </form>
        </Card>

        <div className="space-y-5">
          <Card title="Email defaults" subtitle="Used when sending customer emails">
            <form onSubmit={submitSettings} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Business name on emails"><Input name="businessName" defaultValue={settings.businessName} /></Field>
                <Field label="Reply-to email"><Input type="email" name="replyToEmail" defaultValue={settings.replyToEmail} /></Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Currency">
                  <Select name="currency" defaultValue={settings.currency}>
                    <option value="ZAR">ZAR — South African Rand</option>
                    <option value="USD">USD — US Dollar</option>
                    <option value="CAD">CAD — Canadian Dollar</option>
                    <option value="GBP">GBP — British Pound</option>
                    <option value="AUD">AUD — Australian Dollar</option>
                    <option value="EUR">EUR — Euro</option>
                  </Select>
                </Field>
                <Field label="Trade">
                  <Select name="businessType" defaultValue={settings.businessType}>
                    <option value="">—</option>
                    <option value="plumbing">Plumbing</option>
                    <option value="electrical">Electrical</option>
                    <option value="roofing">Roofing</option>
                    <option value="hvac">HVAC</option>
                    <option value="landscaping">Landscaping</option>
                    <option value="general">General contractor</option>
                    <option value="other">Other</option>
                  </Select>
                </Field>
              </div>
              <label className="flex items-center gap-2 text-sm text-ink">
                <input type="checkbox" name="emailNotifications" defaultChecked={settings.emailNotifications} className="h-4 w-4 rounded border-[#cfd7e3] text-brand-600 focus:ring-brand-500" />
                Send email notifications for new lead captures
              </label>
              <Field label="Widget website origins" hint="One exact HTTPS origin per line (for example, https://www.example.co.za). Only these websites can submit leads through your widget.">
                <Textarea name="allowedOrigins" rows={4} defaultValue={(settings.allowedOrigins ?? []).join('\n')} placeholder="https://www.example.co.za" />
              </Field>
              <Field label="Daily review email limit" hint="Maximum automated and manual review emails sent per 24-hour window.">
                <Input name="dailyEmailCap" type="number" min={1} max={500} defaultValue={settings.dailyEmailCap ?? 50} />
              </Field>
              <div className="flex justify-end border-t border-[#eef1f6] pt-4">
                <Button type="submit" disabled={busy} className="w-full sm:w-auto">{busy ? 'Saving…' : 'Save email settings'}</Button>
              </div>
            </form>
          </Card>
          <Card title="Privacy & data" subtitle="Manage your information and legal notices">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium text-ink">Export my data</p>
                <p className="text-xs text-muted">Download a JSON copy of your CRM, Reviews and Invoicing records.</p>
              </div>
              <Button variant="secondary" disabled={exporting} onClick={() => {
                setExporting(true);
                void api.exportMyData().catch((err) => setError(err instanceof Error ? err.message : 'Export failed')).finally(() => setExporting(false));
              }}>{exporting ? 'Preparing…' : 'Export data'}</Button>
            </div>
            <div className="mt-4 flex gap-4 border-t border-[#eef1f6] pt-3 text-sm">
              <Link to="/privacy" className="font-medium text-brand-600 hover:underline">Privacy notice</Link>
              <Link to="/terms" className="font-medium text-brand-600 hover:underline">Terms of service</Link>
            </div>
          </Card>
          <Card title="Privacy and account data" subtitle="Export your TradePro data or permanently delete your account.">
            <div className="flex flex-wrap gap-3">
              <Button type="button" variant="secondary" onClick={async () => {
                try {
                  const data = await api.exportAccountData();
                  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                  const url = URL.createObjectURL(blob);
                  const link = document.createElement('a');
                  link.href = url; link.download = 'tradepro-account-export.json'; link.click();
                  URL.revokeObjectURL(url);
                } catch { setError('Unable to export account data. Please try again.'); }
              }}>Export my data</Button>
              <Button type="button" color="danger" onClick={() => setDeleteConfirm(true)}>Delete account</Button>
            </div>
            {deleteConfirm ? <div className="mt-4 space-y-3 rounded-xl border border-red-200 bg-red-50 p-4">
              <p className="text-sm font-semibold text-red-900">This permanently deletes your account and associated CRM, ReviewFlow and Invoicing data.</p>
              <Field label="Confirm your current password"><Input type="password" autoComplete="current-password" value={deletePassword} onChange={e=>setDeletePassword(e.target.value)} /></Field>
              <div className="flex gap-2">
                <Button type="button" color="danger" disabled={!deletePassword} onClick={async()=>{try{await api.deleteAccount(deletePassword);window.location.assign('/login');}catch{setError('Account deletion failed. Check your password and try again.');}finally{setDeletePassword('');setDeleteConfirm(false);}}}>Permanently delete</Button>
                <Button type="button" variant="secondary" onClick={()=>{setDeleteConfirm(false);setDeletePassword('');}}>Cancel</Button>
              </div>
            </div>:null}
          </Card>
        </div>
      </div>
    </div>
  );
}