// Prints the Discover relevance evaluation on the labelled fixtures. No network, no quota.
import { evaluateDiscover } from '../tests/helpers/discover-evaluation';

const result = await evaluateDiscover();
const pct = (n: number) => `${Math.round(n * 100)}%`;
console.log('| Set | Candidates | Accepted | Relevant accepted | Precision | Recall |');
console.log('| --- | ---: | ---: | ---: | ---: | ---: |');
for (const row of result.catalogue)
  console.log(
    `| ${row.label} | ${row.candidates} | ${row.accepted} | ${row.relevantAccepted} | ${pct(row.precision)} | ${pct(row.recall)} |`,
  );
console.log('\n| Feed | Precision@10 | Precision@24 | Channels in top 24 | Eligible |');
console.log('| --- | ---: | ---: | ---: | ---: |');
for (const [label, feed] of Object.entries(result.feed))
  console.log(
    `| ${label} | ${pct(feed.p10)} | ${pct(feed.p24)} | ${feed.channelsInTop24} | ${feed.items} |`,
  );
console.log('\nRejection reasons:', JSON.stringify(result.rejectionReasons));
console.log(
  'Relevant accepted by search level target:',
  JSON.stringify(result.levelTargetCoverage),
);
console.log('Language evidence of accepted videos:', JSON.stringify(result.languageEvidence));
console.log('Accepted with captions reported:', result.captionsReportedAccepted);
console.log('False positives:', result.falsePositives);
console.log('False negatives:', result.falseNegatives);
