import { describe, it, expect, beforeAll } from 'vitest';
import { Match, type Template } from 'aws-cdk-lib/assertions';
import { synthStacks } from './synth.js';
import { StorageStack } from '../StorageStack.js';
import { AuthStack } from '../AuthStack.js';
import { ApiStack } from '../ApiStack.js';
import { SOURCES } from '../../packages/core/src/sources.js';

// T-10a — offline synth assertions (R-10, R-16, R-56 · AC-16*, AC-56).
describe('ApiStack', () => {
  let template: Template;
  beforeAll(async () => {
    template = await synthStacks([StorageStack, AuthStack, ApiStack], ApiStack);
  });

  it('provisions an HTTP API', () => {
    template.hasResourceProperties('AWS::ApiGatewayV2::Api', { ProtocolType: 'HTTP' });
  });

  it('wires a Lambda REQUEST authorizer with the Authorization identity source and caching disabled (D-21)', () => {
    template.hasResourceProperties('AWS::ApiGatewayV2::Authorizer', {
      AuthorizerType: 'REQUEST',
      EnableSimpleResponses: true,
      AuthorizerPayloadFormatVersion: '2.0',
      IdentitySource: ['$request.header.Authorization'],
      AuthorizerResultTtlInSeconds: 0,
    });
  });

  it('registers the refresh and read routes', () => {
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', { RouteKey: 'POST /refresh' });
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', { RouteKey: 'GET /contracts' });
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', { RouteKey: 'GET /entities/{entity}' });
    // Every route is protected by the authorizer.
    template.hasResourceProperties('AWS::ApiGatewayV2::Route', {
      RouteKey: 'GET /contracts',
      AuthorizationType: 'CUSTOM',
    });
  });

  it('registers the test-generator routes, all authorizer-protected (T-23 · R-80, R-90)', () => {
    for (const RouteKey of ['POST /generate-tests', 'GET /test-artifacts', 'GET /test-artifacts/latest', 'GET /test-artifacts/{runId}']) {
      template.hasResourceProperties('AWS::ApiGatewayV2::Route', { RouteKey, AuthorizationType: 'CUSTOM' });
    }
  });

  it('registers the requirements-catalog routes, all authorizer-protected (T-30 · R-109…R-112)', () => {
    for (const RouteKey of ['GET /requirements', 'GET /requirements/{source}', 'GET /requirements/{source}/{id}']) {
      template.hasResourceProperties('AWS::ApiGatewayV2::Route', { RouteKey, AuthorizationType: 'CUSTOM' });
    }
  });

  it('registers the functional-test-generator routes, all authorizer-protected (T-37 · §3.11, R-115, R-125)', () => {
    for (const RouteKey of [
      'POST /generate-functional-tests',
      'GET /functional-test-jobs',
      'GET /functional-test-jobs/latest',
      'GET /functional-test-jobs/{jobId}',
    ]) {
      template.hasResourceProperties('AWS::ApiGatewayV2::Route', { RouteKey, AuthorizationType: 'CUSTOM' });
    }
  });

  it('bakes CONTRACT_PATH_PREFIX into the refresh Lambda env matching sources.ts (deploy overrides SSM)', () => {
    // SST Config.Parameter values are injected as Lambda env vars at deploy time.
    // If AuthStack's hardcoded value diverges from sources.ts, every deploy
    // overwrites the env var back to the wrong path and the crawler finds 0 contracts.
    const expectedPrefix = SOURCES.find((s) => s.label === 'awp-app-plane')?.contractPathPrefix;
    const fns = template.findResources('AWS::Lambda::Function');
    const refreshFn = Object.values(fns).find((f: any) =>
      (f as any).Properties?.Environment?.Variables?.SST_Parameter_value_CONTRACT_PATH_PREFIX !== undefined
    ) as any;
    expect(refreshFn).toBeDefined();
    expect(refreshFn.Properties.Environment.Variables.SST_Parameter_value_CONTRACT_PATH_PREFIX).toBe(expectedPrefix);
  });

  it('grants the functional worker bedrock:InvokeModel via its IAM role, with no stored key (R-118, D-55, NFR-2)', () => {
    // The Bedrock call authenticates with the Lambda execution role (SigV4) — an
    // IAM policy must grant bedrock:InvokeModel (Action renders as a string or array).
    const policies = template.findResources('AWS::IAM::Policy');
    const grantsBedrock = Object.values(policies).some((p: any) =>
      (p.Properties?.PolicyDocument?.Statement ?? []).some((s: any) => {
        const a = s.Action;
        const has = a === 'bedrock:InvokeModel' || (Array.isArray(a) && a.includes('bedrock:InvokeModel'));
        return s.Effect === 'Allow' && has;
      })
    );
    expect(grantsBedrock).toBe(true);

    // No function provisions an Anthropic/Bedrock API key — auth is the IAM role only.
    const fns = template.findResources('AWS::Lambda::Function');
    for (const fn of Object.values(fns)) {
      const vars = (fn as any).Properties?.Environment?.Variables ?? {};
      for (const k of Object.keys(vars)) {
        expect(k).not.toMatch(/ANTHROPIC[_-]?(API[_-]?)?KEY|BEDROCK[_-]?API[_-]?KEY/i);
      }
    }
  });
});
