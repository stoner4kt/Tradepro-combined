/**
 * ReviewFlow widget -- zero-dependency vanilla TypeScript.
 * Reads its config from data-* attributes on the script tag:
 *   data-api-key      (required)  -- the client's widget_api_key
 *   data-position      bottom-right | bottom-left (default bottom-right)
 *   data-color         hex colour (default #0ea5e9)
 *   data-button-text   floating button label (default "Get in Touch")
 *
 * Exposes window.ReviewFlow.capture(data) for existing contact forms.
 */

interface WidgetConfig {
  apiKey: string;
  position: 'bottom-right' | 'bottom-left';
  color: string;
  buttonText: string;
  supabaseUrl?: string;
}

interface CaptureData {
  first_name?: string;
  last_name?: string;
  email: string;
  phone?: string;
  service?: string;
  message?: string;
}

const STATE_OPEN = 'open';
const STATE_THANKS = 'thanks';
const STATE_CLOSED = 'closed';

const DEFAULT_COLOR = '#0ea5e9';

const STYLE_SHEET = `
.rfw *, .rfw *::before, .rfw *::after { box-sizing: border-box; }
.rfw { all: initial; }
.rfw-button {
  position: fixed; z-index: 2147483000; bottom: 20px; right: 20px;
  display: flex; align-items: center; gap: 8px;
  border: none; cursor: pointer;
  background: var(--rf-primary); color: #fff;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 14px; font-weight: 600;
  padding: 12px 20px; border-radius: 9999px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}
.rfw-button:hover { transform: translateY(-2px); box-shadow: 0 12px 28px rgba(0, 0, 0, 0.5); }
.rfw-button.rfw-hidden { display: none; }
.rfw-position-bottom-left .rfw-button { right: auto; left: 20px; }
.rfw-panel {
  position: fixed; z-index: 2147483001; bottom: 90px; right: 20px;
  width: 380px; max-width: calc(100vw - 40px);
  background: var(--rf-card); color: var(--rf-text);
  border: 1px solid var(--rf-border); border-radius: 16px;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.6);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  overflow: hidden; display: none;
  transform: translateY(12px); opacity: 0;
  transition: opacity 0.2s ease, transform 0.25s ease;
}
.rfw-panel.rfw-open { display: block; transform: translateY(0); opacity: 1; }
.rfw-panel.rfw-thanks .rfw-form { display: none; }
.rfw-position-bottom-left .rfw-panel { right: auto; left: 20px; }
.rfw-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 18px; background: linear-gradient(135deg, #0b0f19, #0d1629);
  border-bottom: 1px solid var(--rf-border);
}
.rfw-header-title { display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 700; color: #fff; }
.rfw-header-star { color: var(--rf-primary); font-size: 18px; }
.rfw-close {
  background: none; border: none; cursor: pointer;
  color: var(--rf-muted); font-size: 18px; line-height: 1; padding: 4px;
}
.rfw-close:hover { color: #fff; }
.rfw-form { padding: 18px; display: flex; flex-direction: column; gap: 10px; }
.rfw-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.rfw-field label {
  display: block; font-size: 11px; font-weight: 600; letter-spacing: 0.04em;
  text-transform: uppercase; color: var(--rf-muted); margin-bottom: 5px;
}
.rfw-field input, .rfw-field textarea {
  width: 100%; background: var(--rf-bg);
  border: 1px solid var(--rf-border); border-radius: 10px;
  color: var(--rf-text); font-size: 14px; padding: 10px 12px;
  outline: none; transition: border-color 0.15s ease;
}
.rfw-field input:focus, .rfw-field textarea:focus { border-color: var(--rf-primary); }
.rfw-field input::placeholder, .rfw-field textarea::placeholder { color: rgba(148, 163, 184, 0.45); }
.rfw-field textarea { resize: vertical; min-height: 72px; }
.rfw-field .rfw-required { color: var(--rf-primary); }
.rfw-submit {
  margin-top: 4px; width: 100%; padding: 12px; border: none; cursor: pointer;
  background: var(--rf-primary); color: #fff; font-size: 14px; font-weight: 700;
  border-radius: 10px; transition: opacity 0.15s ease;
}
.rfw-submit:hover { opacity: 0.9; }
.rfw-submit:disabled { opacity: 0.6; cursor: wait; }
.rfw-error {
  display: none; font-size: 12px; color: #fda4af; background: rgba(244, 63, 94, 0.1);
  border: 1px solid rgba(244, 63, 94, 0.3); border-radius: 8px; padding: 8px 10px;
}
.rfw-error.rfw-show { display: block; }
.rfw-thanks { display: none; padding: 36px 24px; text-align: center; }
.rfw-thanks-icon { font-size: 36px; }
.rfw-panel.rfw-thanks .rfw-thanks { display: block; }
.rfw-thanks-title { font-size: 17px; font-weight: 700; color: #fff; margin-top: 10px; }
.rfw-thanks-text { font-size: 13px; color: var(--rf-muted); margin-top: 6px; line-height: 1.5; }
.rfw-footer { padding: 10px 18px; text-align: center; font-size: 10px; color: rgba(148, 163, 184, 0.6); border-top: 1px solid var(--rf-border); }
.rfw-footer a { color: var(--rf-primary); text-decoration: none; }
@media (max-width: 480px) {
  .rfw-button { bottom: 16px; right: 16px; left: 16px; width: auto; justify-content: center; padding: 12px 16px; }
  .rfw-panel { bottom: 0; right: 0; left: 0; width: 100%; max-width: none; border-radius: 16px 16px 0 0; }
  .rfw-position-bottom-left .rfw-panel { left: 0; right: 0; }
}
`;

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = hex.replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return null;
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}

function normaliseHex(value: string): string | null {
  const v = value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(v)) return v.toLowerCase();
  const m = v.match(/^([0-9a-fA-F]{3})$/);
  if (m) {
    const [r, g, b] = m[1];
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return null;
}

function applyTheme(color: string): void {
  const root = document.documentElement;
  const primary = normaliseHex(color) || DEFAULT_COLOR;
  root.style.setProperty('--rf-primary', primary);
  root.style.setProperty('--rf-primary-soft', 'rgba(14, 165, 233, 0.12)');
  root.style.setProperty('--rf-bg', '#070b14');
  root.style.setProperty('--rf-card', '#0d1629');
  root.style.setProperty('--rf-border', '#1a2234');
  root.style.setProperty('--rf-text', '#f1f5f9');
  root.style.setProperty('--rf-muted', '#94a3b8');
  const rgb = hexToRgb(primary);
  if (rgb) root.style.setProperty('--rf-primary-soft', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.12)`);
}

function escapeText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function readConfig(): WidgetConfig | null {
  const script =
    document.querySelector<HTMLScriptElement>('script[src*="widget.js"][data-api-key]') ||
    document.querySelector<HTMLScriptElement>('script[data-api-key][src*="widget.js"]');

  const apiKey = script?.dataset.apiKey;
  if (!apiKey) {
    console.warn('[ReviewFlow] Missing data-api-key attribute on the script tag.');
    return null;
  }

  return {
    apiKey,
    position: script?.dataset.position === 'bottom-left' ? 'bottom-left' : 'bottom-right',
    color: script?.dataset.color || DEFAULT_COLOR,
    buttonText: script?.dataset.buttonText || 'Get in Touch',
    // Optional — lets the script tag point at the client's Supabase project.
    supabaseUrl: script?.dataset.supabaseUrl || undefined,
  };
}

function supabaseFunctionUrl(name: string, config: WidgetConfig): string {
  const envUrl = ((import.meta.env && import.meta.env.VITE_SUPABASE_URL) as string | undefined) || '';
  const base = config.supabaseUrl || envUrl || '#FUNCTIONS_BASE#';
  return `${base.replace(/\/$/, '')}/functions/v1/${name}`;
}

function makeWidget(config: WidgetConfig): void {
  const { apiKey, position, color, buttonText } = config;

  const styleEl = document.createElement('style');
  styleEl.id = 'reviewflow-style';
  styleEl.textContent = STYLE_SHEET;
  document.head.appendChild(styleEl);
  applyTheme(color);

  const root = document.createElement('div');
  root.className = 'rfw';
  root.classList.add(position === 'bottom-left' ? 'rfw-position-bottom-left' : 'rfw-position-bottom-right');

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'rfw-button';
  button.innerHTML = `<span>${escapeText(buttonText)}</span><span class="rfw-header-star">★</span>`;

  const panel = document.createElement('div');
  panel.className = 'rfw-panel';
  panel.innerHTML = `
    <div class="rfw-header">
      <div class="rfw-header-title"><span class="rfw-header-star">★</span> <span>Get in Touch</span></div>
      <button type="button" class="rfw-close" aria-label="Close">×</button>
    </div>
    <form class="rfw-form" novalidate>
      <div class="rfw-row">
        <div class="rfw-field">
          <label>First name</label>
          <input name="first_name" type="text" autocomplete="given-name" />
        </div>
        <div class="rfw-field">
          <label>Last name</label>
          <input name="last_name" type="text" autocomplete="family-name" />
        </div>
      </div>
      <div class="rfw-field">
        <label>Email <span class="rfw-required">*</span></label>
        <input name="email" type="email" required autocomplete="email" placeholder="you@example.com" />
      </div>
      <div class="rfw-field">
        <label>Phone</label>
        <input name="phone" type="tel" autocomplete="tel" />
      </div>
      <div class="rfw-field">
        <label>Service</label>
        <input name="service" type="text" placeholder="What do you need?" />
      </div>
      <div class="rfw-field">
        <label>Message</label>
        <textarea name="message" rows="3" placeholder="Optional notes…"></textarea>
      </div>
      <p class="rfw-error"></p>
      <button type="submit" class="rfw-submit">Send Message</button>
    </form>
    <div class="rfw-thanks">
      <div class="rfw-thanks-icon">✓</div>
      <p class="rfw-thanks-title">Thank you!</p>
      <p class="rfw-thanks-text">Your message has been received. We'll be in touch soon.</p>
    </div>
    <div class="rfw-footer">Powered by <a href="https://conextsol.co.za" target="_blank" rel="noopener">ReviewFlow</a> by Conextsol</div>
  `;

  root.appendChild(button);
  root.appendChild(panel);
  document.body.appendChild(root);

  const form = panel.querySelector<HTMLFormElement>('.rfw-form')!;
  const errorEl = panel.querySelector<HTMLParagraphElement>('.rfw-error')!;
  const emailEl = form.elements.namedItem('email') as HTMLInputElement;
  const submitBtn = panel.querySelector<HTMLButtonElement>('.rfw-submit')!;
  const closeBtn = panel.querySelector<HTMLButtonElement>('.rfw-close')!;

  let mode = STATE_CLOSED;

  function setState(next: string): void {
    mode = next;
    const isOpen = next === STATE_OPEN || next === STATE_THANKS;
    panel.classList.toggle('rfw-open', isOpen);
    panel.classList.toggle('rfw-thanks', next === STATE_THANKS);
    button.classList.toggle('rfw-hidden', isOpen);
  }

  function showError(message: string): void {
    errorEl.textContent = message;
    errorEl.classList.add('rfw-show');
  }

  function hideError(): void {
    errorEl.textContent = '';
    errorEl.classList.remove('rfw-show');
  }

  async function submit(data: CaptureData): Promise<{ ok: boolean; error?: string }> {
    if (!data.email) return { ok: false, error: 'Email is required.' };
    const email = data.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return { ok: false, error: 'Please enter a valid email address.' };
    }

    try {
      const res = await fetch(supabaseFunctionUrl('capture-lead', config), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-widget-key': apiKey,
        },
        body: JSON.stringify({
          first_name: data.first_name || '',
          last_name: data.last_name || '',
          email,
          phone: data.phone || null,
          service: data.service || null,
          message: data.message || null,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) return { ok: false, error: json.error || `Request failed (${res.status})` };
      return { ok: true };
    } catch {
      return { ok: false, error: 'Network error. Please try again.' };
    }
  }

  button.addEventListener('click', () => {
    if (mode === STATE_OPEN || mode === STATE_THANKS) {
      setState(STATE_CLOSED);
      return;
    }
    hideError();
    setState(STATE_OPEN);
    window.setTimeout(() => emailEl.focus(), 50);
  });

  closeBtn.addEventListener('click', () => setState(STATE_CLOSED));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError();
    if (!emailEl.validity.valid) {
      showError('Please enter a valid email address.');
      return;
    }
    const fd = new FormData(form);
    const data: CaptureData = {
      first_name: String(fd.get('first_name') || ''),
      last_name: String(fd.get('last_name') || ''),
      email: String(fd.get('email') || ''),
      phone: String(fd.get('phone') || ''),
      service: String(fd.get('service') || ''),
      message: String(fd.get('message') || ''),
    };
    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending…';
    const result = await submit(data);
    submitBtn.disabled = false;
    submitBtn.textContent = 'Send Message';
    if (result.ok) {
      form.reset();
      setState(STATE_THANKS);
      window.setTimeout(() => setState(STATE_CLOSED), 4000);
    } else {
      showError(result.error || 'Something went wrong.');
    }
  });

  // Programmatic capture API for existing contact forms.
  (window as unknown as Record<string, unknown> & { ReviewFlow?: unknown }).ReviewFlow = {
    capture: (dataInput: CaptureData): Promise<{ ok: boolean; error?: string }> => {
      hideError();
      return submit(dataInput);
    },
  };
}

// Boot.
(function init(): void {
  const w = window as unknown as { __RFW_LOADED__?: boolean; ReviewFlow?: unknown };
  if (w.__RFW_LOADED__) return;
  w.__RFW_LOADED__ = true;

  const config = readConfig();
  if (!config) {
    // Still expose an inert capture API so existing forms don't hard-crash.
    w.ReviewFlow = {
      capture: () =>
        Promise.resolve({ ok: false, error: 'ReviewFlow widget is not configured (missing data-api-key).' }),
    };
    return;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => makeWidget(config));
  } else {
    makeWidget(config);
  }
})();

declare global {
  interface Window {
    __RFW_LOADED__?: boolean;
    ReviewFlow?: unknown;
  }
}