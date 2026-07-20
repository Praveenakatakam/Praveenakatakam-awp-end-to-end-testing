/**
 * Shared test helper: synthesize an SST stack to a CloudFormation template
 * fully offline (dummy AWS credentials, no network), so infra stacks can be
 * asserted with `aws-cdk-lib/assertions` without a real AWS account.
 *
 * Usage (synth once per test file, at module scope):
 *   const template = await synthStack(StorageStack);
 *   template.hasResourceProperties("AWS::DynamoDB::Table", { ... });
 */
import { App, getStack } from "sst/constructs";
import { initProject } from "sst/project.js";
import { Template } from "aws-cdk-lib/assertions";

let initialized = false;

async function ensureInit(): Promise<void> {
  if (initialized) return;
  process.env.AWS_ACCESS_KEY_ID ||= "test";
  process.env.AWS_SECRET_ACCESS_KEY ||= "test";
  process.env.AWS_REGION ||= "us-east-1";
  process.env.CDK_DEFAULT_ACCOUNT ||= "123456789012";
  process.env.CDK_DEFAULT_REGION ||= "us-east-1";
  await initProject({ stage: "test" });
  initialized = true;
}

function newApp(): App {
  return new App({
    mode: "deploy",
    stage: "test",
    name: "odcs-contract-registry",
    region: "us-east-1",
  });
}

/** Synthesize a single named SST stack function and return its CFN Template. */
export async function synthStack(fn: (ctx: any) => any): Promise<Template> {
  await ensureInit();
  const app = newApp();
  app.stack(fn);
  return Template.fromStack(getStack(fn));
}

/**
 * Synthesize several stacks (registered in order, so `use()` cross-stack
 * references resolve) and return the CFN Template for `target`.
 */
export async function synthStacks(
  fns: Array<(ctx: any) => any>,
  target: (ctx: any) => any,
): Promise<Template> {
  await ensureInit();
  const app = newApp();
  let chain: any = app;
  for (const fn of fns) chain = chain.stack(fn);
  return Template.fromStack(getStack(target));
}
