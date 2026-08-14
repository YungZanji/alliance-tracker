-- Guest accounts authenticate with a non-numeric synthetic UID, so they can
-- never use the normal Last Z UID login form. The shared read-auth layers,
-- however, require players.login_enabled=1 for authenticated API reads.
-- Promote existing guest shadow identities so their valid temporary sessions
-- can read the portal without being treated as expired.
UPDATE players
SET login_enabled = 1
WHERE uid LIKE 'guest:%'
  AND EXISTS (
    SELECT 1 FROM guest_accounts g WHERE g.guest_uid = players.uid
  );
