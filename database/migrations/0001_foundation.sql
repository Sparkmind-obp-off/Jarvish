CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  content TEXT NOT NULL,
  importance INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS executions (
  id TEXT PRIMARY KEY,
  tool TEXT NOT NULL,
  permission INTEGER NOT NULL,
  input_json TEXT NOT NULL,
  output_json TEXT,
  verified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS execution_evidence (
  id TEXT PRIMARY KEY,
  execution_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);