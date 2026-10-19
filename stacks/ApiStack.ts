import { StackContext, Api, Function, Script, use } from 'sst/constructs';
import { PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';
import { Duration } from 'aws-cdk-lib';
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
    environment: { BEDROCK_MODEL_ID: 'us.anthropic.claude-sonnet-4-6' },
    permissions: [
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['bedrock:InvokeModel'],
        resources: ['arn:aws:bedrock:*::foundation-model/anthropic.*', 'arn:aws:bedrock:*:*:inference-profile/*'],
      }),
    ],
  });

  // The experiment worker (T-03 · §3.12, R-20, R-21). Mirrors the FunctionalWorker
  // pattern: async-invoked by the POST /experiments handler, long timeout, same
  // catalog + bucket bindings, same Bedrock grant. BEDROCK_MODEL_ID can be
  // overridden per stage without a code change (D-55).
  const experimentWorker = new Function(stack, 'ExperimentWorker', {
    handler: 'packages/functions/src/experiments.worker',
    bind: [registry, contracts],
    timeout: '15 minutes',
    memorySize: '1024 MB',
    environment: { BEDROCK_MODEL_ID: 'us.anthropic.claude-sonnet-4-6' },
    permissions: [
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['bedrock:InvokeModel'],
        resources: ['arn:aws:bedrock:*::foundation-model/anthropic.*', 'arn:aws:bedrock:*:*:inference-profile/*'],
      }),
    ],
  });

  // T-09 — Step worker Lambda for configurable LLM pipeline (D-10, R-17, R-35).
  // Single reusable function invoked async with { runId, stepIndex }; chains to
  // itself for each subsequent step. retryAttempts: 0 is CRITICAL — prevents AWS
  // from replaying a partially-written step record on unhandled failure (D-10).
  const stepWorkerFn = new Function(stack, 'StepWorkerFunction', {
    handler: 'packages/functions/src/pipeline.stepWorker',
    bind: [registry, contracts],
    timeout: '15 minutes',
    memorySize: '1024 MB',
    permissions: [
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['bedrock:InvokeModel'],
        resources: ['arn:aws:bedrock:*::foundation-model/anthropic.*', 'arn:aws:bedrock:*:*:inference-profile/*'],
      }),
    ],
  });
  // Self-reference: the step worker invokes itself for next-step dispatch.
  // Must be added post-construction — stepWorkerFn.functionArn is a CDK Token
  // (CloudFormation intrinsic) resolved at deploy time, not synth time.
  // Use account/region-scoped wildcard instead of stepWorkerFn.functionArn to
  // avoid a CDK Policy→Function→Policy cyclic dependency during synth.
  stepWorkerFn.attachPermissions([
    new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['lambda:InvokeFunction'],
      resources: [`arn:aws:lambda:${stack.region}:${stack.account}:function:*`],
    }),
  ]);
  stepWorkerFn.configureAsyncInvoke({
    retryAttempts: 0,
    maxEventAge: Duration.hours(2),
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
      // When pipelineId is present (T-08), the handler dispatches directly to stepWorkerFn
      // instead of the legacy FJOB worker (D-13). Both invocations are async (InvocationType: 'Event').
      'POST /generate-functional-tests': {
        function: {
          handler: 'packages/functions/src/functional-gen.handler',
          timeout: '30 seconds',
          environment: {
            FUNCTIONAL_WORKER_FUNCTION_NAME: functionalWorker.functionName,
            STEP_WORKER_FUNCTION_NAME: stepWorkerFn.functionName,
          },
          permissions: [functionalWorker, stepWorkerFn], // grants lambda:InvokeFunction on both workers
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
      // Prompt versions (writer: POST; reader: GET). T-03 · R-02, R-05, R-06.
      'POST /prompt-versions': {
        function: {
          handler: 'packages/functions/src/prompt-versions.handleCreatePromptVersion',
          timeout: '30 seconds',
        },
      },
      'GET /prompt-versions': 'packages/functions/src/read.promptVersions',
      'GET /prompt-versions/{promptVersion}': 'packages/functions/src/read.promptVersion',
      // Experiments (writer: POST; reader: GET). T-03 · R-20, R-21, R-22.
      // POST async-invokes ExperimentWorker (exceeds 29s gateway limit). The env
      // var + permission grant mirror the FunctionalGen handler pattern (D-53).
      'POST /experiments': {
        function: {
          handler: 'packages/functions/src/experiments.handler',
          timeout: '30 seconds',
          environment: { EXPERIMENT_WORKER_FUNCTION_NAME: experimentWorker.functionName },
          permissions: [experimentWorker],
        },
      },
      'GET /experiments': 'packages/functions/src/read.experiments',
      'GET /experiments/{experimentId}': 'packages/functions/src/read.experiment',
      'GET /experiments/{experimentId}/artifact': 'packages/functions/src/read.experimentArtifact',
      // Pipeline CRUD (configurable-llm-pipeline · T-09, R-35).
      // GET handlers live in read.ts (T-05); mutation handlers in pipeline.ts (T-03, T-04).
      'GET /pipelines': 'packages/functions/src/read.getPipelinesHandler',
      'GET /pipelines/{id}': 'packages/functions/src/read.getPipelineHandler',
      'POST /pipelines': {
        function: {
          handler: 'packages/functions/src/pipeline.createPipeline',
          timeout: '30 seconds',
        },
      },
      'PUT /pipelines/{id}': {
        function: {
          handler: 'packages/functions/src/pipeline.updatePipeline',
          timeout: '30 seconds',
        },
      },
      'DELETE /pipelines/{id}': {
        function: {
          handler: 'packages/functions/src/pipeline.deletePipeline',
          timeout: '30 seconds',
        },
      },
      // Prompt CRUD (configurable-llm-pipeline · T-09, R-35).
      'GET /prompts': 'packages/functions/src/read.getPromptsHandler',
      'GET /prompts/{key}': 'packages/functions/src/read.getPromptHandler',
      'GET /prompts/{key}/versions': 'packages/functions/src/read.getPromptVersionsHandler',
      'POST /prompts': {
        function: {
          handler: 'packages/functions/src/pipeline.createPrompt',
          timeout: '30 seconds',
        },
      },
      'PUT /prompts/{key}': {
        function: {
          handler: 'packages/functions/src/pipeline.updatePrompt',
          timeout: '30 seconds',
        },
      },
      'DELETE /prompts/{key}': {
        function: {
          handler: 'packages/functions/src/pipeline.deletePrompt',
          timeout: '30 seconds',
        },
      },
      // Pipeline run status (configurable-llm-pipeline · T-09, T-05, R-35).
      // Lazy lease-expiry check included in handler (T-05, R-25, R-26-loop).
      'GET /runs': 'packages/functions/src/read.getPipelineRunsHandler',
      'GET /runs/{runId}': 'packages/functions/src/read.getPipelineRunHandler',
      // Run artifact — emitted test from the last plan step (v0.4.0 · R-65).
      'GET /runs/{runId}/artifact': 'packages/functions/src/read.runArtifact',
    },
  });

  // Deploy-time seed of the canonical PROMPT#v1 record (T-03 · R-62, R-63).
  // Uses a conditional put (`attribute_not_exists(PK)`) so re-deploys are
  // idempotent. Both FunctionalWorker and ExperimentWorker depend on this
  // record existing before their code is live (D-7, T-07): the addDependency
  // calls below force CloudFormation to complete the seeder Custom Resource
  // before updating either worker Lambda, closing the deploy-window race where
  // PROMPT#v1 is missing from DDB but the handler already tries to look it up.
  const seeder = new Script(stack, 'PromptV1Seeder', {
    defaults: {
      function: {
        bind: [registry],
      },
    },
    onCreate: 'packages/functions/src/prompt-seed.handler',
    onUpdate: 'packages/functions/src/prompt-seed.handler',
  });

  // Ensure seeder runs before worker Lambdas are deployed/updated.
  functionalWorker.node.addDependency(seeder);
  experimentWorker.node.addDependency(seeder);
  stepWorkerFn.node.addDependency(seeder);

  stack.addOutputs({ ApiUrl: api.url });

  return { api };
}
