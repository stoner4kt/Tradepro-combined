import { Router, type Request, type Response } from 'express';
import { asyncHandler, sendError } from '../lib/http.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth.js';
import {
  INVOICING_DOC_ACTIONS,
  addInvoicingPayment,
  createInvoicingDocument,
  deleteInvoicingDocument,
  deleteInvoicingPayment,
  getInvoicingDocument,
  getInvoicingDocumentContent,
  getInvoicingDocuments,
  getInvoicingRevenue,
  getInvoicingSettings,
  invoicingDocumentAction,
  invoicingDocumentFromLead,
  invoicingDocumentFromProject,
  invoicingEnabled,
  listInvoicingPayments,
  updateInvoicingDocument,
  updateInvoicingSettings,
} from '../services/invoicingService.js';
import type { Store } from '../store/Store.js';

// ---------------------------------------------------------------------------
// Invoicing (quotes & invoices) proxy - the combined dashboard talks to the
// Invoicing edge functions through these authenticated CRM endpoints instead
// of calling Supabase edge functions directly (single outbound entry point,
// env-config driven, mirroring /api/integration/reviews/*).
//
// Every route 404s when the integration is not configured so a pure-CRM
// deploy is unaffected. Only the routes implemented here are reachable — the
// edge function's own public share endpoints (invoicing-public) are served
// by Supabase directly and are intentionally NOT proxied.
// ---------------------------------------------------------------------------

export function invoicingRoutes(_store: Store): Router {
  const router = Router();
  router.use(requireAuth);

  const userId = (req: Request): string => (req as AuthedRequest).user!.id;

  const ensureEnabled = (req: Request, res: Response): boolean => {
    if (invoicingEnabled()) return true;
    sendError(res, 404, 'Invoicing integration is not enabled');
    return false;
  };

  // ---- Documents ----
  router.get(
    '/invoicing/documents',
    asyncHandler(async (req, res) => {
      if (!ensureEnabled(req, res)) return;
      const query = new URLSearchParams();
      for (const k of ['kind', 'status', 'limit', 'offset'] as const) {
        const v = req.query[k];
        if (typeof v === 'string' && v) query.set(k, v);
      }
      const qs = query.toString();
      const result = await getInvoicingDocuments(userId(req), qs ? `?${qs}` : '');
      res.status(result.status).json(result.body ?? {});
    }),
  );

  router.get(
    '/invoicing/documents/:id',
    asyncHandler(async (req, res) => {
      if (!ensureEnabled(req, res)) return;
      const result = await getInvoicingDocument(userId(req), String(req.params.id));
      res.status(result.status).json(result.body ?? {});
    }),
  );

  router.post(
    '/invoicing/documents',
    asyncHandler(async (req, res) => {
      if (!ensureEnabled(req, res)) return;
      const result = await createInvoicingDocument(userId(req), req.body ?? {});
      res.status(result.status).json(result.body ?? { error: { message: 'Failed to create document' } });
    }),
  );

  router.patch(
    '/invoicing/documents/:id',
    asyncHandler(async (req, res) => {
      if (!ensureEnabled(req, res)) return;
      const result = await updateInvoicingDocument(userId(req), String(req.params.id), req.body ?? {});
      res.status(result.status).json(result.body ?? {});
    }),
  );

  router.delete(
    '/invoicing/documents/:id',
    asyncHandler(async (req, res) => {
      if (!ensureEnabled(req, res)) return;
      const result = await deleteInvoicingDocument(userId(req), String(req.params.id));
      res.status(result.status).json(result.body ?? {});
    }),
  );

  // Document actions — strictly allowlisted.
  router.post(
    '/invoicing/documents/:id/:action',
    asyncHandler(async (req, res) => {
      if (!ensureEnabled(req, res)) return;
      const action = String(req.params.action);
      if (!INVOICING_DOC_ACTIONS.has(action)) {
        return sendError(res, 400, `Unsupported document action: ${action}`);
      }
      const result = await invoicingDocumentAction(userId(req), String(req.params.id), action, req.body ?? {});
      res.status(result.status).json(result.body ?? {});
    }),
  );

  // from-project / from-lead constructors.
  router.post(
    '/invoicing/from-project',
    asyncHandler(async (req, res) => {
      if (!ensureEnabled(req, res)) return;
      const projectId = String(req.body?.projectId ?? req.query.projectId ?? '');
      const kind = String(req.body?.kind ?? 'quote') === 'invoice' ? 'invoice' as const : 'quote' as const;
      if (!projectId) return sendError(res, 400, 'projectId is required');
      const result = await invoicingDocumentFromProject(userId(req), projectId, kind);
      res.status(result.status).json(result.body ?? { error: { message: 'Failed to create document' } });
    }),
  );

  router.post(
    '/invoicing/from-lead',
    asyncHandler(async (req, res) => {
      if (!ensureEnabled(req, res)) return;
      const leadId = String(req.body?.leadId ?? req.query.leadId ?? '');
      const kind = String(req.body?.kind ?? 'quote') === 'invoice' ? 'invoice' as const : 'quote' as const;
      if (!leadId) return sendError(res, 400, 'leadId is required');
      const result = await invoicingDocumentFromLead(userId(req), leadId, kind);
      res.status(result.status).json(result.body ?? { error: { message: 'Failed to create document' } });
    }),
  );

  // pdf / view / download (active=true share endpoints, proxied with x-api-key).
  router.get(
    '/invoicing/documents/:id/content/:what',
    asyncHandler(async (req, res) => {
      if (!ensureEnabled(req, res)) return;
      const what = String(req.params.what);
      if (what !== 'pdf' && what !== 'view' && what !== 'download') {
        return sendError(res, 400, 'content must be one of pdf|view|download');
      }
      const result = await getInvoicingDocumentContent(userId(req), String(req.params.id), what);
      res.status(result.status).json(result.body ?? {});
    }),
  );

  // ---- Payments ----
  router.get(
    '/invoicing/payments/:documentId',
    asyncHandler(async (req, res) => {
      if (!ensureEnabled(req, res)) return;
      const result = await listInvoicingPayments(userId(req), String(req.params.documentId));
      res.status(result.status).json(result.body ?? {});
    }),
  );

  router.post(
    '/invoicing/payments/:documentId',
    asyncHandler(async (req, res) => {
      if (!ensureEnabled(req, res)) return;
      const result = await addInvoicingPayment(userId(req), String(req.params.documentId), req.body ?? {});
      res.status(result.status).json(result.body ?? {});
    }),
  );

  router.delete(
    '/invoicing/payments/:paymentId',
    asyncHandler(async (req, res) => {
      if (!ensureEnabled(req, res)) return;
      const result = await deleteInvoicingPayment(userId(req), String(req.params.paymentId));
      res.status(result.status).json(result.body ?? {});
    }),
  );

  // ---- Settings ----
  router.get(
    '/invoicing/settings',
    asyncHandler(async (req, res) => {
      if (!ensureEnabled(req, res)) return;
      const result = await getInvoicingSettings(userId(req));
      res.status(result.status).json(result.body ?? {});
    }),
  );

  router.put(
    '/invoicing/settings',
    asyncHandler(async (req, res) => {
      if (!ensureEnabled(req, res)) return;
      const result = await updateInvoicingSettings(userId(req), req.body ?? {});
      res.status(result.status).json(result.body ?? {});
    }),
  );

  // ---- Revenue ----
  router.get(
    '/invoicing/revenue',
    asyncHandler(async (req, res) => {
      if (!ensureEnabled(req, res)) return;
      const result = await getInvoicingRevenue(userId(req));
      res.status(result.status).json(result.body ?? {});
    }),
  );

  return router;
}