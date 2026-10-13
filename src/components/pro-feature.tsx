'use client';
import Link from 'next/link';
import { LockKeyhole } from 'lucide-react';
import { useAccount } from './account';
import { authPath } from '@/lib/auth/return-path';
import { useTaskReturn } from './task-return';
import { canUseFeature, type ProFeature } from '@/lib/access';

export function useProAccess(feature: ProFeature = 'shadowing-analysis') {
  const account = useAccount();
  return {
    account,
    isPro: canUseFeature(account.user?.plan, feature),
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
  const { destination } = useTaskReturn();
  if (!account.loaded)
    return (
      <p className="pro-feature-notice" role="status">
        Checking feature access…
      </p>
    );
  if (canUseFeature(account.user?.plan, 'shadowing-analysis')) return null;
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
        <Link className="text-button" href={authPath('/sign-in', destination)}>
          Sign in
        </Link>
      ) : (
        <Link className="text-button" href="/account#plans">
          Compare Free and Pro
        </Link>
      )}
    </div>
  );
}
