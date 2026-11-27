// Test-only compatibility for route tests that use Authorization: Bearer.
process.env.NODE_ENV = 'test';
process.env.ALLOW_BEARER_AUTH = 'true';

process.env.JWT_SECRET = 'tradepro-test-secret-not-for-production-2026';
