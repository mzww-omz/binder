-- SQLite CHECK accepts NULL, so require a URL explicitly without rebuilding existing tables.
CREATE TRIGGER node_url_insert BEFORE INSERT ON nodes
WHEN NEW.type = 'link' AND NEW.url IS NULL BEGIN
  SELECT RAISE(ABORT, 'invalid_node');
END;
CREATE TRIGGER node_url_update BEFORE UPDATE ON nodes
WHEN NEW.type = 'link' AND NEW.url IS NULL BEGIN
  SELECT RAISE(ABORT, 'invalid_node');
END;
