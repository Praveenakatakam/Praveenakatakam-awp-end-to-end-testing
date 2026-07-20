import type { SSTConfig } from "sst";
import { StorageStack } from "./stacks/StorageStack";
import { AuthStack } from "./stacks/AuthStack";
import { ApiStack } from "./stacks/ApiStack";
import { WebStack } from "./stacks/WebStack";

/**
 * ODCS Contract Registry — SST v2 app entry (design §1).
 *
 * Stacks are added to the chain below as each infra task lands, in an order
 * that guarantees `use()` cross-stack references resolve:
 *   Storage (DynamoDB Registry + S3 ContractsBucket)
 *   → Auth   (Cognito native pool + reader/writer groups + secrets/seed)
 *   → Api    (HTTP API + Lambda authorizer + crawl/read handlers)
 *   → Web    (React SPA StaticSite)
 */
export default {
  config(_input) {
    return {
      name: "awp-end-to-end-testing",
      region: "us-east-1",
    };
  },
  stacks(app) {
    app.setDefaultFunctionProps({
      runtime: "nodejs20.x",
      architecture: "arm_64",
    });
    app.stack(StorageStack).stack(AuthStack).stack(ApiStack).stack(WebStack);
  },
} satisfies SSTConfig;
