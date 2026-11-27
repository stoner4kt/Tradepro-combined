import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Alert, Button, Field, Input } from '../components/ui.js';
import * as api from '../lib/api.js';

function Shell({title,children}:{title:string;children:ReactNode}){
 return <main className="flex min-h-screen items-center justify-center bg-page px-4 py-8"><section className="w-full max-w-md rounded-xl border border-line bg-white p-6 shadow-sm"><h1 className="mb-4 text-xl font-bold text-ink">{title}</h1>{children}</section></main>;
}
export function CheckYourInboxPage(){return <Shell title="Check your inbox"><p className="text-sm text-muted">If your registration can be completed, TradePro has sent a verification link. Open it to verify your email and finish signing in.</p><p className="mt-5 text-sm"><Link to="/login" className="font-semibold text-brand-600">Back to sign in</Link></p></Shell>;}
export function ForgotPasswordPage(){
 const [email,setEmail]=useState('');const [message,setMessage]=useState('');const [error,setError]=useState('');const [busy,setBusy]=useState(false);
 const submit=async(e:FormEvent)=>{e.preventDefault();setBusy(true);setError('');try{const r=await api.forgotPassword(email);setMessage(r.message);}catch(err){setError(err instanceof Error?err.message:'Unable to submit request');}finally{setBusy(false);}};
 return <Shell title="Reset your password"><form onSubmit={submit} className="space-y-4"><Field label="Email"><Input type="email" autoComplete="email" required value={email} onChange={e=>setEmail(e.target.value)}/></Field>{message?<Alert tone="success">{message}</Alert>:null}{error?<Alert tone="error">{error}</Alert>:null}<Button type="submit" disabled={busy} className="w-full">{busy?'Sending…':'Send reset link'}</Button><p className="text-center text-sm"><Link to="/login" className="text-brand-600">Back to sign in</Link></p></form></Shell>;
}
export function ResetPasswordPage(){
 const [params]=useSearchParams();const [password,setPassword]=useState('');const [message,setMessage]=useState('');const [error,setError]=useState('');const [busy,setBusy]=useState(false);const navigate=useNavigate();
 const submit=async(e:FormEvent)=>{e.preventDefault();setBusy(true);setError('');try{const r=await api.resetPassword(params.get('token')||'',password);setMessage(r.message);setTimeout(()=>navigate('/login'),900);}catch(err){setError(err instanceof Error?err.message:'Reset failed');}finally{setBusy(false);}};
 return <Shell title="Choose a new password"><form onSubmit={submit} className="space-y-4"><Field label="New password" hint="Use 10–128 characters"><Input type="password" autoComplete="new-password" minLength={10} maxLength={128} required value={password} onChange={e=>setPassword(e.target.value)}/></Field>{message?<Alert tone="success">{message}</Alert>:null}{error?<Alert tone="error">{error}</Alert>:null}<Button type="submit" disabled={busy||!params.get('token')} className="w-full">{busy?'Updating…':'Update password'}</Button></form></Shell>;
}
export function VerifyEmailPage(){
 const [params]=useSearchParams();const [state,setState]=useState('Verifying your email…');const [error,setError]=useState('');
 useEffect(()=>{const token=params.get('token');if(!token){setError('This verification link is invalid or incomplete.');return;}api.verifyEmail(token).then(()=>setState('Your email is verified. You can now sign in.')).catch(()=>setError('This verification link is invalid or has expired.'));},[params]);
 return <Shell title="Email verification">{error?<Alert tone="error">{error}</Alert>:<p className="text-sm text-muted">{state}</p>}<p className="mt-5 text-sm"><Link to="/login" className="font-semibold text-brand-600">Continue to sign in</Link></p></Shell>;
}
