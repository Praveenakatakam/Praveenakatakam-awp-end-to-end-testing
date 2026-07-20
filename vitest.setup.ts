/**
 * Offline test setup — stub the SST resource bindings that `sst/node/*` reads.
 *
 * Handlers now read table/bucket names and Cognito coordinates through
 * `sst/node` (Table/Bucket/Config) instead of hand-threaded env vars. Those
 * getters resolve from `SST_{Construct}_{prop}_{id}` environment variables that
 * `sst bind` sets at runtime. Here we set them to inline local values so the
 * `test:offline` suite resolves the bindings WITHOUT any AWS/SSM call (a value
 * that isn't the `__FETCH_FROM_SSM__` placeholder is used verbatim).
 *
 * `??=` means a real `sst bind vitest run` (`npm test`) still wins — those runs
 * exercise the true bound values against the deployed stage. Must run before any
 * `sst/node/*` import, which is why it is a Vitest `setupFile`.
 */
process.env.SST_APP ??= "awp-end-to-end-testing";
process.env.SST_STAGE ??= "test";

// Storage resource bindings (sst/node/table, sst/node/bucket).
process.env.SST_Table_tableName_Registry ??= "Registry";
process.env.SST_Bucket_bucketName_Contracts ??= "Contracts";

// Config.Parameters (sst/node/config).
process.env.SST_Parameter_value_USER_POOL_ID ??= "us-east-1_test000";
process.env.SST_Parameter_value_USER_POOL_CLIENT_ID ??= "testclientid";

// Config.Secrets (sst/node/config) — inline value skips the SSM fetch.
process.env.SST_Secret_value_REGISTRY_DEMO_PASSWORD ??= "test-password";
process.env.SST_Secret_value_GITHUB_TOKEN ??= "test-github-token";
