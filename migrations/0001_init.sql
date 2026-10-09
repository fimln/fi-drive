-- fi-drive schema (replaces Cosmos containers users, files, publicLinks).
CREATE TABLE users (
  email       TEXT PRIMARY KEY,
  used_bytes  INTEGER NOT NULL DEFAULT 0 CHECK (used_bytes >= 0),
  created_at  TEXT NOT NULL
);

CREATE TABLE files (
  id            TEXT PRIMARY KEY,
  owner_email   TEXT NOT NULL,
  name          TEXT NOT NULL,
  size          INTEGER NOT NULL,
  content_type  TEXT NOT NULL,
  blob_name     TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  public_token  TEXT UNIQUE
);
-- list-files: WHERE owner_email = ?; point reads use (id, owner_email).
CREATE INDEX idx_files_owner_created ON files(owner_email, created_at);

CREATE TABLE public_links (
  token                TEXT PRIMARY KEY,
  file_id              TEXT NOT NULL,
  owner_email          TEXT NOT NULL,
  remaining_downloads  INTEGER NOT NULL,
  max_downloads        INTEGER NOT NULL DEFAULT 50
);
CREATE INDEX idx_public_links_file ON public_links(file_id);
