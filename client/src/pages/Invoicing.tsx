import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import * as api from '../lib/api.js';
import type {
  InvoicingDocument,
  InvoicingDocumentLine,
  InvoicingKind,
  InvoicingSettings,
  InvoicingStatus,
} from '../types/api.js';
import { Alert, Button, Card, Field, Input, Select, Spinner, Textarea } from '../components/ui.js';
import { Modal } from '../components/Modal.js';

// ---- Invoicing page (quotes & invoices, merged dashboard) ----
// Talks exclusively through the authenticated /api/invoicing/* proxy. When the
// Worker's INVOICING_URL + secret are unset the routes 404 and this page shows
// the same "not configured" empty state as the Reviews tab.

type Tab = 'documents' | 'settings';

const TABS: { id: Tab; label: string }[] = [
  { id: 'documents', label: 'Documents' },
  { id: 'settings', label: 'Settings' },
];

const STATUS_TONES: Record<string, string> = {
  draft: 'slate',
  sent: 'sky',
  accepted: 'emerald',
  declined: 'rose',
  issued: 'blue',
  partially_paid: 'amber',
  paid: 'emerald',
  overdue: 'rose',
  void: 'slate',
};

const EMPTY_SETTINGS: InvoicingSettings = {
  id: '',
  user_id: '',
  business_name: '',
  email: '',
  phone: '',
  reply_to_email: '',
  currency: 'USD',
  locale: 'en-US',
  tax_rate: 0,
  payment_terms_days: 14,
  quote_valid_days: 30,
  invoice_prefix: 'INV-',
  quote_prefix: 'QT-',
  next_invoice_number: 1,
  next_quote_number: 1,
  bank_details: '',
  notes: '',
};

function money(minor: number, currency = 'USD'): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'USD' }).format((minor ?? 0) / 100);
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso.length === 10 ? iso + 'T00:00:00Z' : iso).toLocaleDateString();
}

function statusBadge(status: InvoicingStatus) {
  const tones: Record<string, string> = {
    slate: 'bg-[#e2e8f0] text-[#334155]',
    sky: 'bg-[#dbeafe] text-[#1e40af]',
    blue: 'bg-[#dbeafe] text-[#1e40af]',
    emerald: 'bg-[#dcfce7] text-[#166534]',
    amber: 'bg-[#fef3c7] text-[#92400e]',
    rose: 'bg-[#ffe4e6] text-[#9f1239]',
  };
  return tones[STATUS_TONES[status] ?? 'slate'] ?? tones.slate;
}

function showStatusBadge(status: InvoicingStatus) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${statusBadge(status)}`}>{status.replace(/_/g, ' ')}</span>;
}

function statusFilterOptions(): { value: '' | InvoicingStatus; label: string }[] {
  const options: { value: '' | InvoicingStatus; label: string }[] = [{ value: '', label: 'All statuses' }];
  for (const s of ['draft', 'sent', 'accepted', 'declined', 'issued', 'partially_paid', 'paid', 'overdue', 'void'] as InvoicingStatus[]) {
    options.push({ value: s, label: s.replace(/_/g, ' ') });
  }
  return options;
}

function formatLineQuantity(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

// ---- Document rows (list) -------------------------------------------------

function DocumentsTable({ docs, onEdit, onDelete, onSend, onNew }: {
  docs: InvoicingDocument[];
  onEdit: (d: InvoicingDocument) => void;
  onDelete: (d: InvoicingDocument) => void;
  onSend: (d: InvoicingDocument) => void;
  onNew: (kind: InvoicingKind) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-[#eef1f6] text-xs uppercase tracking-wide text-muted">
            <th className="py-2.5 pr-3 font-semibold">Number</th>
            <th className="py-2.5 pr-3 font-semibold">Customer</th>
            <th className="py-2.5 pr-3 font-semibold">Date</th>
            <th className="py-2.5 pr-3 font-semibold">Total</th>
            <th className="py-2.5 pr-3 font-semibold">Status</th>
            <th className="py-2.5 text-right font-semibold">Actions</th>
          </tr>
        </thead>
        <tbody>
          {docs.map((d) => (
            <tr key={d.id} className="border-b border-[#f5f7fa] last:border-0 hover:bg-slate-50/60">
              <td className="py-3 pr-3 font-medium text-ink">
                <button type="button" onClick={() => onEdit(d)} className="hover:underline">
                  {d.number}
                </button>
              </td>
              <td className="py-3 pr-3 text-muted">{d.customer_snapshot?.name || '—'}</td>
              <td className="py-3 pr-3 text-muted">{fmtDate(d.created_at)}</td>
              <td className="py-3 pr-3 font-semibold text-ink">{money(d.total_minor, d.currency)}</td>
              <td className="py-3 pr-3">{showStatusBadge(d.status)}</td>
              <td className="py-3 text-right">
                <span className="inline-flex items-center gap-2">
                  {d.kind === 'invoice' && ['issued', 'partially_paid', 'overdue'].includes(d.status) ? (
                    <Button variant="secondary" size="sm" onClick={() => onSend(d)}>Resend</Button>
                  ) : null}
                  {['draft', 'sent'].includes(d.status) && d.kind === 'quote' ? (
                    <Button variant="secondary" size="sm" onClick={() => onSend(d)}>Send</Button>
                  ) : null}
                  {d.status === 'draft' ? (
                    <Button variant="ghost" size="sm" onClick={() => onDelete(d)}>Delete</Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={async () => {
                        if (!window.confirm(`Void ${d.number}?`)) return;
                        await api.invoicingDocumentAction(d.id, 'decline').catch(() => undefined);
                        window.location.reload();
                      }}
                    >
                      Void
                    </Button>
                  )}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex gap-2 pt-4">
        <Button onClick={() => onNew('quote')}>New quote</Button>
        <Button variant="secondary" onClick={() => onNew('invoice')}>New invoice</Button>
      </div>
    </div>
  );
}

// ---- Document editor -------------------------------------------------------

interface DraftLine {
  key: string;
  description: string;
  quantity: number;
  unit_price_minor: number;
}

function blankLine(): DraftLine {
  return { key: crypto.randomUUID(), description: '', quantity: 1, unit_price_minor: 0 };
}

function DocumentEditor({ doc, onClose, onSaved }: { doc: InvoicingDocument; onClose: () => void; onSaved: (d: InvoicingDocument) => void }) {
  const [title, setTitle] = useState(doc.title ?? '');
  const [customerName, setCustomerName] = useState(doc.customer_snapshot?.name ?? '');
  const [customerEmail, setCustomerEmail] = useState(doc.customer_snapshot?.email ?? '');
  const [lines, setLines] = useState<DraftLine[]>(
    doc.lines?.length
      ? doc.lines.map((l: InvoicingDocumentLine) => ({
          key: l.id,
          description: l.description,
          quantity: l.quantity,
          unit_price_minor: l.unit_price_minor,
        }))
      : [blankLine()],
  );
  const [currency, setCurrency] = useState(doc.currency || 'USD');
  const [notes, setNotes] = useState(doc.notes ?? '');
  const [dueDate, setDueDate] = useState(doc.due_date ?? '');
  const [validUntil, setValidUntil] = useState(doc.quote_valid_until ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const subtotal = lines.reduce((s, l) => s + Math.round(l.quantity * l.unit_price_minor), 0);
  const tax = 0; // The edge function recalculates totals from settings tax_rate
  const total = subtotal + tax;

  const updateLine = (key: string, patch: Partial<DraftLine>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const payload: Record<string, unknown> = {
        title: title || undefined,
        customer_snapshot: { name: customerName || undefined, email: customerEmail || undefined },
        lines: lines.filter((l) => l.description || l.unit_price_minor > 0).map((l) => ({
          description: l.description,
          quantity: l.quantity,
          unit_price_minor: l.unit_price_minor,
        })),
        currency,
        notes,
      };
      if (doc.kind === 'quote' && validUntil) payload.quote_valid_until = validUntil;
      else if (doc.kind === 'invoice' && dueDate) payload.due_date = dueDate;
      const res = await api.updateInvoicingDocument(doc.id, payload);
      onSaved(res.document);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={`Edit ${doc.kind === 'quote' ? 'quote' : 'invoice'} ${doc.number}`} onClose={onClose}>
      <div className="space-y-4">
        <Field label="Title">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Kitchen remodel — Phase 1" />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Customer name">
            <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
          </Field>
          <Field label="Customer email">
            <Input value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Currency">
            <Select value={currency} onChange={(e) => setCurrency(e.target.value)}>
              <option value="USD">USD — US Dollar</option>
              <option value="EUR">EUR — Euro</option>
              <option value="GBP">GBP — British Pound</option>
              <option value="CAD">CAD — Canadian Dollar</option>
              <option value="AUD">AUD — Australian Dollar</option>
            </Select>
          </Field>
          {doc.kind === 'quote' ? (
            <Field label="Valid until">
              <Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
            </Field>
          ) : (
            <Field label="Due date">
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </Field>
          )}
        </div>

        <div>
          <div className="mb-1.5 block text-sm font-medium text-ink">Line items</div>
          <div className="space-y-2">
            {lines.map((l, i) => (
              <div key={l.key} className="flex items-start gap-2">
                <div className="flex-[2]">
                  <Input
                    value={l.description}
                    onChange={(e) => updateLine(l.key, { description: e.target.value })}
                    placeholder={`Item ${i + 1}`}
                  />
                </div>
                <div className="w-20">
                  <Input
                    type="number"
                    min="0"
                    step="any"
                    value={l.quantity}
                    onChange={(e) => updateLine(l.key, { quantity: Math.max(0, Number(e.target.value) || 0) })}
                  />
                </div>
                <div className="flex-1">
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={l.unit_price_minor / 100}
                    onChange={(e) => updateLine(l.key, { unit_price_minor: Math.round((Number(e.target.value) || 0) * 100) })}
                    placeholder="0.00"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setLines((prev) => prev.filter((x) => x.key !== l.key))}
                  className="mt-2.5 text-muted transition hover:text-[#9f1239]"
                  aria-label={`Remove item ${i + 1}`}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setLines((prev) => [...prev, blankLine()])}
            className="mt-2 text-sm font-semibold text-brand-600 hover:text-brand-700"
          >
            + Add line item
          </button>
        </div>

        <Field label="Notes">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>

        <div className="rounded-lg bg-slate-50 p-3 text-sm">
          <div className="flex justify-between text-muted"><span>Subtotal</span><span>{money(subtotal, currency)}</span></div>
          <div className="flex justify-between text-muted"><span>Tax</span><span>{money(tax, currency)}</span></div>
          <div className="mt-1 flex justify-between font-bold text-ink"><span>Total</span><span>{money(total, currency)}</span></div>
        </div>

        {error ? <Alert tone="error">{error}</Alert> : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </div>
      </div>
    </Modal>
  );
}

// ---- Settings -------------------------------------------------------------

function SettingsForm({ settings, onSaved }: { settings: InvoicingSettings; onSaved: (s: InvoicingSettings) => void }) {
  const [form, setForm] = useState(settings ?? EMPTY_SETTINGS);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k: keyof InvoicingSettings, v: string | number) => setForm((prev) => ({ ...prev, [k]: v }));

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const res = await api.updateInvoicingSettings({
        business_name: form.business_name,
        email: form.email,
        phone: form.phone,
        reply_to_email: form.reply_to_email,
        currency: form.currency,
        locale: form.locale,
        tax_rate: Math.max(0, Math.min(100, Number(form.tax_rate) || 0)),
        payment_terms_days: Math.max(0, Math.round(Number(form.payment_terms_days) || 0)),
        quote_valid_days: Math.max(0, Math.round(Number(form.quote_valid_days) || 0)),
        invoice_prefix: form.invoice_prefix,
        quote_prefix: form.quote_prefix,
        bank_details: form.bank_details,
        notes: form.notes,
      });
      onSaved(res.settings);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Business name">
          <Input value={form.business_name} onChange={(e) => set('business_name', e.target.value)} />
        </Field>
        <Field label="Email">
          <Input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
        </Field>
        <Field label="Phone">
          <Input value={form.phone} onChange={(e) => set('phone', e.target.value)} />
        </Field>
        <Field label="Reply-to email">
          <Input type="email" value={form.reply_to_email} onChange={(e) => set('reply_to_email', e.target.value)} />
        </Field>
        <Field label="Currency">
          <Select value={form.currency} onChange={(e) => set('currency', e.target.value)}>
            <option value="USD">USD</option><option value="EUR">EUR</option><option value="GBP">GBP</option>
            <option value="CAD">CAD</option><option value="AUD">AUD</option>
          </Select>
        </Field>
        <Field label="Tax rate (%)">
          <Input type="number" min="0" max="100" step="0.1" value={form.tax_rate} onChange={(e) => set('tax_rate', Number(e.target.value) || 0)} />
        </Field>
        <Field label="Payment terms (days)">
          <Input type="number" min="0" value={form.payment_terms_days} onChange={(e) => set('payment_terms_days', Number(e.target.value) || 0)} />
        </Field>
        <Field label="Quote validity (days)">
          <Input type="number" min="0" value={form.quote_valid_days} onChange={(e) => set('quote_valid_days', Number(e.target.value) || 0)} />
        </Field>
        <Field label="Invoice prefix">
          <Input value={form.invoice_prefix} onChange={(e) => set('invoice_prefix', e.target.value)} />
        </Field>
        <Field label="Quote prefix">
          <Input value={form.quote_prefix} onChange={(e) => set('quote_prefix', e.target.value)} />
        </Field>
      </div>
      <Field label="Bank / payment details (shown on invoices)">
        <Textarea value={form.bank_details} onChange={(e) => set('bank_details', e.target.value)} />
      </Field>
      <Field label="Notes / thank-you footer">
        <Textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} />
      </Field>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <div className="flex justify-end">
        <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save settings'}</Button>
      </div>
    </div>
  );
}

// ---- Page -----------------------------------------------------------------

export default function InvoicingPage() {
  const location = useLocation();
  const [tab, setTab] = useState<Tab>('documents');
  const [docs, setDocs] = useState<InvoicingDocument[]>([]);
  const [settings, setSettings] = useState<InvoicingSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [kindFilter, setKindFilter] = useState<'' | InvoicingKind>('');
  const [statusFilter, setStatusFilter] = useState<'' | InvoicingStatus>('');
  const [editing, setEditing] = useState<InvoicingDocument | null>(null);

  const enabled = api.isInvoicingEnabled();

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (kindFilter) params.set('kind', kindFilter);
      if (statusFilter) params.set('status', statusFilter);
      const res = await api.listInvoicingDocuments(params.toString() ? `?${params.toString()}` : '');
      setDocs(res.documents ?? []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [kindFilter, statusFilter]);

  useEffect(() => {
    if (!enabled) return;
    void load();
  }, [enabled, load]);

  useEffect(() => {
    if (!enabled) return;
    api.getInvoicingSettings().then((r) => setSettings(r.settings ?? null)).catch(() => undefined);
  }, [enabled]);

  const filtered = useMemo(() => {
    return docs.filter((d) => (!kindFilter || d.kind === kindFilter) && (!statusFilter || d.status === statusFilter));
  }, [docs, kindFilter, statusFilter]);

  // Support deep-link "create quote from project/lead": focus that document.
  useEffect(() => {
    const focusId = (location.state as { focusDocumentId?: string } | null)?.focusDocumentId;
    if (!focusId) return;
    const doc = docs.find((d) => d.id === focusId);
    if (doc) setEditing(doc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state, docs.length]);

  const createDoc = async (kind: InvoicingKind) => {
    try {
      const res = await api.createInvoicingDocument({ kind, title: kind === 'quote' ? 'New quote' : 'New invoice' });
      setDocs((prev) => [res.document, ...prev]);
      setEditing(res.document);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const deleteDoc = async (d: InvoicingDocument) => {
    if (!window.confirm(`Delete draft ${d.number}?`)) return;
    try {
      await api.deleteInvoicingDocument(d.id);
      setDocs((prev) => prev.filter((x) => x.id !== d.id));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const sendDoc = async (d: InvoicingDocument) => {
    try {
      await api.invoicingDocumentAction(d.id, 'send', {});
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  if (!enabled) {
    return (
      <div className="mx-auto max-w-3xl">
        <Card>
          <EmptyReading />
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-white px-[18px] py-3.5 shadow-sm">
        <div>
          <h1 className="text-[15px] font-semibold text-ink">Billing / Invoicing</h1>
          <p className="text-xs text-muted">Quotes &amp; invoices for your projects</p>
        </div>
        <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`rounded-md px-3 py-1.5 text-sm font-semibold transition duration-150 ${
                tab === t.id ? 'bg-white text-ink shadow-sm' : 'text-muted hover:text-ink'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {error ? <Alert tone="error">{error}</Alert> : null}

      {tab === 'documents' ? (
        <Card
          title="Documents"
          subtitle="Quotes and invoices"
          action={
            <div className="flex flex-wrap items-center gap-2">
              <Select value={kindFilter} onChange={(e) => setKindFilter(e.target.value as '' | InvoicingKind)} className="!w-auto">
                <option value="">All kinds</option>
                <option value="quote">Quotes</option>
                <option value="invoice">Invoices</option>
              </Select>
              <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as '' | InvoicingStatus)} className="!w-auto">
                {statusFilterOptions().map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </Select>
            </div>
          }
        >
          {loading ? <Spinner label="Loading documents…" /> : filtered.length === 0 ? (
            <EmptyReading />
          ) : (
            <DocumentsTable
              docs={filtered}
              onEdit={setEditing}
              onDelete={deleteDoc}
              onSend={(d) => void sendDoc(d)}
              onNew={(kind) => void createDoc(kind)}
            />
          )}
        </Card>
      ) : (
        <Card title="Settings" subtitle="Defaults for new quotes and invoices">
          {settings ? (
            <SettingsForm settings={settings} onSaved={setSettings} />
          ) : (
            <Spinner label="Loading settings…" />
          )}
        </Card>
      )}

      {editing ? (
        <DocumentEditor
          doc={editing}
          onClose={() => setEditing(null)}
          onSaved={(d) => setDocs((prev) => prev.map((x) => (x.id === d.id ? d : x)))}
        />
      ) : null}
    </div>
  );
}

function EmptyReading() {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line bg-slate-50/60 px-6 py-12 text-center">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-9 w-9 text-muted/60">
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
      </svg>
      <p className="mt-3 text-sm font-medium text-ink">No documents yet</p>
      <p className="mt-1 max-w-sm text-xs text-muted">
        Invoicing is not configured on this deployment. Set INVOICING_URL + INVOICING_SECRET on the Worker to enable quotes &amp; invoices.
      </p>
    </div>
  );
}