import { describe, it, expect, beforeAll } from "vitest";
import { Match, type Template } from "aws-cdk-lib/assertions";
import { synthStack } from "./synth.js";
import { AuthStack } from "../AuthStack.js";

// T-07a — offline synth assertions (R-70, R-71 · AC-70, AC-71).
describe("AuthStack", () => {
  let template: Template;
  beforeAll(async () => {
    template = await synthStack(AuthStack);
  });

  it("creates one user pool with self-service sign-up disabled (R-70, D-17)", () => {
    template.resourceCountIs("AWS::Cognito::UserPool", 1);
    template.hasResourceProperties("AWS::Cognito::UserPool", {
      AdminCreateUserConfig: { AllowAdminCreateUserOnly: true },
    });
  });

  it("defines the reader and writer groups (R-71)", () => {
    template.resourceCountIs("AWS::Cognito::UserPoolGroup", 2);
    template.hasResourceProperties("AWS::Cognito::UserPoolGroup", { GroupName: "reader" });
    template.hasResourceProperties("AWS::Cognito::UserPoolGroup", { GroupName: "writer" });
  });

  it("uses a public app client with SRP auth (no secret)", () => {
    template.hasResourceProperties("AWS::Cognito::UserPoolClient", {
      ExplicitAuthFlows: Match.arrayWith(["ALLOW_USER_SRP_AUTH"]),
      GenerateSecret: false,
    });
  });
});
