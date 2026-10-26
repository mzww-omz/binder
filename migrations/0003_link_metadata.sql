ALTER TABLE binders ADD COLUMN metadata_requests INTEGER NOT NULL DEFAULT 0 CHECK(metadata_requests BETWEEN 0 AND 400);
ALTER TABLE nodes ADD COLUMN title_is_manual INTEGER NOT NULL DEFAULT 1 CHECK(title_is_manual IN (0, 1));
ALTER TABLE nodes ADD COLUMN metadata_status TEXT NOT NULL DEFAULT 'none' CHECK(metadata_status IN ('none', 'pending', 'ready', 'failed'));
ALTER TABLE nodes ADD COLUMN metadata_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE nodes ADD COLUMN favicon BLOB CHECK(favicon IS NULL OR length(favicon) <= 32768);
ALTER TABLE nodes ADD COLUMN favicon_type TEXT CHECK(favicon_type IS NULL OR favicon_type IN ('image/png', 'image/x-icon', 'image/svg+xml'));
