// Shared money + formatting helpers for the Invoicing edge functions.
// All monetary values are stored as integer minor units (cents) to avoid
// floating-point drift; formatting happens only at display time.

export interface MoneyFormatOptions {
  currency?: string;
  locale?: string;
  showCode?: boolean;
}

export function fmtMoney(minor: number | null | undefined, opts: MoneyFormatOptions = {}): string {
  const { currency = "USD", locale = "en-US", showCode = false } = opts;
  const amount = (minor ?? 0) / 100;
  const formatted = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    currencyDisplay: showCode ? "code" : "symbol",
  }).format(amount);
  return formatted;
}

export function minorAmount(amount: number | string): number {
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

export function roundMinor(minor: number | null | undefined): number {
  return Math.round(minor ?? 0);
}

export function pctOf(base: number, rate: number): number {
  return Math.round(base * rate);
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addDaysISO(date: string, days: number): string {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function formatDate(iso: string | null | undefined, locale = "en-US"): string {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? iso + "T00:00:00Z" : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric" });
}