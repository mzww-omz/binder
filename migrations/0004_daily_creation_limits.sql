-- Separate from binders: deleting a Binder must not refund its creation quota.
CREATE TABLE binder_creation_limits (
  ip_day_hash TEXT PRIMARY KEY NOT NULL CHECK(length(ip_day_hash) = 64),
  reset_at INTEGER NOT NULL,
  created_count INTEGER NOT NULL CONSTRAINT ip_daily_limit CHECK(created_count BETWEEN 1 AND 50)
);
CREATE INDEX binder_creation_limits_reset ON binder_creation_limits(reset_at);
