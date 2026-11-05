// Document numbering for the Invoicing edge functions.
//
// Every user has a per-kind counter (invoicing.settings.next_invoice_number /
// next_quote_number) and a prefix (invoice_prefix / quote_prefix). Numbers are
// minted inside an SQL transaction so two concurrent requests cannot produce
// the same number for the same user + kind. Total patience of 15 seconds is
// enough for the tx-local advisory lock; exceeding it aborts the request.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.48.0";

export const MAX_WAIT_MS = 15_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Mints the next number for the user + kind and persists a provisional
 * document row. Returns [id, number] or throws on exhaustion/timeouts.
 */
export async function newDocumentId(
  admin: SupabaseClient,
  userId: string,
  kind: "quote" | "invoice",
): Promise<{ id: string; number: string }> {
  const started = Date.now();
  for (;;) {
    try {
      const { data, error } = await admin.rpc("invoicing.mint_document_number", {
        p_user_id: userId,
        p_kind: kind,
      });
      if (error) throw error;
      if (data && (data as { id?: string; number?: string }).id) {
        return {
          id: String((data as { id: string }).id),
          number: String((data as { number: string }).number),
        };
      }
      throw new Error("mint_document_number returned no row");
    } catch (err) {
      // Lock busy -> retry; real errors -> surface.
      const msg = (err as { message?: string }).message || "";
      const locked = /lock/i.test(msg);
      if (locked && Date.now() - started < MAX_WAIT_MS) {
        await sleep(120 + Math.random() * 200);
        continue;
      }
      throw err;
    }
  }
}