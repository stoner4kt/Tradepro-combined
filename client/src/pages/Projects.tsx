import { useCallback, useEffect, useState } from 'react';
import * as api from '../lib/api.js';
import { ApiError } from '../lib/api.js';
import type { Client, Project, ProjectPriority, ProjectStatus } from '../types/api.js';
import { Alert, Button, Card, EmptyState, Field, Input, PageHeader, Select, Spinner, Textarea } from '../components/ui.js';
import { Modal } from '../components/Modal.js';
import { PROJECT_PRIORITIES, PROJECT_STATUSES, PriorityBadge, ProjectStatusBadge, ReviewStatusBadge, fmtDate, fmtMoney } from '../components/badges.js';

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    try {
      const params = statusFilter ? `?status=${statusFilter}` : '';
      const res = await api.listProjects(params);
      setProjects(res.projects);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load projects');
    }
  }, [statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-5">
      <PageHeader
        section="Projects"
        subpage={statusFilter ? `Filtered by ${statusFilter.replace('_', ' ')}` : undefined}
        actions={<Button onClick={() => setShowCreate(true)}>+ New project</Button>}
      >
        <p className="mt-0.5 text-[13px] text-muted">Jobs on your board — scheduled, in progress, and done.</p>
      </PageHeader>

      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div className="flex w-max min-w-full items-center gap-2 pb-1">
          {['all', ...PROJECT_STATUSES].map((s) => {
            const active = (statusFilter === '' && s === 'all') || statusFilter === s;
            return (
              <button
                key={s}
                onClick={() => setStatusFilter(s === 'all' ? '' : s)}
                aria-pressed={active}
                className={`h-11 shrink-0 whitespace-nowrap rounded-full px-4 text-xs font-semibold transition duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 ${
                  active
                    ? 'bg-brand-600 text-white shadow-sm shadow-brand-600/25'
                    : 'bg-white text-muted ring-1 ring-inset ring-[#cfd7e3] hover:bg-brand-50 hover:text-brand-700'
                }`}
              >
                {s === 'all' ? 'All' : s.replace('_', ' ')}
              </button>
            );
          })}
        </div>
      </div>

      {error ? <Alert tone="error">{error}</Alert> : null}

      {projects === null ? (
        <Spinner label="Loading projects…" />
      ) : projects.length === 0 ? (
        <EmptyState title="No projects on your board" hint="Win a lead to auto-create a project, or add one manually." action={<Button onClick={() => setShowCreate(true)}>New project</Button>} />
      ) : (
        <>
          <Card className="hidden md:block">
            <div className="-m-[18px] overflow-x-auto">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead>
                  <tr className="border-b border-[#e1e6ee] bg-[#f8fafc] text-xs uppercase tracking-wide text-muted">
                    <th className="px-[18px] py-3 font-semibold">Project</th>
                    <th className="px-3 py-3 font-semibold">Client</th>
                    <th className="px-3 py-3 font-semibold">Priority</th>
                    <th className="px-3 py-3 font-semibold">Status</th>
                    <th className="px-3 py-3 font-semibold">Value</th>
                    <th className="px-3 py-3 font-semibold">Scheduled</th>
                    <th className="px-[18px] py-3 text-right font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#eef1f6]">
                  {projects.map((p) => (
                    <ProjectTableRow key={p.id} project={p} onChanged={load} onError={setError} />
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="space-y-3 md:hidden">
            {projects.map((p) => (
              <ProjectCard key={p.id} project={p} onChanged={load} onError={setError} />
            ))}
            <p className="text-center text-xs text-muted">{projects.length} project{projects.length === 1 ? '' : 's'}</p>
          </div>
        </>
      )}

      {showCreate ? <CreateProjectModal onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); void load(); }} /> : null}
    </div>
  );
}

function useProjectActions(project: Project, onChanged: () => Promise<void>, onError: (m: string) => void) {
  const [open, setOpen] = useState(false);
  const [sendBox, setSendBox] = useState(false);
  const [message, setMessage] = useState('');
  const [sendState, setSendState] = useState<'idle' | 'busy' | 'done'>('idle');
  // ReviewFlow integration (combined dashboard only; guarded by client flag).
  const [review, setReview] = useState<{ status: string | null; busy: boolean } | null>(null);
  const reviewsEnabled = api.isReviewsIntegrationEnabled();

  // The review badge keys on the client's email; falls back to the lead email when
  // the project was auto-created from a won lead. This effect is safe because the
  // flag is a build-time constant..
  useEffect(() => {
    if (!reviewsEnabled) return;
    const email = project.clientEmail ?? project.leadEmail;
    if (!email) return;
    let cancelled = false;
    api.getReviewStatus(email).then((res) => {
      if (cancelled) return;
      const lead = res.status?.leads?.[0];
      setReview({ status: lead?.status ?? null, busy: false });
    }).catch(() => { if (!cancelled) setReview({ status: null, busy: false }); });
    return () => { cancelled = true; };
  }, [reviewsEnabled, project.clientEmail, project.leadEmail]);

  const advance = async (patch: Partial<Project>) => {
    try {
      await api.updateProject(project.id, patch);
      await onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Failed to update project');
    }
  };

  const sendUpdate = async () => {
    if (!message.trim()) return;
    setSendState('busy');
    try {
      await api.sendProjectUpdate(project.id, message.trim());
      setSendState('done');
      setTimeout(() => setSendState('idle'), 2500);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Failed to send update');
      setSendState('idle');
    }
  };

  const sendReview = async () => {
    const email = project.clientEmail ?? project.leadEmail;
    if (!email) { onError('No contact email available for this project'); return; }
    setReview((r) => r ? { ...r, busy: true } : { status: null, busy: true });
    try {
      await api.sendReviewRequest(email, project.id);
      setReview((r) => r ? { ...r, busy: false, status: 'review_sent' } : { status: 'review_sent', busy: false });
      onError('');
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Failed to send review request');
      setReview((r) => r ? { ...r, busy: false } : { status: null, busy: false });
    }
  };

  const del = async () => {
    if (!window.confirm(`Delete project "${project.title}"?`)) return;
    try {
      await api.deleteProject(project.id);
      await onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Failed to delete project');
    }
  };

  return {
    open,
    setOpen,
    sendBox,
    setSendBox,
    message,
    setMessage,
    sendState,
    review,
    reviewsEnabled,
    advance,
    sendUpdate,
    sendReview,
    del,
  };
}

function ProjectStatusChips({ project, onAdvance }: { project: Project; onAdvance: (patch: Partial<Project>) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {PROJECT_STATUSES.filter((s) => s !== 'cancelled').map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => onAdvance({ status: s })}
          className={`h-9 rounded-full px-2.5 text-[11px] font-semibold transition duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 ${
            project.status === s ? 'bg-brand-600 text-white' : 'bg-slate-100 text-muted hover:bg-slate-200 hover:text-ink'
          }`}
        >
          {s.replace('_', ' ')}
        </button>
      ))}
    </div>
  );
}

function ProjectCard({ project, onChanged, onError }: { project: Project; onChanged: () => Promise<void>; onError: (m: string) => void }) {
  const { open, setOpen, sendBox, setSendBox, message, setMessage, sendState, review, reviewsEnabled, advance, sendUpdate, sendReview, del } =
    useProjectActions(project, onChanged, onError);

  return (
    <Card className="transition duration-150 hover:shadow-md">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-ink">{project.title}</p>
          <p className="mt-0.5 text-xs text-muted">
            {project.clientName ?? 'Unknown client'}
            {project.scheduledDate ? ` · scheduled ${fmtDate(project.scheduledDate)}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <PriorityBadge priority={project.priority} />
          <ProjectStatusBadge status={project.status} />
          {review?.status ? <ReviewStatusBadge status={review.status} /> : null}
        </div>
      </div>

      {project.scope ? <p className="mt-3 line-clamp-2 text-sm text-muted">{project.scope}</p> : null}

      <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted">
        <span className="font-semibold text-ink">{project.estValue > 0 ? fmtMoney(project.estValue) : '—'}</span>
        <span>Requested: {fmtDate(project.requestedDate)}</span>
        <span>Completed: {fmtDate(project.completionDate)}</span>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <ProjectStatusChips project={project} onAdvance={advance} />
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => setSendBox((v) => !v)}>Email client</Button>
          {reviewsEnabled ? (
            <Button size="sm" variant="secondary" onClick={() => void sendReview()} disabled={review?.busy}>
              {review?.busy ? 'Sending…' : 'Send Review Request'}
            </Button>
          ) : null}
          <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>Edit</Button>
          <Button size="sm" variant="danger" onClick={() => void del()}>Delete</Button>
        </div>
      </div>

      {sendBox ? (
        <div className="mt-4 flex items-end gap-2 rounded-xl bg-[#eef1f6] p-3">
          <Field label="Message to client">
            <Input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="e.g. We'll be there Thursday 8am." onKeyDown={(e) => e.key === 'Enter' && void sendUpdate()} />
          </Field>
          <Button size="sm" onClick={() => void sendUpdate()} disabled={sendState === 'busy' || !message.trim()}>
            {sendState === 'busy' ? 'Sending…' : sendState === 'done' ? 'Sent' : 'Send'}
          </Button>
        </div>
      ) : null}

      {open ? (
        <EditProjectModal project={project} onClose={() => setOpen(false)} onChanged={async () => { setOpen(false); await onChanged(); }} onError={onError} />
      ) : null}
    </Card>
  );
}

function ProjectTableRow({ project, onChanged, onError }: { project: Project; onChanged: () => Promise<void>; onError: (m: string) => void }) {
  const { open, setOpen, review, reviewsEnabled, advance, sendReview, del } = useProjectActions(project, onChanged, onError);

  return (
    <>
      <tr className="transition duration-150 hover:bg-slate-50">
        <td className="px-[18px] py-3">
          <p className="font-medium text-ink">{project.title}</p>
          <p className="text-xs text-muted">
            {project.scope ? <span className="line-clamp-1 max-w-[260px]">{project.scope}</span> : fmtDate(project.requestedDate)}
          </p>
        </td>
        <td className="px-3 py-3 text-muted">{project.clientName ?? 'Unknown client'}</td>
        <td className="px-3 py-3"><PriorityBadge priority={project.priority} /></td>
        <td className="px-3 py-3"><ProjectStatusBadge status={project.status} />{review?.status ? <div className="mt-1"><ReviewStatusBadge status={review.status} /></div> : null}</td>
        <td className="px-3 py-3 font-medium text-ink">{project.estValue > 0 ? fmtMoney(project.estValue) : '—'}</td>
        <td className="px-3 py-3 text-xs text-muted">{fmtDate(project.scheduledDate)}</td>
        <td className="px-[18px] py-3">
          <div className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1">
            {project.status !== 'cancelled' ? (
              <div className="flex items-center gap-1 rounded-lg bg-slate-50 p-0.5">
                {PROJECT_STATUSES.filter((s) => s !== 'cancelled').map((s) => (
                  <button
                    key={s}
                    type="button"
                    title={`Set ${s.replace('_', ' ')}`}
                    onClick={() => void advance({ status: s })}
                    aria-label={`Set status ${s.replace('_', ' ')}`}
                    className={`h-7 rounded-md px-2 text-[11px] font-semibold transition duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-600 ${
                      project.status === s ? 'bg-brand-600 text-white' : 'text-muted hover:bg-white hover:text-ink'
                    }`}
                  >
                    {s === 'in_progress' ? 'In progress' : s === 'on_hold' ? 'On hold' : s.replace('_', ' ')}
                  </button>
                ))}
              </div>
            ) : null}
            {reviewsEnabled ? (
              <Button size="sm" variant="secondary" onClick={() => void sendReview()} disabled={review?.busy}>
                {review?.busy ? 'Sending…' : 'Review'}
              </Button>
            ) : null}
            <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>Edit</Button>
            <Button size="sm" variant="danger" onClick={() => void del()}>Delete</Button>
          </div>
        </td>
      </tr>
      {open ? (
        <EditProjectModal project={project} onClose={() => setOpen(false)} onChanged={async () => { setOpen(false); await onChanged(); }} onError={onError} />
      ) : null}
    </>
  );
}

function CreateProjectModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [clients, setClients] = useState<Client[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api.listClients().then((r) => setClients(r.clients)).catch(() => setClients([]));
  }, []);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const f = new FormData(e.currentTarget);
    const clientId = String(f.get('clientId') ?? '');
    if (!clientId) {
      setError('Please choose a client');
      setBusy(false);
      return;
    }
    const payload: Record<string, unknown> = {
      clientId,
      title: String(f.get('title') ?? ''),
      scope: String(f.get('scope') ?? ''),
      status: String(f.get('status') ?? 'new'),
      priority: String(f.get('priority') ?? 'normal'),
    };
    for (const k of ['requestedDate', 'scheduledDate', 'completionDate'] as const) {
      const v = String(f.get(k) ?? '');
      if (v) payload[k] = v;
    }
    const val = Number(f.get('estValue'));
    if (val > 0) payload.estValue = val;
    try {
      await api.createProject(payload);
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError && err.fields ? Object.values(err.fields).flat().join(', ') : err instanceof Error ? err.message : 'Failed to create project');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="New project" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Client">
          <Select name="clientId" required>
            <option value="">Choose a client…</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.firstName} {c.lastName} — {c.email}</option>)}
          </Select>
        </Field>
        <Field label="Title"><Input name="title" required placeholder="Water heater replacement" /></Field>
        <Field label="Scope"><Textarea name="scope" placeholder="Details of the work…" /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Status">
            <Select name="status" defaultValue="new">
              {PROJECT_STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
            </Select>
          </Field>
          <Field label="Priority">
            <Select name="priority" defaultValue="normal">
              {PROJECT_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
            </Select>
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Requested"><Input name="requestedDate" type="date" /></Field>
          <Field label="Scheduled"><Input name="scheduledDate" type="date" /></Field>
          <Field label="Completed"><Input name="completionDate" type="date" /></Field>
        </div>
        <Field label="Estimated value"><Input name="estValue" type="number" min={0} step="100" placeholder="5000" /></Field>
        {error ? <Alert tone="error">{error}</Alert> : null}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Create project'}</Button>
        </div>
      </form>
    </Modal>
  );
}

function EditProjectModal({ project, onClose, onChanged, onError }: { project: Project; onClose: () => void; onChanged: () => Promise<void>; onError: (m: string) => void }) {
  const [clients, setClients] = useState<Client[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api.listClients().then((r) => setClients(r.clients)).catch(() => setClients([]));
  }, []);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const f = new FormData(e.currentTarget);
    const payload: Record<string, unknown> = {
      clientId: String(f.get('clientId') ?? ''),
      title: String(f.get('title') ?? ''),
      scope: String(f.get('scope') ?? ''),
      status: String(f.get('status') ?? ''),
      priority: String(f.get('priority') ?? ''),
    };
    for (const k of ['requestedDate', 'scheduledDate', 'completionDate'] as const) {
      const v = String(f.get(k) ?? '');
      payload[k] = v ? v : null;
    }
    const val = Number(f.get('estValue'));
    payload.estValue = val > 0 ? val : 0;
    try {
      await api.updateProject(project.id, payload);
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError && err.fields ? Object.values(err.fields).flat().join(', ') : err instanceof Error ? err.message : 'Failed to update project');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Edit — ${project.title}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Client">
          <Select name="clientId" required defaultValue={project.clientId}>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>)}
          </Select>
        </Field>
        <Field label="Title"><Input name="title" defaultValue={project.title} required /></Field>
        <Field label="Scope"><Textarea name="scope" defaultValue={project.scope} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Status">
            <Select name="status" defaultValue={project.status}>
              {PROJECT_STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
            </Select>
          </Field>
          <Field label="Priority">
            <Select name="priority" defaultValue={project.priority}>
              {PROJECT_PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
            </Select>
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Requested"><Input name="requestedDate" type="date" defaultValue={project.requestedDate ?? ''} /></Field>
          <Field label="Scheduled"><Input name="scheduledDate" type="date" defaultValue={project.scheduledDate ?? ''} /></Field>
          <Field label="Completed"><Input name="completionDate" type="date" defaultValue={project.completionDate ?? ''} /></Field>
        </div>
        <Field label="Estimated value"><Input name="estValue" type="number" min={0} step="100" defaultValue={project.estValue || ''} /></Field>
        {error ? <Alert tone="error">{error}</Alert> : null}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
        </div>
      </form>
    </Modal>
  );
}