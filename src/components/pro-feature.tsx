'use client';
import Link from 'next/link';
import { LockKeyhole } from 'lucide-react';
import { useAccount } from './account';

export function useProAccess() {
  const account = useAccount();
  return {
    account,
    isPro: account.user?.plan === 'pro',
  };
}

export function ProFeatureNotice({
  feature,
  compact = false,
}: {
  feature: string;
  compact?: boolean;
}) {
  const { account } = useProAccess();
  return (
    <div className={`pro-feature-notice${compact ? ' compact' : ''}`} role="status">
      <LockKeyhole size={compact ? 14 : 17} />
      <div>
        <strong>{feature} is a Hibiki Pro feature.</strong>
        <p>
          {account.user
            ? 'This account is currently on Hibiki Free.'
            : 'Sign in with a Hibiki Pro account to use this feature.'}
        </p>
      </div>
      {!account.user ? (
        <Link className="text-button" href="/sign-in">
          Sign in
        </Link>
      ) : null}
    </div>
  );
}
