import { describe, it, expect, beforeAll } from 'vitest';
import { type Template } from 'aws-cdk-lib/assertions';
import { synthStacks } from './synth.js';
import { StorageStack } from '../StorageStack.js';
import { AuthStack } from '../AuthStack.js';
import { ApiStack } from '../ApiStack.js';

// T-09a — CDK template assertions for configurable-llm-pipeline infra changes (R-17, R-35).
// Covers: StepWorkerFunction properties, EventInvokeConfig, IAM grants, new API routes.
describe('ApiStack — configurable-llm-pipeline infra (T-09)', () => {
  let template: Template;

  beforeAll(async () => {
    template = await synthStacks([StorageStack, AuthStack, ApiStack], ApiStack);
  });

  // ── Step worker Lambda ─────────────────────────────────────────────────────

  it('StepWorkerFunction has Timeout: 900 (15 min) and MemorySize: 1024 (T-09 · D-10)', () => {
    // StepWorkerFunction is the only 900-second Lambda that does NOT have BEDROCK_MODEL_ID
    // in its env (FunctionalWorker and ExperimentWorker both carry that key).
    // Using AWS_LAMBDA_FUNCTION_NAME for self-invocation avoids a CDK self-reference cycle.
    const fns = template.findResources('AWS::Lambda::Function');
    const stepWorkerFn = Object.values(fns).find(
      (f: any) =>
        f.Properties?.Timeout === 900 &&
        f.Properties?.MemorySize === 1024 &&
        f.Properties?.Environment?.Variables?.BEDROCK_MODEL_ID === undefined
    ) as any;
    expect(stepWorkerFn, 'StepWorkerFunction (timeout=900, no BEDROCK_MODEL_ID) not found').toBeDefined();
    expect(stepWorkerFn.Properties.Timeout).toBe(900);
    expect(stepWorkerFn.Properties.MemorySize).toBe(1024);
  });

  it('EventInvokeConfig on StepWorkerFunction has MaximumRetryAttempts: 0 (D-10 — prevents AWS retry on partial write)', () => {
    // retryAttempts: 0 is critical: an AWS-managed retry would replay a
    // partially-written step record and corrupt the run state.
    template.hasResourceProperties('AWS::Lambda::EventInvokeConfig', {
      MaximumRetryAttempts: 0,
    });
  });

  // ── IAM grants ────────────────────────────────────────────────────────────

  it('grants bedrock:InvokeModel on Anthropic foundation-model and inference-profile ARNs (R-17)', () => {
    // Bedrock calls use SigV4 via the execution role — no stored key.
    // Both ARN patterns must be present in at least one Allow statement.
    const policies = template.findResources('AWS::IAM::Policy');
    const hasBedrockOnAnthropicArns = Object.values(policies).some((p: any) =>
      (p.Properties?.PolicyDocument?.Statement ?? []).some((s: any) => {
        const action = s.Action;
        const hasAction =
          action === 'bedrock:InvokeModel' ||
          (Array.isArray(action) && action.includes('bedrock:InvokeModel'));
        if (!hasAction || s.Effect !== 'Allow') return false;
        const resources: string[] = Array.isArray(s.Resource)
          ? s.Resource
          : typeof s.Resource === 'string'
            ? [s.Resource]
            : [];
        const hasFoundationModel = resources.some(
          (r) => typeof r === 'string' && r.includes('foundation-model/anthropic')
        );
        const hasInferenceProfile = resources.some(
          (r) => typeof r === 'string' && r.includes('inference-profile')
        );
        return hasFoundationModel && hasInferenceProfile;
      })
    );
    expect(hasBedrockOnAnthropicArns).toBe(true);
  });

  it('grants lambda:InvokeFunction for self-invocation chaining on StepWorkerFunction (T-09 · D-10)', () => {
    // The step worker invokes itself asynchronously to dispatch the next step.
    const policies = template.findResources('AWS::IAM::Policy');
    const hasLambdaInvoke = Object.values(policies).some((p: any) =>
      (p.Properties?.PolicyDocument?.Statement ?? []).some((s: any) => {
        const action = s.Action;
        return (
          s.Effect === 'Allow' &&
          (action === 'lambda:InvokeFunction' ||
            (Array.isArray(action) && action.includes('lambda:InvokeFunction')))
        );
      })
    );
    expect(hasLambdaInvoke).toBe(true);
  });

  // ── New API routes ────────────────────────────────────────────────────────

  it('registers all pipeline CRUD routes, all authorizer-protected (T-09 · R-35)', () => {
    for (const RouteKey of [
      'GET /pipelines',
      'GET /pipelines/{id}',
      'POST /pipelines',
      'PUT /pipelines/{id}',
      'DELETE /pipelines/{id}',
    ]) {
      template.hasResourceProperties('AWS::ApiGatewayV2::Route', { RouteKey, AuthorizationType: 'CUSTOM' });
    }
  });

  it('registers all prompt CRUD routes, all authorizer-protected (T-09 · R-35)', () => {
    for (const RouteKey of [
      'GET /prompts',
      'GET /prompts/{key}',
      'GET /prompts/{key}/versions',
      'POST /prompts',
      'PUT /prompts/{key}',
      'DELETE /prompts/{key}',
    ]) {
      template.hasResourceProperties('AWS::ApiGatewayV2::Route', { RouteKey, AuthorizationType: 'CUSTOM' });
    }
  });

  it('registers GET /runs/{runId} route with authorizer (T-09 · T-05, R-25, R-26-loop)', () => {
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
      RouteKey: 'GET /runs/{runId}',
      AuthorizationType: 'CUSTOM',
    });
  });

  it('registers POST /prompts/import-legacy route with authorizer (v0.4.0 · R-72)', () => {
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
      RouteKey: 'POST /prompts/import-legacy',
      AuthorizationType: 'CUSTOM',
    });
  });

  it('registers GET /runs/{runId}/artifact route with authorizer (v0.4.0 · R-65)', () => {
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
      RouteKey: 'GET /runs/{runId}/artifact',
      AuthorizationType: 'CUSTOM',
    });
  });

  // ── Functional-gen handler env var ────────────────────────────────────────

  it('functional-gen handler carries STEP_WORKER_FUNCTION_NAME for dual-path dispatch (T-08 · D-13)', () => {
    // POST /generate-functional-tests handler branches on pipelineId presence:
    // present → async-invoke StepWorkerFunction; absent → legacy FJOB path.
    // Both worker ARNs must be available as env vars.
    const fns = template.findResources('AWS::Lambda::Function');
    const functionalGenHandler = Object.values(fns).find(
      (f: any) =>
        f.Properties?.Environment?.Variables?.FUNCTIONAL_WORKER_FUNCTION_NAME !== undefined &&
        f.Properties?.Environment?.Variables?.STEP_WORKER_FUNCTION_NAME !== undefined
    );
    expect(
      functionalGenHandler,
      'functional-gen handler with both FUNCTIONAL_WORKER_FUNCTION_NAME and STEP_WORKER_FUNCTION_NAME not found'
    ).toBeDefined();
  });

  // ── Step count sanity check ───────────────────────────────────────────────

  it('stack has at least three 15-minute Lambda functions (FunctionalWorker, ExperimentWorker, StepWorkerFunction)', () => {
    const fns = template.findResources('AWS::Lambda::Function');
    const longTimeoutFns = Object.values(fns).filter(
      (f: any) => (f as any).Properties?.Timeout === 900
    );
    expect(longTimeoutFns.length).toBeGreaterThanOrEqual(3);
  });
});
