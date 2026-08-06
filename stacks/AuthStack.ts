import { StackContext, Cognito, Config, Script } from 'sst/constructs';
import { CfnUserPoolGroup } from 'aws-cdk-lib/aws-cognito';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';

/**
 * T-07 — Cognito for native username+password auth with role groups.
 *
 *   R-70 — self-service sign-up disabled; users are admin-created (seed T-08).
 *   R-71 — `reader` (GET) and `writer` (GET + POST /refresh) groups; the
 *          Lambda authorizer (T-09) derives authorisation from the caller's
 *          `cognito:groups` claim.
 *   R-56 — the pool issues the access tokens every endpoint requires.
 *
 * Native SRP login (no Hosted UI); the app client is public (no secret),
 * mirroring the consuming app.
 */
export function AuthStack({ stack }: StackContext) {
  const auth = new Cognito(stack, 'Auth', {
    login: ['username'],
    cdk: {
      userPool: {
        selfSignUpEnabled: false,
      },
      userPoolClient: {
        generateSecret: false,
        authFlows: {
          userSrp: true,
          userPassword: true,
        },
      },
    },
  });

  new CfnUserPoolGroup(stack, 'ReaderGroup', {
    userPoolId: auth.userPoolId,
    groupName: 'reader',
    description: 'Read the contract catalog (GET endpoints).',
  });
  new CfnUserPoolGroup(stack, 'WriterGroup', {
    userPoolId: auth.userPoolId,
    groupName: 'writer',
    description: 'Trigger crawls (POST /refresh) in addition to reading.',
  });

  // Publish the Cognito coordinates to SSM as Parameters so every consumer
  // reads them through `sst/node` bindings instead of hand-threaded env vars:
  // the authorizer + seed Lambdas (bound in-code) and the `generate-tests` CLI
  // (via `sst bind`, D-35). Cognito has no native `sst/node` binding, so a
  // Config.Parameter is the idiomatic bridge for a construct value.
  const userPoolIdParam = new Config.Parameter(stack, 'USER_POOL_ID', { value: auth.userPoolId });
  const userPoolClientIdParam = new Config.Parameter(stack, 'USER_POOL_CLIENT_ID', {
    value: auth.userPoolClientId,
  });

  // Secrets (T-08): the GitHub PAT for the crawler (bound to the crawl Lambda
  // in ApiStack) and the demo-user password for the seed script. Set with
  // `npx sst secrets set GITHUB_TOKEN …` / `REGISTRY_DEMO_PASSWORD …`.
  const githubToken = new Config.Secret(stack, 'GITHUB_TOKEN');
  const demoPassword = new Config.Secret(stack, 'REGISTRY_DEMO_PASSWORD');

  // Source-crawl configuration as SST Parameters so they can be changed per
  // stage without a code redeploy (change value → sst deploy to update SSM).
  const sourceBranchParam = new Config.Parameter(stack, 'SOURCE_BRANCH', {
    value: 'feat/end-to-end-testing-registry',
  });
  const contractPathPrefixParam = new Config.Parameter(stack, 'CONTRACT_PATH_PREFIX', {
    value: 'docs/contracts/',
  });

  // Deploy-time seed of the reader + writer demo users (R-72, D-17).
  new Script(stack, 'SeedUsers', {
    defaults: {
      function: {
        bind: [demoPassword, userPoolIdParam],
        permissions: [
          new PolicyStatement({
            actions: ['cognito-idp:AdminCreateUser', 'cognito-idp:AdminSetUserPassword', 'cognito-idp:AdminAddUserToGroup'],
            resources: [auth.cdk.userPool.userPoolArn],
          }),
        ],
      },
    },
    onCreate: 'packages/functions/src/seed.handler',
    onUpdate: 'packages/functions/src/seed.handler',
  });

  stack.addOutputs({
    UserPoolId: auth.userPoolId,
    UserPoolClientId: auth.userPoolClientId,
  });

  return { auth, githubToken, userPoolIdParam, userPoolClientIdParam, sourceBranchParam, contractPathPrefixParam };
}
