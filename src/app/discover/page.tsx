import type { Metadata } from 'next';
import { Discover } from '@/components/discover/feed';
export const metadata: Metadata = {
  title: 'Discover Japanese videos — Hibiki',
  description: 'Find Japanese videos that fit your curiosity, your pace and your practice.',
};
export default function DiscoverPage() {
  return <Discover />;
}
