'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { authClient } from '@/lib/auth/client';
import { refreshAccount } from '@/lib/sync/client';
import { useAccount } from './account';
export function AuthForm({ screen = 'sign-in' }: { screen?: 'sign-in' | 'register' | 'reset' }) {
  const router = useRouter(),
    account = useAccount(),
    [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [name, setName] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [token, setToken] = useState<string | null>(null);
  /* Browser URL hydration reads the reset token only in memory. */
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setToken(params.get('token'));
    if (params.get('error'))
      setMessage('This sign-in or email link could not be completed. Try again.');
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const result =
        screen === 'register'
          ? await authClient.signUp.email({ email, password, name, callbackURL: '/account' })
          : screen === 'reset'
            ? token
              ? await authClient.resetPassword({ token, newPassword: password })
              : await authClient.requestPasswordReset({ email, redirectTo: '/reset-password' })
            : await authClient.signIn.email({ email, password, callbackURL: '/account' });
      if (result.error) {
        setMessage(result.error.message ?? 'Could not complete this request.');
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
        router.push('/account');
      }
    } catch {
      setMessage('Could not reach the account service. Please try again.');
    } finally {
      setBusy(false);
    }
  }
  async function google() {
    setBusy(true);
    const result = await authClient.signIn.social({
      provider: 'google',
      callbackURL: '/account',
      errorCallbackURL: '/sign-in',
    });
    if (result.error) setMessage(result.error.message ?? 'Google sign-in could not start.');
    setBusy(false);
  }
  const title =
    screen === 'register'
      ? 'Make room for your progress'
      : screen === 'reset'
        ? 'Reset your password'
        : 'Welcome back';
  return (
    <main className="account-screen">
      <Link className="eyebrow" href="/">
        HIBIKI · A LITTLE PROGRESS, EVERY DAY
      </Link>
      <h1>{title}</h1>
      <p className="muted">
        Save your practice across devices. You can always practice without an account.
      </p>
      {screen !== 'reset' ? (
        <>
          <button
            className="button full-width"
            onClick={() => void google()}
            disabled={busy || !account.googleEnabled}
          >
            Continue with Google
          </button>
          {!account.googleEnabled ? (
            <p className="small muted">Google sign-in is awaiting configuration.</p>
          ) : null}
          <div className="auth-divider">or use email</div>
        </>
      ) : null}
      <form onSubmit={(event) => void submit(event)} className="auth-form">
        {screen === 'register' ? (
          <label>
            Name
            <input
              name="name"
              autoComplete="name"
              required
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
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
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
        ) : null}
        {screen !== 'reset' || token ? (
          <label>
            Password
            <input
              name="password"
              type="password"
              autoComplete={screen === 'sign-in' ? 'current-password' : 'new-password'}
              required
              minLength={12}
              maxLength={128}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
        ) : null}
        <button className="button primary full-width" disabled={busy}>
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
      {message ? <p role="status">{message}</p> : null}
      {screen === 'sign-in' && email ? (
        <button
          className="button"
          disabled={busy}
          onClick={() =>
            void authClient
              .sendVerificationEmail({ email, callbackURL: '/account' })
              .then((result) =>
                setMessage(
                  result.error?.message ??
                    'If your account needs verification, an email will arrive shortly.',
                ),
              )
          }
        >
          Resend verification email
        </button>
      ) : null}
      <div className="account-actions">
        {screen === 'sign-in' ? (
          <>
            <Link href="/register">Create an account</Link>
            <Link href="/reset-password">Forgot password?</Link>
          </>
        ) : (
          <Link href="/sign-in">Back to sign in</Link>
        )}
        <Link href="/">Keep practicing</Link>
      </div>
    </main>
  );
}
