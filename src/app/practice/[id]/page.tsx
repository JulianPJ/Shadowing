import { Practice } from '@/components/practice';
export default async function PracticePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Practice lessonId={id} />;
}
