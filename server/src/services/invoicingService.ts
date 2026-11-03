import { config } from '../utils/config.js';
import { logger } from '../utils/logger.js';

// ---------------------------------------------------------------------------
// Invoicing integration: the merged dashboard talks to the Invoicing edge
// functions. Like ReviewFlow, the edge functions live on the SAME Supabase
// project, so INVOICING_URL ≈ SUPABASE_URL, and every call is scoped by the
// authenticated CRM user's id via the x-user-id header.
//
// The route layer owns the allowlisted verbs; this service is the only place
// that builds the headers. x-integration-secret (INVOICING_SECRET on the
// Worker = INTEGRATION_SECRET on the function) authenticates the call; the
// function additionally requires x-api-key (= SV_API_KEY) for the "active"
// true pdf/view/download endpoints, so we always send both.
// ---------------------------------------------------------------------------

const HEADER_KEYS = ['x-integration-secret', 'x-internal-call', 'x-user-id', 'x-api-key'] as const;

export function invoicingEnabled(): boolean {
  return config.invoicing.enabled;
}

function endpoint(name: string): string {
  return `${config.invoicing.url.replace(/\/+$/, '')}/functions/v1/${name}`;
}

function buildHeaders(userId: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-integration-secret': config.invoicing.secret,
    'x-internal-call': 'true',
    'x-user-id': userId,
  };
  if (config.invoicing.svApiKey) headers['x-api-key'] = config.invoicing.svApiKey;
  return headers;
}

// Allowlist of non-idempotent/mutating actions exposed by the proxy.
export const INVOICING_DOC_ACTIONS = new Set([
  'from-project', 'from-lead', 'send', 'accept', 'decline', 'mark-paid',
]);

async function forward(
  method: string,
  userId: string,
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; body: Record<string, unknown> | null }> {
  if (!config.invoicing.enabled) return { ok: false, status: 404, body: null };
  const init: RequestInit = { method, headers: buildHeaders(userId) };
  if (body !== undefined) init.body = JSON.stringify(body);
  try {
    const res = await fetch(`${endpoint('invoicing-api')}${path}`, init);
    let data: unknown = null;
    try { data = await res.json(); } catch { /* non-JSON (html/pdf) */ }
    return { ok: res.ok, status: res.status, body: (data ?? {}) as Record<string, unknown> };
  } catch (err) {
    logger.error('Invoicing proxy errored', { path, method, err: (err as Error).message });
    return { ok: false, status: 502, body: null };
  }
}

// ---- Documents ------------------------------------------------------------

export async function getInvoicingDocuments(userId: string, query = '') {
  return forward('GET', userId, `/documents${query}`);
}

export async function getInvoicingDocument(userId: string, id: string) {
  return forward('GET', userId, `/documents/${id}`);
}

export async function createInvoicingDocument(userId: string, input: Record<string, unknown>) {
  return forward('POST', userId, '/documents', input);
}

export async function updateInvoicingDocument(userId: string, id: string, patch: Record<string, unknown>) {
  return forward('PATCH', userId, `/documents/${id}`, patch);
}

export async function deleteInvoicingDocument(userId: string, id: string) {
  return forward('DELETE', userId, `/documents/${id}`);
}

export async function invoicingDocumentFromProject(userId: string, projectId: string, kind: 'quote' | 'invoice') {
  return forward('POST', userId, `/documents/from-project?projectId=${encodeURIComponent(projectId)}&kind=${kind}`, {});
}

export async function invoicingDocumentFromLead(userId: string, leadId: string, kind: 'quote' | 'invoice') {
  return forward('POST', userId, `/documents/from-lead?leadId=${encodeURIComponent(leadId)}&kind=${kind}`, {});
}

export async function invoicingDocumentAction(userId: string, id: string, action: string, extra?: Record<string, unknown>) {
  return forward('POST', userId, `/documents/${id}/${action}`, extra ?? {});
}

export async function getInvoicingDocumentContent(userId: string, id: string, what: 'pdf' | 'view' | 'download') {
  return forward('GET', userId, `/documents/${id}/${what}?active=true`);
}

// ---- Payments -------------------------------------------------------------

export async function listInvoicingPayments(userId: string, documentId: string) {
  return forward('GET', userId, `/documents/${documentId}/payments`);
}

export async function addInvoicingPayment(userId: string, documentId: string, input: Record<string, unknown>) {
  return forward('POST', userId, `/documents/${documentId}/payments`, input);
}

export async function deleteInvoicingPayment(userId: string, paymentId: string) {
  return forward('DELETE', userId, `/payments/${paymentId}`);
}

// ---- Settings / revenue ---------------------------------------------------

export async function getInvoicingSettings(userId: string) {
  return forward('GET', userId, '/settings');
}

export async function updateInvoicingSettings(userId: string, patch: Record<string, unknown>) {
  return forward('PUT', userId, '/settings', patch);
}

export async function getInvoicingRevenue(userId: string) {
  return forward('GET', userId, '/revenue');
}