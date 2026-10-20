import type { Metadata } from 'next';
import { DiscoverPage } from '@/components/home';
export const metadata: Metadata = {
  title: 'Discover Japanese videos — Hibiki',
  description: 'Find Japanese videos that fit your curiosity, your pace and your practice.',
};
export default function Page() {
  return <DiscoverPage />;
}
