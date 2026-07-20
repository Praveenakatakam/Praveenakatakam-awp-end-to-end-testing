import { describe, it, expect, beforeEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  AdminAddUserToGroupCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { seedUsers, DEMO_USERS } from "../src/seed.js";

const cognito = mockClient(CognitoIdentityProviderClient);

describe("seedUsers (T-08 · R-72, D-17 · AC-72)", () => {
  beforeEach(() => {
    cognito.reset();
  });

  it("creates a reader and a writer user, each in its group(s), with a permanent password", async () => {
    cognito.on(AdminCreateUserCommand).resolves({});
    cognito.on(AdminSetUserPasswordCommand).resolves({});
    cognito.on(AdminAddUserToGroupCommand).resolves({});

    const res = await seedUsers("us-east-1_pool", "Pw!", cognito as any);
    expect(res.seeded).toEqual(["reader@demo", "writer@demo"]);

    // Two users created.
    expect(cognito.commandCalls(AdminCreateUserCommand)).toHaveLength(2);
    // Passwords set permanent (no NEW_PASSWORD_REQUIRED for the demo).
    const pwCalls = cognito.commandCalls(AdminSetUserPasswordCommand);
    expect(pwCalls).toHaveLength(2);
    expect(pwCalls[0].args[0].input.Permanent).toBe(true);
    // writer is added to both writer and reader groups (so it can also read).
    const groups = cognito
      .commandCalls(AdminAddUserToGroupCommand)
      .map((c) => c.args[0].input.GroupName);
    expect(groups).toEqual(["reader", "writer", "reader"]);
  });

  it("is idempotent — an already-existing user does not fail the seed", async () => {
    const exists = Object.assign(new Error("exists"), { name: "UsernameExistsException" });
    cognito.on(AdminCreateUserCommand).rejects(exists);
    cognito.on(AdminSetUserPasswordCommand).resolves({});
    cognito.on(AdminAddUserToGroupCommand).resolves({});

    const res = await seedUsers("us-east-1_pool", "Pw!", cognito as any);
    expect(res.seeded).toEqual(["reader@demo", "writer@demo"]);
    // Groups + password still (re)applied despite the pre-existing users.
    expect(cognito.commandCalls(AdminAddUserToGroupCommand).length).toBeGreaterThan(0);
  });

  it("declares the two demo users with the expected groups", () => {
    expect(DEMO_USERS).toEqual([
      { username: "reader@demo", groups: ["reader"] },
      { username: "writer@demo", groups: ["writer", "reader"] },
    ]);
  });
});
