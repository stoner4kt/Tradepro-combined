import { type ReactNode, type ButtonHTMLAttributes, type InputHTMLAttributes, type SelectHTMLAttributes } from 'react';

const inputClass =
  'w-full h-11 rounded-lg border border-[#cfd7e3] bg-white px-3.5 text-sm text-ink placeholder-[#8b98aa] shadow-sm outline-none transition focus:border-brand-600 focus:ring-2 focus:ring-brand-600/25';

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputClass} ${props.className ?? ''}`} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${inputClass} ${props.className ?? ''}`} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${inputClass} min-h-[80px] py-2.5 ${props.className ?? ''}`} />;
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-ink">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

const variants = {
  primary:
    'bg-brand-600 text-white shadow-sm shadow-brand-600/20 hover:bg-brand-700 focus-visible:outline-brand-600',
  secondary:
    'bg-white text-ink ring-1 ring-inset ring-[#cfd7e3] hover:bg-slate-50 focus-visible:outline-brand-600',
  danger: 'bg-[#e11d48] text-white hover:bg-[#be123c] focus-visible:outline-[#e11d48]',
  ghost: 'bg-transparent text-muted hover:bg-slate-100 hover:text-ink',
} as const;

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants;
  size?: 'sm' | 'md';
}

export function Button({ variant = 'primary', size = 'md', className, ...props }: ButtonProps) {
  const sizeClass = size === 'sm' ? 'h-9 px-3 text-[13px]' : 'h-11 px-4 text-sm';
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold transition duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${variants[variant]} ${sizeClass} ${className ?? ''}`}
    />
  );
}

export function Card({ title, subtitle, action, children, className }: {
  title?: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl border border-line bg-white shadow-sm ${className ?? ''}`}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-4 border-b border-[#eef1f6] px-[18px] py-4">
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
            {subtitle ? <p className="mt-0.5 text-xs text-muted">{subtitle}</p> : null}
          </div>
          {action}
        </header>
      )}
      <div className="p-[18px]">{children}</div>
    </section>
  );
}

/** White breadcrumb/action bar used at the top of every dashboard page. */
export function PageHeader({ section, subpage, actions, children }: {
  section: string;
  subpage?: string;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-white px-[18px] py-3.5 shadow-sm">
      <div className="min-w-0">
        <h1 className="text-[15px] font-semibold text-ink">
          {section}
          {subpage ? <span className="font-normal text-muted"> / {subpage}</span> : null}
        </h1>
        {children}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Badge({ label, tone }: { label: string; tone: string }) {
  const tones: Record<string, string> = {
    slate: 'bg-[#e2e8f0] text-[#334155]',
    teal: 'bg-[#ccfbf1] text-[#115e59]',
    amber: 'bg-[#fef3c7] text-[#92400e]',
    blue: 'bg-[#dbeafe] text-[#1e40af]',
    sky: 'bg-[#dbeafe] text-[#1e40af]',
    violet: 'bg-[#ede9fe] text-[#5b21b6]',
    rose: 'bg-[#ffe4e6] text-[#9f1239]',
    green: 'bg-[#dcfce7] text-[#166534]',
    emerald: 'bg-[#dcfce7] text-[#166534]',
    cyan: 'bg-[#cffafe] text-[#155e75]',
  };
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${tones[tone] ?? tones.slate}`}>
      {label}
    </span>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line bg-slate-50/60 px-6 py-12 text-center">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-9 w-9 text-muted/60">
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
      </svg>
      <p className="mt-3 text-sm font-medium text-ink">{title}</p>
      {hint ? <p className="mt-1 max-w-sm text-xs text-muted">{hint}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-muted">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600" />
      <span className="text-sm">{label ?? 'Loading…'}</span>
    </div>
  );
}

export function Alert({ tone, children }: { tone: 'error' | 'success'; children: ReactNode }) {
  const cls = tone === 'error' ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700';
  return <div className={`rounded-lg border px-3.5 py-2.5 text-sm ${cls}`}>{children}</div>;
}

export function isTodayOrAfter(d: string): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(d) >= today;
}