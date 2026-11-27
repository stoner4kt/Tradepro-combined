import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

function origin(value) {
  if (!value) return null;
  try { return new URL(value).origin; } catch { throw new Error('VITE_API_URL and VITE_SUPABASE_URL must be valid URLs'); }
}
const api = origin(process.env.VITE_API_URL);
const supabase = origin(process.env.VITE_SUPABASE_URL);
const connect = ["'self'", api, supabase].filter(Boolean).join(' ');
const headers = `/*
  X-Content-Type-Options: nosniff
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  Referrer-Policy: no-referrer
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  X-Frame-Options: DENY
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src ${connect}; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'; upgrade-insecure-requests

/q/*
  X-Robots-Tag: noindex
  Referrer-Policy: no-referrer

/i/*
  X-Robots-Tag: noindex
  Referrer-Policy: no-referrer
`;
await mkdir(resolve('dist'), { recursive: true });
await writeFile(resolve('dist/_headers'), headers, 'utf8');
