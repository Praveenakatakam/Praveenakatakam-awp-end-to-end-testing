# specs/

Spec-driven development root. All SDD work lives here.

## Layout

```
specs/
  README.md                  ← you are here — agent orientation
  registry.yaml              ← metadata index for all specs
  docs/                      ← agent-facing reference documentation (small files)
    sdd/                     ← how SDD works in this repo
    system-design/           ← architecture, components, API surface
    data-model/              ← DynamoDB/S3 schemas
    integrations/            ← GitHub, Cognito, Bedrock boundaries
  pending/                   ← <feature-slug>/stub.md — ideas not yet started
  active/                    ← <feature-slug>/{stub,requirements,design,tasks}.md
  archive/                   ← completed specs moved from active/
```

## SDD lifecycle

```
idea → pending/<slug>/stub.md
     → active/<slug>/stub.md        (initiate)
     → active/<slug>/requirements.md
     → active/<slug>/design.md
     → active/<slug>/tasks.md
     → archive/<slug>/              (complete)
```

See [docs/sdd/README.md](docs/sdd/README.md) for the full workflow.

## Finding things

- **What does the system do?** → [docs/system-design/overview.md](docs/system-design/overview.md)
- **API routes?** → [docs/system-design/api-surface.md](docs/system-design/api-surface.md)
- **Data model?** → [docs/data-model/README.md](docs/data-model/README.md)
- **How does X integrate?** → [docs/integrations/](docs/integrations/)
- **Active spec work?** → [active/](active/) — one folder per feature
- **Registry of all specs?** → [registry.yaml](registry.yaml)
