import { Practice } from '@/components/practice';

export default async function PracticePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ section?: string | string[]; transcript?: string | string[] }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const sectionId = typeof query.section === 'string' ? query.section : undefined;
  const expectedTranscript = typeof query.transcript === 'string' ? query.transcript : undefined;
  return <Practice lessonId={id} sectionId={sectionId} expectedTranscript={expectedTranscript} />;
}
