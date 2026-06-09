# 🏗️ CDK TypeScript Template

This project is a **College Board Infrastructure CDK (TypeScript)** template designed to run cleanly on **Node 22+** with **pnpm** as the package manager.  
It provides a simple base stack (`CdkStack`) that can be customized and deployed to AWS via the AWS CDK CLI.

---

## 🧰 Requirements

- **Node.js 22+**  
  You can install it via [nvm](https://github.com/nvm-sh/nvm):
  ```bash
  nvm install 22
  nvm use 22
  ```

- **pnpm**  
  Recommended package manager for this repo.

  ### Quick install on macOS
  ```bash
  # Corepack method (Node 16.13+)
  corepack enable
  corepack prepare pnpm@latest --activate
  pnpm -v

  # or via npm if Corepack fails
  npm i -g pnpm --force
  ```

- **AWS CLI v2+**  
  Configure with your profiles and MFA:
  ```bash
  aws configure
  ```

- **CDK CLI**
  ```bash
  pnpm add -g aws-cdk
  ```

---

## 📦 Project Setup

1. **Install dependencies**
   ```bash
   pnpm install
   ```

2. **Build the project**
   ```bash
   pnpm build
   ```

3. **Verify stack list**
   ```bash
   pnpm cdk list
   ```

---

## ⚙️ Design Notes

- Built for **Node 22** and **TypeScript 5+**
- Uses `pnpm` instead of `npm` or `yarn`
- Uses **CommonJS** module output for CDK compatibility (`"module": "CommonJS"` in `tsconfig.json`)
- `cdk.json` runs the compiled JS entrypoint:
  ```json
  {
    "app": "node --enable-source-maps bin/cdk.js"
  }
  ```
- Includes a simple base stack that provisions an SQS queue (see `lib/cdk-stack.ts`)

---

## 🧾 College Board AWS Profile Setup

Example profile configuration in `~/.aws/config` for MFA-secured role assumption:

```ini
[profile cb-cia-admin-prod]
aws_access_key_id = <YOUR_ACCESS_KEY>
aws_secret_access_key = <YOUR_SECRET_KEY>
region = us-east-1
output = json

[profile cb-pops-nonprod-admin-admin]
role_arn = arn:aws:iam::xxxxxxx:role/xxxxxx
source_profile = cb-cia-admin-prod
mfa_serial = arn:aws:iam::xxxxxxxx:mfa/jtierney
region = us-east-1
output = json
```

Then, export and validate your AWS profile before deploying:

```bash
export AWS_PROFILE=cb-pops-nonprod-admin-admin
aws sts get-caller-identity
```

---

## 🚀 Deployment Workflow

### 1. Choose your AWS profile
```bash
export AWS_PROFILE=cb-xxx-xxx-xxx
```

### 2. Bootstrap (once per account/region)
```bash
pnpm cdk bootstrap aws://123456789/us-east-1
```

### 3. Synthesize the CloudFormation template
```bash
pnpm cdk synth
```

### 4. Deploy the stack
```bash
pnpm cdk deploy CdkStack
# or deploy all stacks
pnpm cdk deploy --all
```

### 5. Destroy the stack (optional cleanup)
```bash
pnpm cdk destroy CdkStack
```

---

## 🧹 Useful Commands

```bash
pnpm lint               # Lint code
pnpm format:fix         # Format TypeScript files
pnpm test:unit          # Run Jest tests
pnpm cdk diff           # Show what would change on deploy
pnpm cdk doctor         # Diagnose environment issues
```

---

## 📚 References

- [AWS CDK v2 Docs](https://docs.aws.amazon.com/cdk/v2/guide/home.html)  
- [pnpm Docs](https://pnpm.io/motivation)  
- [Node 22 Release Notes](https://nodejs.org/en/blog/release/v22.0.0)