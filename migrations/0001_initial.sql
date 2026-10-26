CREATE TABLE binders (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
  edit_token_hash TEXT NOT NULL CHECK(length(edit_token_hash) = 64),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK(expires_at = created_at + 604800000),
  updated_at INTEGER NOT NULL
);
CREATE INDEX binders_expiry ON binders(expires_at);
CREATE INDEX binders_created ON binders(created_at);

CREATE TABLE nodes (
  id TEXT PRIMARY KEY NOT NULL,
  binder_id TEXT NOT NULL REFERENCES binders(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES nodes(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN ('folder', 'link')),
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
  url TEXT,
  sort_order INTEGER NOT NULL CHECK(sort_order >= 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK((type = 'folder' AND url IS NULL) OR
    (type = 'link' AND length(url) BETWEEN 1 AND 2048 AND
      (url LIKE 'https://%' OR url LIKE 'http://%')))
);
CREATE INDEX nodes_children ON nodes(binder_id, parent_id, sort_order, id);
CREATE INDEX nodes_parent ON nodes(parent_id);

-- SQL guards serialize competing requests, not just sequential API validation.
CREATE TRIGGER binder_capacity BEFORE INSERT ON binders BEGIN
  SELECT CASE WHEN (SELECT count(*) FROM binders WHERE created_at > NEW.created_at - 3600000) >= 20
    OR (SELECT count(*) FROM binders) >= 2000 THEN RAISE(ABORT, 'binder_capacity') END;
END;
CREATE TRIGGER node_insert_guard BEFORE INSERT ON nodes BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM binders WHERE id = NEW.binder_id
    AND expires_at > unixepoch('subsec') * 1000) THEN RAISE(ABORT, 'binder_expired') END;
  SELECT CASE WHEN (SELECT count(*) FROM nodes WHERE binder_id = NEW.binder_id) >= 200
    THEN RAISE(ABORT, 'node_capacity') END;
  SELECT CASE WHEN NEW.parent_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM nodes WHERE id = NEW.parent_id AND binder_id = NEW.binder_id AND type = 'folder'
  ) THEN RAISE(ABORT, 'invalid_parent') END;
END;
CREATE TRIGGER node_update_guard BEFORE UPDATE ON nodes BEGIN
  SELECT CASE WHEN NEW.id != OLD.id OR NEW.binder_id != OLD.binder_id OR NEW.type != OLD.type
    THEN RAISE(ABORT, 'immutable_node') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM binders WHERE id = NEW.binder_id
    AND expires_at > unixepoch('subsec') * 1000) THEN RAISE(ABORT, 'binder_expired') END;
  SELECT CASE WHEN NEW.parent_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM nodes WHERE id = NEW.parent_id AND binder_id = NEW.binder_id AND type = 'folder'
  ) THEN RAISE(ABORT, 'invalid_parent') END;
  SELECT CASE WHEN NEW.parent_id IN (
    WITH RECURSIVE descendants(id) AS (
      SELECT OLD.id UNION ALL SELECT n.id FROM nodes n JOIN descendants d ON n.parent_id = d.id
    ) SELECT id FROM descendants
  ) THEN RAISE(ABORT, 'folder_cycle') END;
END;
CREATE TRIGGER node_insert_touch AFTER INSERT ON nodes BEGIN
  UPDATE binders SET updated_at = NEW.updated_at WHERE id = NEW.binder_id;
END;
CREATE TRIGGER node_update_touch AFTER UPDATE ON nodes BEGIN
  UPDATE binders SET updated_at = NEW.updated_at WHERE id = NEW.binder_id;
END;
CREATE TRIGGER node_delete_touch AFTER DELETE ON nodes BEGIN
  UPDATE binders SET updated_at = CAST(unixepoch('subsec') * 1000 AS INTEGER) WHERE id = OLD.binder_id;
END;
