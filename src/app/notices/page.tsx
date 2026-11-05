import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Notices — Hibiki' };

/** Third-party data and software that Hibiki ships to the browser, with their licences. */
export default function NoticesPage() {
  return (
    <main className="notices-main">
      <h1>Notices</h1>
      <p>Hibiki is built with the help of these dictionaries and libraries.</p>
      <section>
        <h2>JMdict</h2>
        <p>
          Dictionary definitions come from{' '}
          <a
            href="https://www.edrdg.org/wiki/index.php/JMdict-EDICT_Dictionary_Project"
            target="_blank"
            rel="noreferrer"
          >
            JMdict
          </a>
          , © James William Breen and the Electronic Dictionary Research and Development Group, used
          under the{' '}
          <a href="https://www.edrdg.org/edrdg/licence.html" target="_blank" rel="noreferrer">
            EDRDG licence
          </a>{' '}
          (
          <a
            href="https://creativecommons.org/licenses/by-sa/4.0/"
            target="_blank"
            rel="noreferrer"
          >
            CC BY-SA 4.0
          </a>
          ). The English data was converted to JSON by scriptin (jmdict-simplified) and compacted by
          Hibiki; the derived data is shared under the same licence. Hibiki is not endorsed by
          EDRDG. <a href="/lexicon/NOTICE.txt">Full notice</a>.
        </p>
        <p>
          “Common in JMdict” is a dictionary marker, not a frequency rank. No dictionary audio is
          included.
        </p>
      </section>
      <section>
        <h2>Kuromoji and IPADIC</h2>
        <p>
          Furigana and word boundaries use kuromoji.js (
          <a href="/furigana/v1/LICENSE-2.0.txt">Apache License 2.0</a>) with mecab-ipadic, © Nara
          Institute of Science and Technology. <a href="/furigana/v1/NOTICE.md">Full notice</a>.
        </p>
      </section>
      <section>
        <h2>Mediabunny</h2>
        <p>
          Audio from your own media files is prepared with Mediabunny. Mediabunny is used under the{' '}
          <a href="/furigana/v1/MEDIABUNNY-LICENSE.txt">Mozilla Public License 2.0</a>.
        </p>
      </section>
    </main>
  );
}
