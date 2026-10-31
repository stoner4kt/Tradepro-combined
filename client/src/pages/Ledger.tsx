import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import * as api from '../lib/api.js';
import type { EmailCapture, EmailLog } from '../types/api.js';
import { Alert, Card, EmptyState, PageHeader, Spinner } from '../components/ui.js';
import { timeAgo } from '../components/badges.js';

export default function LedgerPage() {
  const [captures, setCaptures] = useState<EmailCapture[] | null>(null);
  const [logs, setLogs] = useState<EmailLog[] | null>(null);
  const [tab, setTab] = useState<'captures' | 'emails'>('captures');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    void api.listCaptures()
      .then((r) => { if (!cancelled) setCaptures(r.captures); })
      .catch((e) => { if (!cancelled) { setCaptures([]); setError((prev) => prev || (e instanceof Error ? e.message : 'Failed to load captures')); } });
    void api.listEmailLogs()
      .then((r) => { if (!cancelled) setLogs(r.emailLogs); })
      .catch((e) => { if (!cancelled) { setLogs([]); setError((prev) => prev || (e instanceof Error ? e.message : 'Failed to load email log')); } });
    return () => { cancelled = true; };
  }, []);

  const capturesNull = captures ?? [];
  const logsNull = logs ?? [];

  return (
    <div className="space-y-5">
      <PageHeader section="Ledger" subpage={tab === 'captures' ? 'Form captures' : 'Emails sent'}>
        <p className="mt-0.5 text-[13px] text-muted">Website form captures and every email your CRM has sent.</p>
      </PageHeader>

      {error ? <Alert tone="error">{error}</Alert> : null}

      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div className="flex w-max min-w-full items-center gap-2 pb-1">
          <button
            type="button"
            onClick={() => setTab('captures')}
            aria-pressed={tab === 'captures'}
            className={`h-11 shrink-0 rounded-full px-4 text-xs font-semibold transition duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 ${
              tab === 'captures' ? 'bg-brand-600 text-white shadow-sm shadow-brand-600/25' : 'bg-white text-muted ring-1 ring-inset ring-[#cfd7e3] hover:bg-brand-50 hover:text-brand-700'
            }`}
          >
            Captures ({capturesNull.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('emails')}
            aria-pressed={tab === 'emails'}
            className={`h-11 shrink-0 rounded-full px-4 text-xs font-semibold transition duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 ${
              tab === 'emails' ? 'bg-brand-600 text-white shadow-sm shadow-brand-600/25' : 'bg-white text-muted ring-1 ring-inset ring-[#cfd7e3] hover:bg-brand-50 hover:text-brand-700'
            }`}
          >
            Emails ({logsNull.length})
          </button>
        </div>
      </div>

      {tab === 'captures' ? (
        captures === null ? (
          <Spinner label="Loading captures…" />
        ) : captures.length === 0 ? (
          <EmptyState
            title="No form captures yet"
            hint="Embed the public email-capture endpoint in your website's contact form and submissions will show up here."
            action={<Link to="/settings" className="text-sm font-semibold text-brand-600 transition duration-150 hover:text-brand-700">Capture setup</Link>}
          />
        ) : (
          <Card>
            <ul className="divide-y divide-[#eef1f6]">
              {captures.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink">{c.fullName || c.email}</p>
                    <p className="truncate text-xs text-muted">
                      {c.email}{c.phone ? ` · ${c.phone}` : ''}{c.message ? ` · ${c.message}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted">
                    <span className="rounded-full bg-[#e2e8f0] px-2 py-0.5 capitalize text-[#334155]">{c.captureSource}</span>
                    {c.leadId ? <span className="rounded-full bg-[#dcfce7] px-2 py-0.5 font-medium text-[#166534]">lead</span> : null}
                    <span>{timeAgo(c.createdAt)}</span>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        )
      ) : logs === null ? (
        <Spinner label="Loading email log…" />
      ) : logs.length === 0 ? (
        <EmptyState title="No emails sent yet" hint="Welcome emails and project updates you send will be recorded here." />
      ) : (
        <Card>
          <ul className="divide-y divide-[#eef1f6]">
            {logs.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink">{m.subject}</p>
                  <p className="truncate text-xs text-muted">
                    <span className="capitalize">{m.template.replace('_', ' ')}</span> → {m.toEmail}
                  </p>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className={`rounded-full px-2 py-0.5 font-medium ${m.provider === 'resend' ? 'bg-[#dbeafe] text-[#1e40af]' : 'bg-[#e2e8f0] text-[#334155]'}`}>
                    {m.provider}
                  </span>
                  <span className={`rounded-full px-2 py-0.5 font-medium ${m.status === 'sent' ? 'bg-[#dcfce7] text-[#166534]' : 'bg-[#fef3c7] text-[#92400e]'}`}>
                    {m.status}
                  </span>
                  <span className="text-muted">{timeAgo(m.sentAt)}</span>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}