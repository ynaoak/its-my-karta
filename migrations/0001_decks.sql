CREATE TABLE IF NOT EXISTS decks (
 id TEXT PRIMARY KEY,
 owner_user_id TEXT NOT NULL,
 title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 80),
 cards_json TEXT NOT NULL CHECK(json_valid(cards_json)),
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS decks_owner_updated ON decks(owner_user_id, updated_at DESC, id DESC);
