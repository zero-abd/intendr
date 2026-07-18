// Runs before any test module is imported. Provides the environment that the
// config singleton (src/config/env.ts) validates at load time, so unit tests
// never need a real Lithic key (the SDK itself is mocked per test).
//
// Force DEMO_MODE off so a local .env with DEMO_MODE=true does not divert the
// Lithic-mocked unit tests onto the hardcoded-card path. Demo-mode coverage
// lives in tests/demoCard.service.test.ts (mutates appConfig.demoMode).
process.env.DEMO_MODE = "false";
process.env.LITHIC_API_KEY ??= "test-lithic-key";
process.env.LITHIC_ENVIRONMENT ??= "sandbox";
process.env.MAX_VIRTUAL_CARD_AMOUNT_CENTS ??= "100000";
process.env.INTERNAL_SERVICE_TOKEN ??= "test-internal-service-token";
process.env.CREDENTIAL_TTL_SECONDS ??= "900";
process.env.LOG_LEVEL ??= "silent";
