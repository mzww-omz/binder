import { collectMetadata, type Metadata } from './metadata';

export async function enrichNode(db: D1Database, binderId: string, nodeId: string, url: string, version: number, origin: string) {
  try {
    const budget = await db.prepare(`UPDATE binders SET metadata_requests = metadata_requests + 1
      WHERE id = ? AND metadata_requests < 400 AND expires_at > ?
      AND EXISTS (SELECT 1 FROM nodes WHERE id = ? AND binder_id = ? AND metadata_version = ? AND metadata_status = 'pending')
      RETURNING id`).bind(binderId, Date.now(), nodeId, binderId, version).first();
    const result: Metadata = budget ? await collectMetadata(url, origin) : { title: null, icon: null };
    // Explicit manual-title state and a generation guard protect edits, even in the same millisecond.
    await db.prepare(`UPDATE nodes SET
      title = CASE WHEN title_is_manual = 0 AND ? IS NOT NULL THEN ? ELSE title END,
      favicon = ?, favicon_type = ?, metadata_status = ?, updated_at = ?
      WHERE id = ? AND binder_id = ? AND url = ? AND metadata_version = ? AND metadata_status = 'pending'
        AND EXISTS (SELECT 1 FROM binders WHERE id = ? AND expires_at > max(?, unixepoch('subsec') * 1000))`)
      .bind(result.title, result.title, result.icon?.bytes ?? null, result.icon?.type ?? null,
        result.title || result.icon ? 'ready' : 'failed', Date.now(), nodeId, binderId, url, version, binderId, Date.now()).run();
  } catch { /* Expiry, deletion and background failures must not turn a successful save into an error. */ }
}
