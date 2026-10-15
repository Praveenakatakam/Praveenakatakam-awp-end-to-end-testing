/**
 * RegistryAuthorizer — HTTP API Lambda REQUEST authorizer (T-09 · R-16, R-56, R-71, D-21).
 *
 * Verifies the Cognito access token (`aws-jwt-verify`) and applies the per-route
 * group rule: `POST /refresh` requires the `writer` group; every read route
 * requires `reader` (writer also reads). On Allow it passes `{ sub, username,
 * groups }` to handlers via `event.requestContext.authorizer.lambda`.
 *
 * Status mapping (D-21): a missing Authorization header → `401` at the gateway
 * (this function is not even invoked); a present-but-rejected token — invalid,
 * expired, or wrong group → this function denies → `403`. Result caching is
 * disabled in ApiStack so a read-authorised token cannot be replayed against
 * `POST /refresh`.
 */
import type { APIGatewayRequestAuthorizerEventV2, APIGatewaySimpleAuthorizerWithContextResult } from 'aws-lambda';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { Config } from 'sst/node/config';
import { log } from './log.js';

export type AuthContext = { sub: string; username: string; groups: string };
type SimpleResult = APIGatewaySimpleAuthorizerWithContextResult<AuthContext>;

/** Routes that require the `writer` group (crawl + test generation + pipeline/prompt mutation). */
export const WRITER_ROUTES = new Set([
  'POST /refresh',
  'POST /generate-tests',
  'POST /generate-functional-tests',
  'POST /prompt-versions',
  'POST /experiments',
  // Pipeline CRUD mutations (T-05 · R-25)
  'POST /pipelines',
  'PUT /pipelines/{id}',
  'DELETE /pipelines/{id}',
  // Prompt CRUD mutations (T-05 · R-25)
  'POST /prompts',
  'PUT /prompts/{key}',
  'DELETE /prompts/{key}',
]);

/** The group a route requires. */
export function requiredGroup(routeKey: string): 'writer' | 'reader' {
  return WRITER_ROUTES.has(routeKey) ? 'writer' : 'reader';
}

/** Whether a caller's groups satisfy a route (writer implies read access). */
export function isAuthorized(routeKey: string, groups: string[]): boolean {
  if (requiredGroup(routeKey) === 'writer') return groups.includes('writer');
  return groups.includes('reader') || groups.includes('writer');
}

type VerifyFn = (token: string) => Promise<Record<string, unknown>>;

/** Core authorizer logic with the token verifier injected (unit-testable). */
export async function handleAuthorization(event: APIGatewayRequestAuthorizerEventV2, verify: VerifyFn): Promise<SimpleResult> {
  const raw = event.identitySource?.[0] ?? '';
  const token = raw.replace(/^Bearer\s+/i, '').trim();

  let payload: Record<string, unknown>;
  try {
    payload = await verify(token);
  } catch {
    // Token rejected — deny (403). The token itself is never logged (NFR-2).
    log.warn('authz.denied', { routeKey: event.routeKey, reason: 'token_rejected' });
    return { isAuthorized: false, context: { sub: '', username: '', groups: '' } };
  }

  const groups = Array.isArray(payload['cognito:groups']) ? (payload['cognito:groups'] as string[]) : [];
  const allowed = isAuthorized(event.routeKey, groups);
  log.info('authz.decision', { routeKey: event.routeKey, allowed, username: String(payload.username ?? ''), groups: groups.join(',') });
  return {
    isAuthorized: allowed,
    context: {
      sub: String(payload.sub ?? ''),
      username: String(payload.username ?? ''),
      groups: groups.join(','),
    },
  };
}

// Module-scoped verifier (reused across warm invocations). Cognito ACCESS
// tokens carry `client_id`, not `aud`; `tokenUse: "access"` verifies correctly.
let verifier: { verify: VerifyFn } | undefined;
function getVerifier(): { verify: VerifyFn } {
  if (!verifier) {
    verifier = CognitoJwtVerifier.create({
      userPoolId: Config.USER_POOL_ID,
      clientId: Config.USER_POOL_CLIENT_ID,
      tokenUse: 'access',
    }) as unknown as { verify: VerifyFn };
  }
  return verifier;
}

export async function handler(event: APIGatewayRequestAuthorizerEventV2): Promise<SimpleResult> {
  return handleAuthorization(event, (t) => getVerifier().verify(t));
}
