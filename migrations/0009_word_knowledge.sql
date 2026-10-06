CREATE TABLE user_word_knowledge (
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  lemma TEXT NOT NULL,
  reading TEXT,
  state TEXT NOT NULL CHECK (state IN ('unknown','learning','known','ignored')),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, lemma)
);
