// Shared types + helpers for the Invoicing edge functions.
// Mirrors the `invoicing` schema rows (migration 0004).

export type DocumentKind = "quote" | "invoice";
export type DocumentStatus =
  | "draft" | "sent" | "accepted" | "declined"
  | "issued" | "partially_paid" | "paid" | "overdue" | "void";

export interface Settings {
  id: string;
  user_id: string;
  business_name: string;
  email: string;
  phone: string;
  reply_to_email: string;
  currency: string;
  locale: string;
  tax_rate: number;
  payment_terms_days: number;
  quote_valid_days: number;
  invoice_prefix: string;
  quote_prefix: string;
  next_invoice_number: number;
  next_quote_number: number;
  bank_details: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface Document {
  id: string;
  user_id: string;
  kind: DocumentKind;
  number: string;
  status: DocumentStatus;
  external_customer_ref: string | null;
  external_project_ref: string | null;
  external_lead_ref: string | null;
  // customer_snapshot: { name, email, phone, address{city,state,zip,street_line1,street_line2}, note }
  customer_snapshot: Record<string, unknown>;
  issue_date: string | null;
  due_date: string | null;
  quote_valid_until: string | null;
  title: string;
  notes: string;
  currency: string;
  subtotal_minor: number;
  tax_minor: number;
  total_minor: number;
  amount_paid_minor: number;
  token: string;
  sent_at: string | null;
  meta: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface DocumentLine {
  id: string;
  user_id: string;
  document_id: string;
  description: string;
  quantity: number;
  unit_price_minor: number;
  sort_order: number;
  created_at: string;
}

export interface Payment {
  id: string;
  user_id: string;
  document_id: string;
  amount_minor: number;
  method: string;
  received_at: string;
  notes: string;
  created_at: string;
}

export interface EmailEvent {
  id: string;
  user_id: string;
  document_id: string;
  kind: string;
  to_email: string;
  subject: string;
  message_id: string | null;
  status: string;
  meta: Record<string, unknown>;
  created_at: string;
}

export interface DocumentWithLines extends Document {
  lines: DocumentLine[];
}

export const DOCUMENT_STATUSES: DocumentStatus[] = [
  "draft", "sent", "accepted", "declined",
  "issued", "partially_paid", "paid", "overdue", "void",
];

export const QUOTE_STATUSES: DocumentStatus[] = ["draft", "sent", "accepted", "declined", "void"];
export const INVOICE_STATUSES: DocumentStatus[] = ["draft", "issued", "partially_paid", "paid", "overdue", "void"];

export function statusLabel(status: string): string {
  return status.replace(/_/g, " ");
}