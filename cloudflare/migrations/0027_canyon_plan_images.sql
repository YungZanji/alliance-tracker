CREATE TABLE IF NOT EXISTS canyon_plan_images (
  language_code TEXT PRIMARY KEY,
  language_label TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  source_filename TEXT NOT NULL,
  image_base64 TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  uploaded_by_uid TEXT,
  uploaded_by_name TEXT NOT NULL DEFAULT '',
  uploaded_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(uploaded_by_uid) REFERENCES players(uid)
);

CREATE INDEX IF NOT EXISTS idx_canyon_plan_images_updated
  ON canyon_plan_images(updated_at DESC);
