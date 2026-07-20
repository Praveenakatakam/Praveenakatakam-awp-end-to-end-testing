/**
 * Deploy-time demo-user seeding (T-08 · R-72, D-17).
 *
 * Run by the SST `Script` in AuthStack on create/update. Creates one `reader`
 * and one `writer` demo user (self-signup is disabled — R-70), assigns groups,
 * and sets a permanent password so the registry is demonstrable immediately.
 * Idempotent: a pre-existing user does not fail the seed.
 */
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  AdminAddUserToGroupCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { Config } from "sst/node/config";
import { log } from "./log.js";

export const DEMO_USERS = [
  { username: "reader@demo", groups: ["reader"] },
  { username: "writer@demo", groups: ["writer", "reader"] },
] as const;

const defaultClient = new CognitoIdentityProviderClient({});

export async function seedUsers(
  userPoolId: string,
  password: string,
  client: CognitoIdentityProviderClient = defaultClient,
): Promise<{ seeded: string[] }> {
  for (const user of DEMO_USERS) {
    try {
      await client.send(
        new AdminCreateUserCommand({
          UserPoolId: userPoolId,
          Username: user.username,
          MessageAction: "SUPPRESS", // no invitation email
        }),
      );
    } catch (err) {
      if ((err as { name?: string }).name !== "UsernameExistsException") throw err;
      // Already seeded — fall through to (re)apply password + groups.
    }

    await client.send(
      new AdminSetUserPasswordCommand({
        UserPoolId: userPoolId,
        Username: user.username,
        Password: password,
        Permanent: true,
      }),
    );

    for (const group of user.groups) {
      await client.send(
        new AdminAddUserToGroupCommand({
          UserPoolId: userPoolId,
          Username: user.username,
          GroupName: group,
        }),
      );
    }
    // Username + groups only — the password is never logged (NFR-2, NFR-5).
    log.info("seed.user", { username: user.username, groups: user.groups });
  }
  return { seeded: DEMO_USERS.map((u) => u.username) };
}

/** SST `Script` entry point (T-08). */
export async function handler(): Promise<{ seeded: string[] }> {
  // Pool id + password both come from `sst/node/config` bindings (Config.Parameter
  // USER_POOL_ID + Config.Secret REGISTRY_DEMO_PASSWORD), bound to this Script.
  return seedUsers(Config.USER_POOL_ID, Config.REGISTRY_DEMO_PASSWORD);
}
