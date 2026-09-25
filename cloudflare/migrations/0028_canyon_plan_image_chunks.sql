CREATE TABLE IF NOT EXISTS canyon_plan_image_chunks (
  language_code TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  chunk_base64 TEXT NOT NULL,
  PRIMARY KEY(language_code, chunk_index),
  FOREIGN KEY(language_code) REFERENCES canyon_plan_images(language_code) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_canyon_plan_image_chunks_language
  ON canyon_plan_image_chunks(language_code, chunk_index);
