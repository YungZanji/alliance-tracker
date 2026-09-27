-- Replace only the known bootstrap PBKDF2 credential with a fast bootstrap digest.
-- The old 210k PBKDF2 verification can exceed the CPU budget on Workers Free.
-- After the first successful bootstrap login, the Worker upgrades the credential to
-- HMAC-SHA256 using the server-side Worker secret as a pepper.
UPDATE admin_credentials
SET password_hash='sha256:VOH/3hlSPwYmed/MB4wYMRvpdOAlL7pUo+Ap4PlIU5Y=',
    iterations=1,
    updated_at=datetime('now')
WHERE password_hash='e2CJsw/1zZir8fQvgZm9v3ztCFvxK9QIpTYSaicbBw0='
  AND iterations=210000;
