PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
INSERT OR REPLACE INTO schema_meta(key, value) VALUES ('schema_version', '1');
INSERT OR REPLACE INTO schema_meta(key, value) VALUES ('content_model_version', '1');

CREATE TABLE IF NOT EXISTS collections (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    sort_order INTEGER
);

CREATE TABLE IF NOT EXISTS sets (
    id TEXT PRIMARY KEY,
    collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    sort_order INTEGER
);
CREATE INDEX IF NOT EXISTS idx_sets_collection ON sets(collection_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sets_collection_name ON sets(collection_id, lower(trim(name)));

CREATE TABLE IF NOT EXISTS topics (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    sort_order INTEGER
);

CREATE TABLE IF NOT EXISTS subtopics (
    id TEXT PRIMARY KEY,
    topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    sort_order INTEGER
);
CREATE INDEX IF NOT EXISTS idx_subtopics_topic ON subtopics(topic_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_subtopics_topic_name ON subtopics(topic_id, lower(trim(name)));
CREATE UNIQUE INDEX IF NOT EXISTS uq_topics_name ON topics(lower(trim(name)));
CREATE UNIQUE INDEX IF NOT EXISTS uq_collections_name ON collections(lower(trim(name)));

CREATE TABLE IF NOT EXISTS groups (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL DEFAULT 'GROUP' CHECK(type = 'GROUP'),
    content_json TEXT NOT NULL,
    marks REAL,
    figures_json TEXT NOT NULL DEFAULT '[]',
    grade TEXT,
    tags_json TEXT NOT NULL DEFAULT '[]',
    source_json TEXT NOT NULL DEFAULT '{}',
    review_status TEXT NOT NULL DEFAULT 'NEEDS_REVIEW',
    publication_status TEXT NOT NULL DEFAULT 'DRAFT',
    created_at TEXT,
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS questions (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK(type IN ('MCQ','SUBJECTIVE')),
    content_json TEXT NOT NULL,
    options_json TEXT,
    answer_json TEXT,
    solution_json TEXT,
    figures_json TEXT,
    group_id TEXT REFERENCES groups(id) ON DELETE SET NULL,
    question_number INTEGER,
    grade TEXT,
    marks REAL,
    difficulty TEXT,
    tags_json TEXT NOT NULL DEFAULT '[]',
    source_json TEXT NOT NULL DEFAULT '{}',
    review_status TEXT NOT NULL DEFAULT 'NEEDS_REVIEW',
    publication_status TEXT NOT NULL DEFAULT 'DRAFT',
    created_at TEXT,
    updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_questions_number ON questions(question_number, id);
CREATE INDEX IF NOT EXISTS idx_questions_group ON questions(group_id);
CREATE INDEX IF NOT EXISTS idx_questions_grade ON questions(grade);
CREATE INDEX IF NOT EXISTS idx_questions_type ON questions(type);
CREATE INDEX IF NOT EXISTS idx_questions_review ON questions(review_status);
CREATE INDEX IF NOT EXISTS idx_questions_publication ON questions(publication_status);

CREATE TABLE IF NOT EXISTS group_children (
    group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    sort_order INTEGER NOT NULL,
    PRIMARY KEY(group_id, question_id)
);
CREATE INDEX IF NOT EXISTS idx_group_children_question ON group_children(question_id);

CREATE TABLE IF NOT EXISTS question_topics (
    question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
    subtopic_id TEXT NOT NULL REFERENCES subtopics(id) ON DELETE CASCADE,
    PRIMARY KEY(question_id, topic_id, subtopic_id)
);
CREATE INDEX IF NOT EXISTS idx_qtopics_topic ON question_topics(topic_id, subtopic_id, question_id);
CREATE INDEX IF NOT EXISTS idx_qtopics_subtopic ON question_topics(subtopic_id, question_id);

CREATE TABLE IF NOT EXISTS question_collections (
    question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    set_id TEXT NOT NULL REFERENCES sets(id) ON DELETE CASCADE,
    PRIMARY KEY(question_id, collection_id, set_id)
);
CREATE INDEX IF NOT EXISTS idx_qcollections_collection ON question_collections(collection_id, question_id);
CREATE INDEX IF NOT EXISTS idx_qcollections_set ON question_collections(set_id, question_id);

CREATE TABLE IF NOT EXISTS question_tags (
    question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    tag TEXT NOT NULL,
    PRIMARY KEY(question_id, tag)
);
CREATE INDEX IF NOT EXISTS idx_qtags_tag ON question_tags(tag, question_id);

CREATE VIRTUAL TABLE IF NOT EXISTS question_fts USING fts5(
    question_id UNINDEXED,
    search_text,
    tokenize = 'unicode61'
);
