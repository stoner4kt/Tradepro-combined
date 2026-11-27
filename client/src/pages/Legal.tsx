import { Link } from 'react-router-dom';

function LegalLayout({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-page px-4 py-10">
      <article className="mx-auto max-w-3xl rounded-xl border border-line bg-white p-6 shadow-sm sm:p-10">
        <Link to="/" className="text-sm font-semibold text-brand-600 hover:underline">← Back to TradePro</Link>
        <h1 className="mt-6 text-2xl font-bold text-ink">{title}</h1>
        <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-amber-700">Draft placeholder — owner/legal review required before launch</p>
        <div className="prose prose-slate mt-6 max-w-none text-sm">{children}</div>
      </article>
    </main>
  );
}

export function PrivacyPage() {
  return (
    <LegalLayout title="Privacy notice">
      <h2>Responsible party</h2><p>TODO: Insert the legal name, registration details and contact details of the responsible party.</p>
      <h2>Information and purposes</h2><p>TODO: Describe customer, lead, account, communication, consent and technical data collected, and the lawful purposes for each use.</p>
      <h2>Operators and service providers</h2><p>TODO: Describe Supabase, Cloudflare, Resend and any other processors, their roles, locations and applicable safeguards.</p>
      <h2>Retention and security</h2><p>TODO: Set retention periods, deletion rules, access controls, backups and incident response procedures.</p>
      <h2>Your rights</h2><p>TODO: Explain access, correction, objection, deletion, portability and complaint processes under applicable privacy law, including POPIA where applicable.</p>
      <h2>Contact</h2><p>TODO: Add a monitored privacy contact address and response timeframe.</p>
    </LegalLayout>
  );
}

export function TermsPage() {
  return (
    <LegalLayout title="Terms of service">
      <h2>Provider and service</h2><p>TODO: Identify the contracting entity, service scope, subscription terms and support channels.</p>
      <h2>Customer responsibilities</h2><p>TODO: Describe acceptable use, account security, data accuracy, consent obligations and prohibited conduct.</p>
      <h2>Fees and cancellation</h2><p>TODO: Insert pricing, billing, renewal, cancellation, refunds and trial terms.</p>
      <h2>Availability and liability</h2><p>TODO: Have counsel review service availability, warranties, limitations, liability and dispute resolution.</p>
      <h2>Contact</h2><p>TODO: Add the provider's legal and support contact details.</p>
    </LegalLayout>
  );
}
