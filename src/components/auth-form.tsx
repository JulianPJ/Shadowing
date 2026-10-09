'use client';
import Link from 'next/link';
import { Eye, EyeOff } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { authClient } from '@/lib/auth/client';
import { authPath, safeReturnPath } from '@/lib/auth/return-path';
import { refreshAccount } from '@/lib/sync/client';
import { useAccount } from './account';
import { TaskReturn } from './chrome';
export function AuthForm({ screen = 'sign-in' }: { screen?: 'sign-in' | 'register' | 'reset' }) {
  const router = useRouter(),
    account = useAccount();
  const [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [name, setName] = useState('');
  const [message, setMessage] = useState(''),
    [failed, setFailed] = useState(false),
    [busy, setBusy] = useState(false);
  const [visible, setVisible] = useState(false),
    [verificationNeeded, setVerificationNeeded] = useState(false);
  const [token, setToken] = useState<string | null>(null),
    [returnTo, setReturnTo] = useState('/account');
  const running = useRef(false);
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setToken(params.get('token'));
    setReturnTo(safeReturnPath(params.get('returnTo')));
    if (params.get('error')) {
      setMessage('This sign-in or email link could not be completed. Try again.');
      setFailed(true);
    }
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */
  async function run(operation: () => Promise<void>) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setMessage('');
    setFailed(false);
    try {
      await operation();
    } catch {
      setMessage('Could not reach the account service. Please try again.');
      setFailed(true);
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    await run(async () => {
      setVerificationNeeded(false);
      const result =
        screen === 'register'
          ? await authClient.signUp.email({ email, password, name, callbackURL: returnTo })
          : screen === 'reset'
            ? token
              ? await authClient.resetPassword({ token, newPassword: password })
              : await authClient.requestPasswordReset({
                  email,
                  redirectTo: authPath('/reset-password', returnTo),
                })
            : await authClient.signIn.email({ email, password, callbackURL: returnTo });
      if (result.error) {
        setMessage(result.error.message ?? 'Could not complete this request.');
        setFailed(true);
        setVerificationNeeded(
          result.error.code === 'EMAIL_NOT_VERIFIED' ||
            /email.*verif|verif.*email/i.test(result.error.message ?? ''),
        );
        return;
      }
      if (screen === 'register') setMessage('Check your email to verify your account and sign in.');
      else if (screen === 'reset')
        setMessage(
          token
            ? 'Password updated. You can sign in now.'
            : 'If this email has an account, a password link will arrive shortly.',
        );
      else {
        await refreshAccount();
        router.push(returnTo);
      }
    });
  }
  const emailActionNeedsDelivery = screen === 'register' || (screen === 'reset' && !token);
  const emailActionUnavailable = emailActionNeedsDelivery && !account.emailEnabled;
  const title =
    screen === 'register'
      ? 'Make room for your progress'
      : screen === 'reset'
        ? 'Reset your password'
        : 'Welcome back';
  return (
    <>
      <TaskReturn />
      <main className="account-screen">
        <h1>{title}</h1>
        <p className="muted">
          Save your practice across devices. You can always practise without an account.
        </p>
        {!account.loaded ? <p role="status">Checking available sign-in methods…</p> : null}
        {screen !== 'reset' && account.googleEnabled ? (
          <>
            <button
              className="button full-width"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const result = await authClient.signIn.social({
                    provider: 'google',
                    callbackURL: returnTo,
                    errorCallbackURL: authPath('/sign-in', returnTo),
                  });
                  if (result.error) {
                    setMessage(result.error.message ?? 'Google sign-in could not start.');
                    setFailed(true);
                  }
                })
              }
            >
              Continue with Google
            </button>
            <div className="auth-divider">or use email</div>
          </>
        ) : null}
        <form onSubmit={(event) => void submit(event)} className="auth-form" aria-busy={busy}>
          {screen === 'register' ? (
            <label>
              Name
              <input
                name="name"
                autoComplete="name"
                required
                maxLength={100}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
          ) : null}
          {!token ? (
            <label>
              Email
              <input
                name="email"
                type="email"
                autoComplete="email"
                required
                maxLength={254}
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setVerificationNeeded(false);
                }}
              />
            </label>
          ) : null}
          {screen !== 'reset' || token ? (
            <div className="password-field">
              <label htmlFor="auth-password">Password</label>
              <div>
                <input
                  id="auth-password"
                  name="password"
                  type={visible ? 'text' : 'password'}
                  autoComplete={screen === 'sign-in' ? 'current-password' : 'new-password'}
                  required
                  minLength={12}
                  maxLength={128}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
                <button
                  type="button"
                  className="icon-button"
                  aria-label={visible ? 'Hide password' : 'Show password'}
                  aria-pressed={visible}
                  onClick={() => setVisible(!visible)}
                >
                  {visible ? <EyeOff size={19} /> : <Eye size={19} />}
                </button>
              </div>
            </div>
          ) : null}
          <button
            className="button primary full-width"
            disabled={busy || !account.loaded || emailActionUnavailable}
          >
            {busy
              ? 'Please wait…'
              : screen === 'register'
                ? 'Create account'
                : screen === 'reset'
                  ? token
                    ? 'Set new password'
                    : 'Send password link'
                  : 'Sign in'}
          </button>
        </form>
        {account.loaded && emailActionUnavailable ? (
          <p role="status">
            Email {screen === 'register' ? 'registration' : 'password recovery'} is temporarily
            unavailable.{' '}
            {account.googleEnabled
              ? 'Use Google sign-in'
              : 'Use your existing email and password to sign in'}
            , or keep practising.
          </p>
        ) : null}
        {screen === 'reset' && emailActionUnavailable && account.googleEnabled ? (
          <Link className="button" href={authPath('/sign-in', returnTo)}>
            Continue with Google
          </Link>
        ) : null}
        {message ? <p role={failed ? 'alert' : 'status'}>{message}</p> : null}
        {screen === 'sign-in' && email && account.emailEnabled && verificationNeeded ? (
          <button
            className="button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const result = await authClient.sendVerificationEmail({
                  email,
                  callbackURL: returnTo,
                });
                setMessage(
                  result.error?.message ??
                    'If your account needs verification, an email will arrive shortly.',
                );
                setFailed(!!result.error);
              })
            }
          >
            Resend verification email
          </button>
        ) : null}
        <div className="account-actions">
          {screen === 'sign-in' ? (
            <>
              <Link href={authPath('/register', returnTo)}>Create an account</Link>
              <Link href={authPath('/reset-password', returnTo)}>Forgot password?</Link>
            </>
          ) : (
            <Link href={authPath('/sign-in', returnTo)}>Back to sign in</Link>
          )}
          <Link href={returnTo === '/account' ? '/' : returnTo}>Keep practising</Link>
        </div>
      </main>
    </>
  );
}
