-- GitMind 数据表（共享 dev 库，前缀 gm_）
-- 账号、会话、导图三张表 + 索引

CREATE TABLE IF NOT EXISTS gm_users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT UNIQUE NOT NULL,
  pass_hash  TEXT NOT NULL,
  pass_salt  TEXT NOT NULL,
  nickname   TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS gm_sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL,
  exp        INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS gm_maps (
  id         TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL,
  title      TEXT NOT NULL DEFAULT '未命名导图',
  type       TEXT NOT NULL DEFAULT 'mindmap',
  data       TEXT NOT NULL DEFAULT '{}',
  is_public  INTEGER NOT NULL DEFAULT 0,
  storage    TEXT NOT NULL DEFAULT 'd1',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS gm_idx_sessions_user  ON gm_sessions(user_id);
CREATE INDEX IF NOT EXISTS gm_idx_maps_user      ON gm_maps(user_id);
CREATE INDEX IF NOT EXISTS gm_idx_maps_public    ON gm_maps(is_public);
