-- Count before cleanup
SELECT 'before_total' AS metric, COUNT(*)::int AS value FROM events
UNION ALL
SELECT 'before_dup_groups', COUNT(*)::int FROM (
  SELECT user_id, gcal_event_id FROM events
  WHERE gcal_event_id IS NOT NULL AND status != 'cancelled'
  GROUP BY user_id, gcal_event_id HAVING COUNT(*) > 1
) d;

-- Remove newer duplicate rows per Google event id (keep oldest created_at)
DELETE FROM events e
USING events e2
WHERE e.user_id = e2.user_id
  AND e.gcal_event_id IS NOT NULL
  AND e.gcal_event_id = e2.gcal_event_id
  AND e.created_at > e2.created_at;

-- Remove slot duplicates when no gcal id
DELETE FROM events e
USING events e2
WHERE e.user_id = e2.user_id
  AND e.gcal_event_id IS NULL
  AND e2.gcal_event_id IS NULL
  AND e.start_at = e2.start_at
  AND e.end_at = e2.end_at
  AND e.title = e2.title
  AND e.status != 'cancelled'
  AND e2.status != 'cancelled'
  AND e.created_at > e2.created_at;

-- Count after cleanup
SELECT 'after_total' AS metric, COUNT(*)::int AS value FROM events
UNION ALL
SELECT 'after_dup_groups', COUNT(*)::int FROM (
  SELECT user_id, gcal_event_id FROM events
  WHERE gcal_event_id IS NOT NULL AND status != 'cancelled'
  GROUP BY user_id, gcal_event_id HAVING COUNT(*) > 1
) d;
