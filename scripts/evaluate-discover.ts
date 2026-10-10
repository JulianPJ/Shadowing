// Prints the Discover relevance evaluation on the labelled fixtures. No network, no quota.
import { evaluateDiscover, evaluatePersonas } from '../tests/helpers/discover-evaluation';

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
console.log(
  '\n| Persona | Precision@10 | Verified in top 10 | Within one band | More than one band harder | More than one band easier | Prepared in top 10 | Channels in top 10 | First level match |',
);
console.log('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
for (const row of await evaluatePersonas())
  console.log(
    `| ${row.persona} | ${pct(row.p10)} | ${row.verifiedInTop10} | ${row.withinOneBand} | ${row.tooHard} | ${row.tooEasy} | ${row.preparedInTop10} | ${row.channelsInTop10} | ${row.firstLevelMatch || '–'} |`,
  );
