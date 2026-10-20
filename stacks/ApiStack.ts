import { StackContext, Api, Function, use } from 'sst/constructs';
import { PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';
import { AuthStack } from './AuthStack';
import { StorageStack } from './StorageStack';

/**
 * T-10 — HTTP API + Lambda REQUEST authorizer + crawl/read handlers (design §3).
 *
 *   R-16, R-56, R-71, D-21 — every route is gated by `RegistryAuthorizer`, which
 *     verifies the Cognito access token and enforces the per-route group rule.
 *     Missing header → 401 (gateway); rejected token/group → 403 (authorizer).
 *     Result caching is disabled so a read-authorised token can't be replayed
 *     against POST /refresh.
 *   R-10..R-15 — POST /refresh crawls (writer-only; also bound to GITHUB_TOKEN).
 *   R-50..R-55 — the read endpoints.
 */
export function ApiStack({ stack }: StackContext) {
  const { githubToken, userPoolIdParam, userPoolClientIdParam, sourceBranchParam, contractPathPrefixParam } = use(AuthStack);
  const { registry, contracts } = use(StorageStack);

  // The authorizer verifies Cognito access tokens itself (aws-jwt-verify); it
  // reads the pool id + client id through `sst/node/config` (Config.Parameters
  // bound here), not env vars.
  const authorizer = new Function(stack, 'Authorizer', {
    handler: 'packages/functions/src/authorizer.handler',
    bind: [userPoolIdParam, userPoolClientIdParam],
  });

  // The functional-generation worker (T-36 · §3.11, D-53). Not a route: the POST
  // handler async-invokes it (LLM synthesis exceeds the 29s gateway limit), so it
  // gets its own long timeout and the catalog/bucket bindings. Claude is reached
  // through Amazon Bedrock (§3.11, R-118, D-55): auth is this Lambda's execution
  // role via SigV4 — no API key / SST Secret — granted `bedrock:InvokeModel` on
  // Anthropic foundation models + inference profiles. BEDROCK_MODEL_ID overrides
  // the default profile per stage without a code change.
  const functionalWorker = new Function(stack, 'FunctionalWorker', {
    handler: 'packages/functions/src/functional-gen.worker',
    bind: [registry, contracts],
    timeout: '15 minutes',
    memorySize: '1024 MB',
    // Bedrock model id / inference-profile id (R-119 cache key). Requires the
    // account to have Bedrock model access for this model (Anthropic use-case
    // form + model-access grant); switch to any granted model without a code
    // change, e.g. `us.anthropic.claude-haiku-4-5-20251001-v1:0` (D-55).
    // The adversarial critic (§3.12, R-139, D-81) runs on a DIFFERENT model from
    // the synthesiser; the bedrock:InvokeModel grant below already covers it
    // (D-58). ADVERSARIAL_MUTATION_THRESHOLD is the §3.11 static-mutation score
    // below which a plan gets a Major finding (D-77).
    environment: {
      BEDROCK_MODEL_ID: 'us.anthropic.claude-sonnet-4-6',
      CRITIC_MODEL_ID: 'us.anthropic.claude-opus-4-8',
      ADVERSARIAL_MUTATION_THRESHOLD: '0.5',
    },
    permissions: [
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['bedrock:InvokeModel'],
        resources: ['arn:aws:bedrock:*::foundation-model/anthropic.*', 'arn:aws:bedrock:*:*:inference-profile/*'],
      }),
    ],
  });

  const api = new Api(stack, 'Api', {
    authorizers: {
      registryAuth: {
        type: 'lambda',
        function: authorizer,
        responseTypes: ['simple'],
        resultsCacheTtl: '0 seconds',
        identitySource: ['$request.header.Authorization'],
      },
    },
    defaults: {
      authorizer: 'registryAuth',
      function: {
        // Handlers read the table + bucket names via `sst/node/{table,bucket}`
        // from these bindings — no hand-threaded env vars.
        bind: [registry, contracts],
      },
    },
    routes: {
      // Writer-only; also bound to the GitHub PAT for the crawl.
      'POST /refresh': {
        function: {
          handler: 'packages/functions/src/refresh.handler',
          bind: [githubToken, sourceBranchParam, contractPathPrefixParam],
          timeout: '30 seconds',
        },
      },
      // Writer-only; reads the catalog + writes artifacts (bound via defaults). T-23 · R-80.
      'POST /generate-tests': {
        function: {
          handler: 'packages/functions/src/generate.handler',
          timeout: '30 seconds',
        },
      },
      // Writer-only; creates a job + async-invokes the worker, returns 202 (§3.11, R-115).
      'POST /generate-functional-tests': {
        function: {
          handler: 'packages/functions/src/functional-gen.handler',
          timeout: '30 seconds',
          environment: { FUNCTIONAL_WORKER_FUNCTION_NAME: functionalWorker.functionName },
          permissions: [functionalWorker], // grants lambda:InvokeFunction on the worker
        },
      },
      'GET /contracts': 'packages/functions/src/read.contracts',
      'GET /contracts/{source}/{id}': 'packages/functions/src/read.contract',
      'GET /contracts/{source}/{id}/raw': 'packages/functions/src/read.raw',
      'GET /entities/{entity}': 'packages/functions/src/read.entity',
      'GET /crawls': 'packages/functions/src/read.crawls',
      'GET /crawls/{runId}': 'packages/functions/src/read.crawl',
      // Test-generation artifact retrieval (reader). T-22 · R-90.
      'GET /test-artifacts': 'packages/functions/src/read.testArtifacts',
      'GET /test-artifacts/latest': 'packages/functions/src/read.testArtifactsLatest',
      'GET /test-artifacts/{runId}': 'packages/functions/src/read.testArtifact',
      // Functional-test-generation jobs (reader). T-37 · §3.11, R-125, R-126.
      'GET /functional-test-jobs': 'packages/functions/src/read.functionalJobs',
      'GET /functional-test-jobs/latest': 'packages/functions/src/read.functionalJobLatest',
      'GET /functional-test-jobs/{jobId}': 'packages/functions/src/read.functionalJob',
      // Requirements catalog (reader). T-30 · R-109…R-112.
      'GET /requirements': 'packages/functions/src/read.requirements',
      'GET /requirements/{source}': 'packages/functions/src/read.requirementsForSource',
      'GET /requirements/{source}/{id}': 'packages/functions/src/read.requirement',
    },
  });

  stack.addOutputs({ ApiUrl: api.url });

  return { api };
}
