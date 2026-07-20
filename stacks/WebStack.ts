import { StackContext, StaticSite, use } from "sst/constructs";
import { ApiStack } from "./ApiStack";
import { AuthStack } from "./AuthStack";

/**
 * T-14 — React SPA on SST `StaticSite` (R-60..R-64). Vite build env carries the
 * API URL + Cognito pool/client so the SPA's native login and Bearer calls
 * target the deployed resources.
 */
export function WebStack({ stack }: StackContext) {
  const { api } = use(ApiStack);
  const { auth } = use(AuthStack);

  const site = new StaticSite(stack, "Web", {
    path: "packages/web",
    buildCommand: "npm run build",
    buildOutput: "dist",
    environment: {
      VITE_API_URL: api.url,
      VITE_AWS_REGION: stack.region,
      VITE_USER_POOL_ID: auth.userPoolId,
      VITE_USER_POOL_CLIENT_ID: auth.userPoolClientId,
    },
  });

  stack.addOutputs({ SiteUrl: site.url ?? "localhost" });

  return { site };
}
