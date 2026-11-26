-- 0005_mcp_rate_limit.sql — per-IP fixed-window counters for the public MCP server (/mcp).
-- Stores only salted SHA-256 IP hashes (IP_HASH_SALT), never raw IP addresses.
CREATE TABLE mcp_rate_limits (
  ip_hash TEXT NOT NULL,
  bucket INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (ip_hash, bucket)
);
CREATE INDEX idx_mcp_rate_limits_bucket ON mcp_rate_limits (bucket);
