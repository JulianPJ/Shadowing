import type { Metadata } from 'next';
import { Home } from '@/components/home';
export const metadata: Metadata = {
  title: 'Discover Japanese videos — Hibiki',
  description: 'Find Japanese videos that fit your curiosity, your pace and your practice.',
};
export default function DiscoverPage() {
  return <Home tab="discover" />;
}
