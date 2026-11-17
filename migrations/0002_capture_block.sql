-- 0002_capture_block.sql — never capture a store again once its owner asked us not to.
--
-- An approved removal request of scope 'store' or 'screenshots' adds a row here (in the same
-- batch as the approval, see approveRemoval in src/server/admin/actions.ts). The capture pipeline
-- must skip every domain listed here and every tombstoned domain: it asks
-- listCaptureTargets() / isCaptureBlocked() in src/server/repo/capture.ts (or the admin API,
-- GET /api/v1/admin/capture-targets and /capture-status/{domain}). Contract: docs/ARCHITECTURE.md,
-- "Capture pipeline".
--
-- A block outlives its removal request: request records are purged after two years
-- (REMOVAL_RECORD_RETENTION_DAYS in src/server/repo/removal.ts), the block is kept for good. It
-- holds no personal data: the purge sets removal_request_id to NULL and keeps the public RR-
-- reference so the block can still be explained.
CREATE TABLE capture_blocks (
  domain TEXT PRIMARY KEY,               -- lowercase bare host without www. (like stores.domain)
  scope TEXT NOT NULL CHECK (scope IN ('store', 'screenshots')), -- 'store' wins over 'screenshots'
  reason TEXT NOT NULL,                  -- 'removal-request'
  removal_request_id INTEGER,            -- NULL once the request record is purged
  reference TEXT,                        -- the request's public 'RR-…' reference
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_capture_blocks_created ON capture_blocks (created_at);

-- Retention purge (purgeExpiredRemovalRecords) reads closed requests by decision date.
CREATE INDEX idx_removal_requests_handled ON removal_requests (status, handled_at);
