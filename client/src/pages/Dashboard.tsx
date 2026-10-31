import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import * as api from '../lib/api.js';
import type { ActivityFeed, DashboardStats } from '../types/api.js';
import { Card, EmptyState, PageHeader, Spinner } from '../components/ui.js';
import { LeadStatusBadge, ProjectStatusBadge, fmtMoney, timeAgo } from '../components/badges.js';
import { useAuth } from '../contexts/AuthContext.js';

export default function DashboardPage() {
  const { user } = useAuth();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [activity, setActivity] = useState<ActivityFeed | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    void api
      .getDashboardStats()
      .then((r) => setStats(r.stats))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load dashboard'));
    void api
      .getDashboardActivity()
      .then(setActivity)
      .catch(() => setActivity(null));
  }, []);

  if (error) {
    return <div className="text-sm text-rose-600">{error}</div>;
  }

  if (!stats) return <Spinner label="Loading dashboard…" />;

  const first = user?.fullName?.split(' ')[0] || user?.businessName || 'there';
  const recentCaptures = activity?.captures ?? [];
  const recentEmails = activity?.emailLogs ?? [];

  const kpis = [
    { label: 'Total leads', value: stats.totalLeads, to: '/leads', bg: 'bg-[#dbeafe]', accent: 'text-[#1e40af]', icon: 'M15.75 5.25a3 3 0 013 3v3m0 0a3 3 0 01-3 3h-3m3-6a3 3 0 00-3-3H5.25a3 3 0 00-3 3v9a3 3 0 003 3h9a3 3 0 003-3m-6-9a3 3 0 00-3 3v3m6-6a3 3 0 10-3-3' },
    { label: 'New leads', value: stats.newLeads, to: '/leads', bg: 'bg-[#eaf2ff]', accent: 'text-brand-600', icon: 'M12 6v6m0 0v6m0-6h6M6 12h6' },
    { label: 'Won', value: stats.wonLeads, to: '/leads?status=won', bg: 'bg-[#dcfce7]', accent: 'text-[#166534]', icon: 'M4.5 12.75l6 6 9-13.5' },
    { label: 'Active projects', value: stats.activeProjects, to: '/projects', bg: 'bg-[#fef3c7]', accent: 'text-[#92400e]', icon: 'M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23-.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5' },
    { label: 'Completed', value: stats.completedProjects, to: '/projects', bg: 'bg-[#dcfce7]', accent: 'text-[#166534]', icon: 'M4.5 12.75l6 6 9-13.5' },
    { label: 'Clients', value: stats.totalClients, to: '/clients', bg: 'bg-[#ede9fe]', accent: 'text-[#5b21b6]', icon: 'M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0z' },
    { label: 'Emails sent', value: stats.emailsSent, to: '/ledger', bg: 'bg-[#e2e8f0]', accent: 'text-[#334155]', icon: 'M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75' },
  ];

  const viewAllClass = 'text-xs font-semibold text-brand-600 transition duration-150 hover:text-brand-700';

  return (
    <div className="space-y-5">
      <PageHeader section="Dashboard" subpage="Overview">
        <p className="mt-0.5 text-[13px] text-muted">
          Good {dayPeriod()}, {first}. Here's what's happening across your business today.
        </p>
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
        {kpis.map((kpi) => (
          <Link
            key={kpi.label}
            to={kpi.to}
            className="group rounded-xl border border-line bg-white p-4 shadow-sm transition duration-150 hover:border-brand-500/50 hover:shadow-md"
          >
            <span className={`mb-3 inline-flex h-9 w-9 items-center justify-center rounded-lg ${kpi.bg}`}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className={`h-[18px] w-[18px] ${kpi.accent}`}>
                <path strokeLinecap="round" strokeLinejoin="round" d={kpi.icon} />
              </svg>
            </span>
            <p className="text-2xl font-bold tracking-tight text-ink">{kpi.value}</p>
            <p className="mt-0.5 text-xs font-medium text-muted">{kpi.label}</p>
          </Link>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Recent leads" subtitle="Newest captures first" action={<Link to="/leads" className={viewAllClass}>View all</Link>}>
          {stats.recentLeads.length === 0 ? (
            <EmptyState title="No leads yet" hint="Add your first lead or embed the lead capture widget on your website." />
          ) : (
            <ul className="divide-y divide-[#eef1f6]">
              {stats.recentLeads.map((lead) => (
                <li key={lead.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink">{lead.firstName} {lead.lastName}</p>
                    <p className="truncate text-xs text-muted">{lead.email} {lead.service ? `· ${lead.service}` : ''}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {lead.estimatedValue > 0 ? <span className="text-xs font-semibold text-muted">{fmtMoney(lead.estimatedValue)}</span> : null}
                    <LeadStatusBadge status={lead.status} />
                    <span className="hidden text-xs text-muted sm:block">{timeAgo(lead.createdAt)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Recent projects" action={<Link to="/projects" className={viewAllClass}>View all</Link>}>
          {stats.recentProjects.length === 0 ? (
            <EmptyState title="No projects yet" hint="Projects are created when you win a lead, or add one directly." />
          ) : (
            <ul className="divide-y divide-[#eef1f6]">
              {stats.recentProjects.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink">{p.title}</p>
                    <p className="truncate text-xs text-muted">{p.clientName ?? 'Unknown client'}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <ProjectStatusBadge status={p.status} />
                    <span className="hidden text-xs text-muted sm:block">{timeAgo(p.updatedAt)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {(recentCaptures.length > 0 || recentEmails.length > 0) && (
        <Card title="Activity" subtitle="Latest form captures and emails sent">
          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Form captures</p>
              {recentCaptures.length === 0 ? (
                <p className="text-sm text-muted">No website captures yet.</p>
              ) : (
                <ul className="space-y-2.5">
                  {recentCaptures.slice(0, 6).map((c) => (
                    <li key={c.id} className="flex items-center gap-3 text-sm">
                      <span className="h-2 w-2 shrink-0 rounded-full bg-[#1d6fe8]" />
                      <span className="min-w-0 flex-1 truncate">
                        <span className="font-medium text-ink">{c.fullName || c.email}</span>
                        <span className="text-muted"> · {c.email}</span>
                      </span>
                      <span className="shrink-0 text-xs text-muted">{timeAgo(c.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Emails sent</p>
              {recentEmails.length === 0 ? (
                <p className="text-sm text-muted">No emails sent yet.</p>
              ) : (
                <ul className="space-y-2.5">
                  {recentEmails.slice(0, 6).map((m) => (
                    <li key={m.id} className="flex items-center gap-3 text-sm">
                      <span className="h-2 w-2 shrink-0 rounded-full bg-[#166534]" />
                      <span className="min-w-0 flex-1 truncate">
                        <span className="font-medium text-ink">{m.subject}</span>
                        <span className="text-muted"> → {m.toEmail}</span>
                      </span>
                      <span className="shrink-0 text-xs text-muted">{timeAgo(m.sentAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

function dayPeriod(): string {
  const h = new Date().getHours();
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  return 'evening';
}