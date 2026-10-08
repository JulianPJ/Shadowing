import { PersonalDictionary } from '@/components/personal-dictionary';

export default async function DictionaryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  return (
    <PersonalDictionary
      view={params.view === 'decks' ? 'decks' : 'saved'}
      deckId={typeof params.deck === 'string' ? params.deck : 'all'}
    />
  );
}
