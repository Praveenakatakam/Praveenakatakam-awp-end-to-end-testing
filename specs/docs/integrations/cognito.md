# Cognito Integration

## User pool

- Self-signup **disabled** — users are admin-created only
- Native username+password IdP with SRP flow (no Hosted UI)
- Two groups: **`reader`** (all GETs) and **`writer`** (GETs + refresh + generate)
- Two seeded demo users: `reader@demo` (reader group) and `writer@demo` (both groups)
- Users seeded at deploy-time via an SST `Script` Lambda calling `AdminCreateUser` / `AdminAddUserToGroup` / `AdminSetUserPassword` — idempotent on redeploy

## Lambda authorizer (`RegistryAuthorizer`)

A Lambda REQUEST authorizer sits in front of every route on the HTTP API. It:
1. Verifies the Cognito **access token** using `aws-jwt-verify` (`CognitoJwtVerifier`)
2. Checks `event.routeKey` against `WRITER_ROUTES` set
3. Checks `cognito:groups` claim for group membership
4. Returns `Allow` or `Deny` — passes `{ sub, username, groups }` to handlers on Allow

Status codes: missing `Authorization` header → `401` (gateway short-circuits before the authorizer). Present-but-rejected token → `403`.

Authorizer result caching is **disabled** (`resultsCacheTtl: 0`) — a read-route Allow must not be replayed against `POST /refresh`.

## SPA login

The React SPA uses `amazon-cognito-identity-js` for native SRP sign-in (an in-app form, not a Hosted UI redirect). On `NEW_PASSWORD_REQUIRED` challenge (first login), the SPA prompts for a new password and completes the flow. Access token is attached as `Authorization: Bearer <token>` on all API calls.

## Credentials

Demo passwords are stored as SST Secret `REGISTRY_DEMO_PASSWORD` — never hardcoded, fetched at deploy/run time from SSM.
