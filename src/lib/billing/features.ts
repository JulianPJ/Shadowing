/** Free/Pro comparison shared by the subscription dialog and the public pricing page. */
export const features: [name: string, detail: string, free: boolean][] = [
  ['Comprehension checks', 'Questions on every lesson, with the evidence replayed', false],
  ['Essential vocabulary', 'The topic words that matter most, with meanings', false],
  ['Auto-generated subtitles', 'Accurate subtitles for media without captions', false],
  ['Shadowing Match', 'See how closely your recording follows the speaker', false],
  ['Immersion viewer', 'Discover, imports, captions, transcripts and manual replay', true],
  ['Dictionary lookup', 'Definitions, readings and furigana', true],
  ['Watch Later sync', 'Your watch list and basic viewer preferences across devices', true],
  [
    'Sentence translations',
    'On-demand translations; subtitle-supplied translations stay Free',
    false,
  ],
  ['Detailed difficulty', 'Lesson language demands and breakdowns', false],
  [
    'Recording and advanced drills',
    'Recorded attempts, local diagnostics and hands-free practice',
    false,
  ],
  ['Saved words and sentences', 'Word statuses, vocabulary management and Anki/CSV export', false],
  ['Daily word review', 'Spaced review of the words you save', false],
  [
    'Progress and learning sync',
    'Detailed analytics, weekly reports, daily goals and learning data across devices',
    false,
  ],
];

/** Catalogue prices in GBP, excluding any tax; Paddle shows the final total at checkout. */
export const publicPrices = { monthly: '£3.99', annual: '£29.99', annualPerMonth: '£2.50' };
