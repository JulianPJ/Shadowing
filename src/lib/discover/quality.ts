/**
 * Deterministic, explainable assessment of whether provider metadata describes spoken Japanese that
 * is useful for shadowing. It never derives a difficulty band: only a validated transcript analysis
 * can do that (see catalog.ts).
 *
 * What each YouTube field guarantees:
 * - snippet.defaultAudioLanguage: uploader-declared language of the default audio track. Optional and
 *   unverified, but a declared non-Japanese language is strong negative evidence.
 * - snippet.defaultLanguage: language of the title/description, not the audio.
 * - contentDetails.caption: some uploaded caption track exists, in any language.
 * - snippet.categoryId / topicDetails.topicCategories: coarse uploader/provider categories.
 * Only a trusted Japanese provider transcript prepared in Hibiki confirms usable Japanese captions.
 */
export const QUALITY_VERSION = 1;
export const QUALITY_THRESHOLD = 55;

export type LanguageEvidence =
  'japanese-transcript' | 'reported-japanese-audio' | 'japanese-metadata' | 'uncertain';
export type RejectionReason =
  | 'reported-other-audio'
  | 'foreign-language-audio'
  | 'sign-language'
  | 'no-speech'
  | 'music'
  | 'too-short'
  | 'too-long'
  | 'low-score';
export type QualityInput = {
  title: string;
  description: string;
  channelTitle: string;
  durationSeconds: number;
  captionFlag: boolean;
  defaultAudioLanguage?: string | null;
  defaultLanguage?: string | null;
  categoryId?: string | null;
  topicCategories?: string[];
};
export type QualityEvidence = {
  /** A trusted Japanese provider transcript exists in Hibiki. */
  prepared?: boolean;
  /** Recent acquisition history for the channel. */
  channel?: { accepted: number; rejected: number; prepared: number };
};
export type Quality = {
  score: number;
  accepted: boolean;
  rejection: RejectionReason | null;
  reasons: string[];
  languageEvidence: LanguageEvidence;
  /** Creator-declared learner orientation, or native evidence from declared Japanese audio. */
  orientation: 'learner' | 'native' | null;
  orientationEvidence: string | null;
};

const KANA = /[぀-ゟ゠-ヿ]/;
const CJK = /[一-鿿]/;
const HANGUL = /[가-힯ᄀ-ᇿ]/;
// Phrases that only describe subtitles do not change the spoken language.
const SUBTITLE_MENTION =
  /(英語|english|中国語|chinese|韓国語|korean|日本語|japanese)\s*(?:と|&|and|\/|・)?\s*(?:英語|english|日本語|japanese)?\s*(字幕|subtitles?|subs?\b|captions?)/gi;
const JAPANESE_LEARNER =
  /learn(?:ing)?\s+japanese|japanese\s+(?:listening|podcast|lessons?|for\s+beginners|immersion|stor(?:y|ies)|practice|conversation)|comprehensible\s+(?:input\s+)?japanese|japanese\s+comprehensible|(?:easy|slow|simple|natural)\s+japanese|日本語学習|日本語の勉強|日本語勉強|日本語学習者|学習者向け|日本語教師|日本語レッスン|やさしい日本語|ゆっくり日本語|初級日本語|中級日本語|上級日本語|日本語\s*(?:リスニング|ポッドキャスト|podcast|聴解)|jlpt|nihongo|\bn[1-5]\b/i;
const FOREIGN_LANGUAGE =
  /英会話|英語|英単語|english|中国語|韓国語|ハングル|スペイン語|フランス語|ドイツ語|イタリア語|ポルトガル語|ロシア語|ベトナム語|タイ語|インドネシア語|アラビア語/i;
const LEARNING_CONTEXT =
  /勉強|学習|フレーズ|リスニング|聞き流し|発音|単語|レッスン|講座|入門|練習|喉|話せる|聞こえる|上達|初心者|初級|中級|上級|文法|読み方|学び|lesson|learn|tips/i;
// Recorded target-language audio rather than a Japanese explanation.
const FOREIGN_DRILL = /聞き流し|フレーズ\s*\d|\d+\s*フレーズ|ナレーター|音声付|読み上げ|リピート/;
const SIGN_LANGUAGE = /手話/;
// Silent vlogs (無言vlog) are a large genre of BGM-only daily-life videos.
const NO_SPEECH = /無言|音声なし|喋らない|しゃべらない|no\s*talking|silent\s*vlog/i;
// "ゆっくり実況/解説" and named voicebanks are text-to-speech narration, not natural speech.
// "ゆっくり日本語" and "ゆっくり話す" are slow natural speech and are not matched.
const SYNTHETIC_VOICE =
  /ゆっくり\s*(?:実況|解説|茶番|劇場|ボイス|霊夢|魔理沙)|#ゆっくり|voiceroid|ボイスロイド|ずんだもん|琴葉|cevio|voicepeak|合成音声|ai音声|aiボイス|棒読み/i;
const MUSIC =
  /作業用\s*bgm|睡眠用|playlist|プレイリスト|lo-?fi|歌ってみた|music\s*video|\bmv\b|official\s+audio|カラオケ|歌詞付き|邦楽|メドレー/i;
const ASMR = /asmr|囁き|ささやき|whisper/i;
const SHORTS = /#shorts?\b/i;
const COMPILATION = /まとめ|総集編|切り抜き|compilation|作業用|聞き流し/i;
const SPEECH =
  /雑談|トーク|会話|インタビュー|対談|ラジオ|ポッドキャスト|podcast|話す|話して|喋|しゃべ|解説|朗読|読み聞かせ|ニュース|講義|討論|vlog|story|stories|conversation|interview/i;
const PROMOTION = /無料プレゼント|特典|公式line|lstep\.app|豪華.*プレゼント/i;

const japaneseAudio = (code?: string | null) => !!code && /^ja(?:-|$)/i.test(code);

export function assessQuality(input: QualityInput, evidence: QualityEvidence = {}): Quality {
  const reasons: string[] = [];
  let score = 50;
  let rejection: RejectionReason | null = null;
  const add = (points: number, reason: string) => {
    score += points;
    reasons.push(`${reason}:${points > 0 ? '+' : ''}${points}`);
  };
  const reject = (reason: RejectionReason) => {
    rejection ??= reason;
    reasons.push(`reject:${reason}`);
  };
  const title = input.title.normalize('NFKC');
  const description = input.description.normalize('NFKC').slice(0, 5000);
  const metadata = `${title}\n${input.channelTitle.normalize('NFKC')}\n${description}`;
  const languageText = metadata.replace(SUBTITLE_MENTION, ' ');
  const titleAndChannel = `${title} ${input.channelTitle.normalize('NFKC')}`.replace(
    SUBTITLE_MENTION,
    ' ',
  );
  const learner = JAPANESE_LEARNER.test(languageText);
  const audio = input.defaultAudioLanguage?.trim() || null;
  const reportedJapanese = japaneseAudio(audio);

  // Spoken-language evidence. Declared audio is the only provider field about speech.
  if (audio && !reportedJapanese && !/^(zxx|und|mul)$/i.test(audio)) reject('reported-other-audio');
  if (reportedJapanese) add(20, 'reported-japanese-audio');
  if (evidence.prepared) add(20, 'trusted-japanese-transcript');
  if (KANA.test(title)) add(10, 'kana-title');
  else if (CJK.test(title) && !KANA.test(description)) add(-25, 'no-kana'); // Usually Chinese-language metadata.
  if (KANA.test(description)) add(5, 'kana-description');
  if (!KANA.test(metadata) && !CJK.test(metadata) && !learner) add(-30, 'no-japanese-metadata');
  if (HANGUL.test(title)) add(-35, 'hangul-title');
  if (learner) add(15, 'japanese-learner-content');

  // Content type.
  if (SIGN_LANGUAGE.test(titleAndChannel)) reject('sign-language');
  if (NO_SPEECH.test(title)) reject('no-speech');
  if (input.categoryId === '10' || MUSIC.test(title)) reject('music');
  else if (input.topicCategories?.some((t) => /music$/i.test(t))) add(-15, 'music-topic');
  if (!learner && FOREIGN_LANGUAGE.test(titleAndChannel) && LEARNING_CONTEXT.test(languageText)) {
    if (FOREIGN_DRILL.test(metadata)) reject('foreign-language-audio');
    else add(-30, 'other-language-lesson');
  }
  if (SYNTHETIC_VOICE.test(metadata)) add(-50, 'synthetic-voice');
  if (ASMR.test(title)) add(-30, 'asmr');
  if (SHORTS.test(metadata)) add(-15, 'shorts');
  if (COMPILATION.test(title)) add(-10, 'compilation');
  if (SPEECH.test(languageText)) add(8, 'speech-content');
  if (PROMOTION.test(description)) add(-5, 'promotional');

  // Shadowing-friendly length.
  const seconds = input.durationSeconds;
  if (seconds < 60) reject('too-short');
  else if (seconds < 120) add(-15, 'very-short');
  else if (seconds < 180) add(-5, 'short');
  else if (seconds <= 1800) add(10, 'shadowing-length');
  else if (seconds <= 3600) add(3, 'long');
  else if (seconds <= 10800) add(-10, 'very-long');
  else reject('too-long');
  if (input.captionFlag) add(5, 'captions-reported');

  // Channel history: repeated rejections without any accepted or prepared video.
  const channel = evidence.channel;
  if (channel?.prepared) add(10, 'channel-prepared');
  else if (channel && channel.rejected >= 3 && channel.accepted === 0)
    add(-15, 'low-yield-channel');

  if (!rejection && score < QUALITY_THRESHOLD) reject('low-score');
  const languageEvidence: LanguageEvidence = evidence.prepared
    ? 'japanese-transcript'
    : reportedJapanese
      ? 'reported-japanese-audio'
      : KANA.test(metadata)
        ? 'japanese-metadata'
        : 'uncertain';
  const orientation = learner
    ? 'learner'
    : reportedJapanese && !FOREIGN_LANGUAGE.test(titleAndChannel)
      ? 'native'
      : null;
  return {
    score,
    accepted: !rejection,
    rejection,
    reasons,
    languageEvidence,
    orientation,
    orientationEvidence: learner
      ? 'creator-declared-learner-content'
      : orientation
        ? 'declared-japanese-audio-without-learner-markers'
        : null,
  };
}
