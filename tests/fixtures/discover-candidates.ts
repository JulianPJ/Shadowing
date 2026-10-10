import baseline from './discover-baseline-2026-10-10.json' with { type: 'json' };
import type { LevelTarget } from '../../src/lib/discover/acquisition';
import type { QualityInput } from '../../src/lib/discover/quality';
import type { Band, Topic } from '../../src/lib/discover/types';

/**
 * Labelled candidates for the Discover evaluation harness.
 *
 * `relevant` is a manual judgement: the video's speech is natural spoken Japanese a learner could
 * shadow. Videos about other languages, synthetic voices, music, sign language, silent videos and
 * clips too short to practise are not relevant, even when their metadata is in Japanese.
 *
 * - `baseline`: the 50 videos in the production catalogue on 10 October 2026, all returned by the
 *   single query 日本語 ゆっくり 会話 (public metadata; IDs replaced with fictional ones).
 * - `matrix`: hand-written, realistic examples of what the level-targeted searches return,
 *   including the traps those searches are expected to meet.
 */
export type Candidate = QualityInput & {
  id: string;
  channelId: string;
  set: 'baseline' | 'matrix';
  relevant: boolean;
  prepared?: boolean;
  levelTarget?: LevelTarget;
  topic?: Topic;
  note?: string;
  /** Simulated validated transcript analysis (only for prepared videos in real data). */
  band?: Band;
};

export const baselineCandidates: Candidate[] = baseline.map((b) => ({
  ...b,
  set: 'baseline' as const,
  topic: 'conversations' as const,
}));

let next = 0;
const m = (
  relevant: boolean,
  levelTarget: LevelTarget,
  topic: Topic,
  title: string,
  channelTitle: string,
  description: string,
  durationSeconds: number,
  extra: Partial<Candidate> = {},
): Candidate => ({
  id: `matrix${String(next++).padStart(5, '0')}`,
  channelId: `channel-${channelTitle}`,
  set: 'matrix',
  relevant,
  levelTarget,
  topic,
  title,
  channelTitle,
  description,
  durationSeconds,
  captionFlag: false,
  ...extra,
});

export const matrixCandidates: Candidate[] = [
  // Beginner, relevant.
  m(
    true,
    'beginner',
    'conversations',
    'Easy Japanese Podcast #12 ｜ 私の好きな食べ物 (N5-N4)',
    'Nihongo with Mika',
    'やさしい日本語で話します。Japanese listening practice for beginners. 字幕あり',
    900,
    { captionFlag: true, defaultAudioLanguage: 'ja' },
  ),
  m(
    true,
    'beginner',
    'everyday',
    'Japanese Comprehensible Input | Beginner | 公園を散歩します',
    'Slow Japanese Daily',
    'Comprehensible input for beginners. ゆっくり話します。',
    720,
  ),
  m(
    true,
    'beginner',
    'education',
    '【絵本 読み聞かせ】はらぺこのくま｜子ども向け',
    'おはなしの森',
    '絵本の読み聞かせです。ゆっくり読みます。',
    420,
    { defaultAudioLanguage: 'ja' },
  ),
  m(
    true,
    'beginner',
    'education',
    'Learn Japanese with stories: 桃太郎 (Japanese listening N5)',
    'Story Nihongo',
    '日本の昔話をやさしい日本語で。English subtitles available.',
    600,
    { captionFlag: true },
  ),
  m(
    true,
    'beginner',
    'everyday',
    '初級日本語 会話練習｜レストランで注文する',
    'にほんご教室あおば',
    '日本語学習者向けの会話練習です。',
    480,
  ),
  m(
    true,
    'beginner',
    'everyday',
    'Slow Japanese: My morning routine (with Japanese & English subtitles)',
    'Japanese with Ken',
    '朝のルーティンを話します。',
    540,
    { defaultAudioLanguage: 'ja' },
  ),
  // Intermediate, relevant.
  m(
    true,
    'intermediate',
    'conversations',
    '【雑談ラジオ】最近ハマっていること｜二人でゆるトーク',
    'ゆるっとラジオ',
    '毎週金曜日に配信している雑談ラジオです。',
    1500,
    { defaultAudioLanguage: 'ja' },
  ),
  m(
    true,
    'intermediate',
    'vlogs',
    '【夫婦vlog】休日のカフェ巡りと会話',
    'ふたりぐらし',
    '夫婦の日常を撮っています。',
    840,
  ),
  m(
    true,
    'intermediate',
    'food',
    '料理しながら喋る｜簡単な肉じゃがの作り方',
    '台所トーク',
    '今日は肉じゃがを作りながら最近の話をします。',
    960,
    { captionFlag: true },
  ),
  m(
    true,
    'intermediate',
    'conversations',
    '【街頭インタビュー】休みの日に何してる？',
    'まちの声チャンネル',
    '渋谷で街頭インタビューしました。',
    610,
  ),
  m(
    true,
    'intermediate',
    'conversations',
    'Japanese Podcast for Intermediate Learners #45 仕事について',
    'Nihongo Talk Lab',
    '中級学習者向けの日本語ポッドキャストです。Transcript available.',
    1680,
    { defaultAudioLanguage: 'ja' },
  ),
  m(
    true,
    'intermediate',
    'gaming',
    '【ゲーム実況】初見でホラーゲームやってみた【生声】',
    'たけしのゲーム部屋',
    '生声で実況しています！',
    1320,
    { categoryId: '20' },
  ),
  m(
    true,
    'intermediate',
    'travel',
    '京都一人旅vlog｜喋りながら歩く秋の嵐山',
    '旅するミホ',
    '京都を歩きながら話しました。',
    1100,
    { categoryId: '19' },
  ),
  m(
    true,
    'intermediate',
    'entertainment',
    '芸人二人の本気トーク｜売れない時代の話',
    'お笑いトーク部',
    '',
    1450,
    { categoryId: '24' },
  ),
  m(true, 'intermediate', 'vlogs', '今日あったこと話す', 'なおの日記', '', 600),
  // Advanced, relevant.
  m(
    true,
    'advanced',
    'news',
    '【解説】円安はいつまで続く？経済学者が解説',
    'マネー解説ch',
    '経済の専門家が最新のニュースを解説します。',
    1260,
    { defaultAudioLanguage: 'ja', categoryId: '25' },
  ),
  m(
    true,
    'advanced',
    'news',
    '【討論】少子化対策は効果があるのか｜専門家3人が議論',
    'ニュース討論室',
    '専門家が議論します。',
    2700,
  ),
  m(
    true,
    'advanced',
    'education',
    '【ドキュメンタリー】町工場の職人に密着',
    'ものづくり密着',
    '東京の町工場で働く職人に密着しました。',
    1500,
    { captionFlag: true },
  ),
  m(
    true,
    'advanced',
    'conversations',
    '経営者インタビュー｜失敗から学んだこと',
    'トップの対談',
    '経営者との対談です。',
    2200,
  ),
  m(
    true,
    'advanced',
    'education',
    '【講義】江戸時代の経済を解説｜歴史学者',
    'れきし講義室',
    '大学の講義をもとに解説します。',
    3000,
  ),
  m(
    true,
    'advanced',
    'education',
    'Japanese listening practice: advanced native speed discussion',
    'Native Japanese Lab',
    '上級者向け。ネイティブスピードの日本語で議論します。',
    1500,
  ),
  // Traps the matrix searches are expected to meet.
  m(
    false,
    'beginner',
    'everyday',
    '【英会話】カフェで使える英語フレーズ50｜聞き流し',
    'えいご道場',
    'ネイティブ音声で英語フレーズを聞き流し',
    1800,
    { note: 'English drill' },
  ),
  m(
    false,
    'beginner',
    'education',
    '韓国語会話 初級｜ハングルの読み方',
    '韓国語チャンネル',
    '韓国語を学びましょう',
    900,
    { note: 'Korean lesson' },
  ),
  m(
    false,
    'beginner',
    'everyday',
    '中文学习 日常会话 100句',
    '学中文',
    '学习中文的日常会话',
    1200,
    { note: 'Chinese lesson' },
  ),
  m(
    false,
    'intermediate',
    'entertainment',
    '【日本語字幕】アイドル 爆笑シーンまとめ',
    'kpop字幕部',
    '韓国語の動画に日本語字幕をつけました',
    900,
    { defaultAudioLanguage: 'ko', note: 'Japanese subtitles, Korean audio' },
  ),
  m(
    false,
    'intermediate',
    'vlogs',
    '【無言vlog】一人暮らしOLの休日｜料理と掃除',
    'しずかな暮らし',
    'BGMのみです。',
    720,
    { note: 'silent vlog' },
  ),
  m(
    false,
    'intermediate',
    'everyday',
    '【作業用BGM】カフェで流れる ジャズ 3時間',
    'Cafe Music',
    '',
    10800,
    { categoryId: '10', note: 'music' },
  ),
  m(
    false,
    'advanced',
    'education',
    '【ゆっくり解説】戦国時代の謎',
    'ゆっくり歴史',
    'ゆっくり解説です',
    900,
    { note: 'synthetic voice' },
  ),
  m(
    false,
    'advanced',
    'education',
    'ずんだもんが解説する宇宙の話',
    'ずんだ科学',
    'VOICEVOX:ずんだもん',
    700,
    { note: 'synthetic voice' },
  ),
  m(
    false,
    'intermediate',
    'travel',
    'Japanese street food tour 🇯🇵 Osaka',
    'Travel With Tom',
    'Trying street food in Osaka! Watch until the end.',
    900,
    { defaultAudioLanguage: 'en', note: 'English-language vlog about Japan' },
  ),
  m(false, 'intermediate', 'everyday', '日本の朝 #shorts', 'Daily clips', '#shorts', 45, {
    note: 'short',
  }),
  m(false, 'beginner', 'education', '【手話】自己紹介の仕方', '手話ひろば', '手話で自己紹介', 300, {
    note: 'sign language',
  }),
  m(
    false,
    'beginner',
    'education',
    'Learn Japanese in 3 hours - All the basics you need',
    'JapaneseCourse101',
    'Learn Japanese grammar explained in English.',
    11000,
    { defaultAudioLanguage: 'en', note: 'English-language explanation' },
  ),
  m(
    false,
    'intermediate',
    'education',
    'English conversation practice for Japanese speakers ｜英語リスニング',
    'Speak Up English',
    '英語のリスニング練習',
    1500,
    { note: 'English lesson' },
  ),
  m(
    false,
    'intermediate',
    'conversations',
    '【ASMR】囁き雑談しながら寝かしつけ',
    'ねむねむASMR',
    '囁き声で雑談します',
    2400,
    { note: 'whispered ASMR' },
  ),
  m(
    false,
    'beginner',
    'education',
    'Learn Japanese | 50 phrases for beginners (English explanation)',
    'Japanese Made Simple',
    'I explain each phrase in English.',
    960,
    { defaultAudioLanguage: 'en', note: 'English-language explanation' },
  ),
  m(false, 'intermediate', 'travel', '東京の路地裏を歩く', 'Walk Japan', '', 1800, {
    note: 'ambient walk without speech: indistinguishable from metadata',
  }),
];

// Some relevant matrix videos have been prepared and analysed, as after a few weeks of use.
// Each band is held by one or two videos; the rest of the catalogue stays unverified.
const verified: [number, Band][] = [
  [0, 'n5_n4'],
  [2, 'n5_plus'],
  [4, 'n5_n4'],
  [6, 'n4_n3'],
  [7, 'n3_n2'],
  [10, 'n3_n2'],
  [12, 'n4_n3'],
  [15, 'n2_n1'],
  [16, 'n1_plus'],
  [18, 'n2_n1'],
];
for (const [index, band] of verified)
  Object.assign(matrixCandidates[index], { band, prepared: true, captionFlag: true });

export const allCandidates = [...baselineCandidates, ...matrixCandidates];
