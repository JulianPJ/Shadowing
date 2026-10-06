import { Practice } from '@/components/practice';

export default async function PracticePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ section?: string | string[] }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const sectionId = typeof query.section === 'string' ? query.section : undefined;
  return <Practice lessonId={id} sectionId={sectionId} />;
}
