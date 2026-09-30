CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  request_id TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('bug', 'idea', 'other')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  reply_email TEXT,
  desktop_version TEXT NOT NULL,
  platform TEXT NOT NULL,
  created_at TEXT NOT NULL,
  notified_at TEXT
);
CREATE INDEX IF NOT EXISTS feedback_pending ON feedback (notified_at, created_at);
