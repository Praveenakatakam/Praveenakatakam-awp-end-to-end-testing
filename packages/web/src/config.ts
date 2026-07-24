/**
 * Runtime config injected by the SST `StaticSite` build (WebStack, T-14) from
 * `import.meta.env.VITE_*`. Falls back to placeholders so the SPA can build and
 * its jsdom tests can run without a deploy.
 */
export const config = {
  apiUrl: import.meta.env.VITE_API_URL ?? 'http://localhost:4000',
  region: import.meta.env.VITE_AWS_REGION ?? 'us-east-1',
  userPoolId: import.meta.env.VITE_USER_POOL_ID ?? 'us-east-1_placeholder',
  userPoolClientId: import.meta.env.VITE_USER_POOL_CLIENT_ID ?? 'placeholderClientId',
};
