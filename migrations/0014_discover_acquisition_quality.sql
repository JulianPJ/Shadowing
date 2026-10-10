-- Acquisition intent (level target, orientation) is search metadata, never a verified difficulty.
ALTER TABLE discovery_seed_queries ADD COLUMN level_target TEXT CHECK(level_target IN ('beginner','intermediate','advanced'));
ALTER TABLE discovery_seed_queries ADD COLUMN orientation TEXT CHECK(orientation IN ('learner','native'));
ALTER TABLE discovery_seed_queries ADD COLUMN runs INTEGER NOT NULL DEFAULT 0;
ALTER TABLE discovery_seed_queries ADD COLUMN returned INTEGER NOT NULL DEFAULT 0;
ALTER TABLE discovery_seed_queries ADD COLUMN accepted INTEGER NOT NULL DEFAULT 0;
-- Explainable, versioned quality assessment of public provider metadata.
ALTER TABLE discovery_videos ADD COLUMN quality_score INTEGER;
ALTER TABLE discovery_videos ADD COLUMN quality_version INTEGER;
ALTER TABLE discovery_videos ADD COLUMN quality_reasons_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE discovery_videos ADD COLUMN language_evidence TEXT;
ALTER TABLE discovery_videos ADD COLUMN default_audio_language TEXT;
ALTER TABLE discovery_videos ADD COLUMN default_language TEXT;
ALTER TABLE discovery_videos ADD COLUMN category_id TEXT;
ALTER TABLE discovery_videos ADD COLUMN level_targets_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE discovery_videos ADD COLUMN orientation_hint TEXT CHECK(orientation_hint IN ('learner','native'));
ALTER TABLE discovery_videos ADD COLUMN orientation_evidence TEXT;
-- Rejected provider IDs are not catalogue content: no titles or descriptions are retained.
CREATE TABLE discovery_rejections (
 video_id TEXT PRIMARY KEY CHECK(length(video_id)=11), channel_id TEXT, reason TEXT NOT NULL,
 seed_id TEXT, rejected_at TEXT NOT NULL
);
CREATE INDEX discovery_rejections_channel ON discovery_rejections(channel_id,rejected_at);
CREATE INDEX discovery_rejections_time ON discovery_rejections(rejected_at);
CREATE TABLE discovery_seed_runs (
 id INTEGER PRIMARY KEY AUTOINCREMENT, seed_id TEXT NOT NULL, run_at TEXT NOT NULL, search_order TEXT NOT NULL,
 returned INTEGER NOT NULL, accepted INTEGER NOT NULL, rejected INTEGER NOT NULL, reasons_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX discovery_seed_runs_time ON discovery_seed_runs(run_at,seed_id);
-- The original nine broad queries mostly returned other-language lessons and synthetic-voice videos.
UPDATE discovery_seed_queries SET enabled=0;
INSERT INTO discovery_seed_queries(id,topic,query,level_target,orientation) VALUES
 ('b_comprehensible','education','Japanese comprehensible input beginner','beginner','learner'),
 ('b_easy_listening','everyday','やさしい日本語 リスニング 初級 -英会話 -英語','beginner','learner'),
 ('b_jlpt_story','education','JLPT N5 N4 Japanese listening story','beginner','learner'),
 ('b_slow_daily','everyday','slow Japanese daily conversation for beginners','beginner','learner'),
 ('b_podcast','conversations','日本語 ポッドキャスト 初級 学習者','beginner','learner'),
 ('b_food','food','easy Japanese listening food cooking','beginner','learner'),
 ('b_travel','travel','easy Japanese travel vlog Japanese subtitles','beginner','learner'),
 ('b_picture_book','education','絵本 読み聞かせ 日本語','beginner','native'),
 ('i_comprehensible','education','comprehensible Japanese intermediate','intermediate','learner'),
 ('i_listening','education','日本語 聞き取り 練習 中級 N3 -英会話 -英語','intermediate','learner'),
 ('i_podcast','conversations','Japanese podcast intermediate 日本語','intermediate','learner'),
 ('i_talk_vlog','vlogs','トーク vlog 日常 雑談','intermediate','native'),
 ('i_couple_vlog','vlogs','夫婦 vlog 会話 日常','intermediate','native'),
 ('i_cooking','food','料理 しゃべりながら 作る','intermediate','native'),
 ('i_travel','travel','旅行 vlog トーク 日本','intermediate','native'),
 ('i_radio','conversations','雑談 ラジオ 二人 トーク','intermediate','native'),
 ('i_street','conversations','街頭インタビュー 日本人','intermediate','native'),
 ('i_gaming','gaming','ゲーム実況 生声 雑談 -ゆっくり','intermediate','native'),
 ('i_entertainment','entertainment','芸人 トーク 企画','intermediate','native'),
 ('a_news','news','ニュース 解説 経済 -ゆっくり','advanced','native'),
 ('a_debate','news','報道 討論 専門家','advanced','native'),
 ('a_documentary','education','ドキュメンタリー 密着 日本','advanced','native'),
 ('a_interview','conversations','インタビュー 対談 経営者','advanced','native'),
 ('a_podcast','conversations','ポッドキャスト 対談 社会','advanced','native'),
 ('a_lecture','education','講義 解説 歴史 -ゆっくり','advanced','native'),
 ('a_science','education','科学 解説 研究者 -ゆっくり','advanced','native'),
 ('a_culture','travel','日本文化 解説 伝統','advanced','native'),
 ('a_native_speed','education','Japanese listening advanced native speed','advanced','learner')
