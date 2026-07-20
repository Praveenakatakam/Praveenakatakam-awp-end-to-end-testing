/**
 * Source-of-truth generator for the architecture diagrams (draw.io / AWS symbols).
 *
 * Run:  node docs/diagrams/build-diagrams.mjs        # regenerate the .drawio files
 * then: drawio --export --format png --scale 2 --border 24 \
 *         --output docs/diagrams/<name>.png docs/diagrams/<name>.drawio
 *
 * Emits registry-architecture.drawio and testgen-architecture.drawio next to
 * this file. Edit the node/edge specs below (positions, labels, AWS resIcons)
 * rather than hand-editing the XML.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = dirname(fileURLToPath(import.meta.url));
mkdirSync(OUT, { recursive: true });

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/\n/g, "&#10;");

// AWS 2023 resource-icon glyphs + category colors.
const AWS = {
  user: { icon: "user", color: "#232F3E" },
  cloudfront: { icon: "cloudfront", color: "#8C4FFF" },
  cognito: { icon: "cognito", color: "#DD344C" },
  apigw: { icon: "api_gateway", color: "#E7157B" },
  lambda: { icon: "lambda", color: "#ED7100" },
  dynamodb: { icon: "dynamodb", color: "#4D72F3" },
  s3: { icon: "s3", color: "#7AA116" },
};

function awsCell(id, label, kind, x, y, labelTop = false) {
  const { icon, color } = AWS[kind];
  const lp = labelTop ? "verticalLabelPosition=top;verticalAlign=bottom;" : "verticalLabelPosition=bottom;verticalAlign=top;";
  const style = `sketch=0;outlineConnect=0;fontColor=#232F3E;gradientColor=none;fillColor=${color};strokeColor=none;dashed=0;${lp}align=center;html=1;fontSize=13;fontStyle=0;aspect=fixed;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.${icon};`;
  return `<mxCell id="${id}" value="${esc(label)}" style="${style}" vertex="1" parent="1"><mxGeometry x="${x}" y="${y}" width="78" height="78" as="geometry"/></mxCell>`;
}

function boxCell(id, label, x, y, w = 190, h = 66, variant = "plain") {
  const styles = {
    plain: "rounded=1;whiteSpace=wrap;html=1;fillColor=#F2F4F6;strokeColor=#7F8C9B;fontColor=#232F3E;fontSize=13;arcSize=10;",
    ext: "rounded=1;whiteSpace=wrap;html=1;fillColor=#24292E;strokeColor=none;fontColor=#FFFFFF;fontSize=13;arcSize=10;",
    pkg: "rounded=1;whiteSpace=wrap;html=1;fillColor=#EAF2FF;strokeColor=#4D72F3;fontColor=#12245A;fontSize=13;dashed=1;arcSize=10;align=left;spacingLeft=12;spacingTop=8;verticalAlign=top;",
    repo: "shape=folder;whiteSpace=wrap;html=1;fillColor=#EAF7EE;strokeColor=#3F9142;fontColor=#153B18;fontSize=13;",
    // upstream context (not part of this component; shown so --local's catalog source is visible)
    ctx: "rounded=1;whiteSpace=wrap;html=1;fillColor=#F0F2F5;strokeColor=#A9B4C0;fontColor=#4A5560;fontSize=12;dashed=1;arcSize=10;",
    // a left-aligned explanatory note / legend
    note: "rounded=1;whiteSpace=wrap;html=1;fillColor=#FFFDF3;strokeColor=#D8C88A;fontColor=#5B4E1F;fontSize=13;align=left;spacingLeft=14;spacingTop=10;verticalAlign=top;arcSize=4;",
  };
  return `<mxCell id="${id}" value="${esc(label)}" style="${styles[variant]}" vertex="1" parent="1"><mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry"/></mxCell>`;
}

// A background swimlane/zone. Drawn BEFORE other cells so it sits behind them.
function zone(id, label, x, y, w, h, tint = "cloud") {
  const tints = {
    local: "fillColor=#F4F9F4;strokeColor=#B9D2B9;",
    cloud: "fillColor=#F3F7FE;strokeColor=#B9C9E8;",
  };
  const style = `rounded=1;whiteSpace=wrap;html=1;${tints[tint]}fontColor=#6B7785;fontSize=15;fontStyle=1;verticalAlign=top;align=left;spacingLeft=16;spacingTop=12;dashed=0;arcSize=2;`;
  return `<mxCell id="${id}" value="${esc(label)}" style="${style}" vertex="1" parent="1"><mxGeometry x="${x}" y="${y}" width="${w}" height="${h}" as="geometry"/></mxCell>`;
}

function subtitle(id, text, x, y, w) {
  return `<mxCell id="${id}" value="${esc(text)}" style="text;html=1;align=left;verticalAlign=top;fontSize=13;fontColor=#5A6B7B;whiteSpace=wrap;" vertex="1" parent="1"><mxGeometry x="${x}" y="${y}" width="${w}" height="44" as="geometry"/></mxCell>`;
}

// opts: { dashed, exit:[x,y], entry:[x,y], points:[[x,y]...] }
function edge(id, src, tgt, label = "", opts = {}) {
  let style = "edgeStyle=orthogonalEdgeStyle;rounded=1;html=1;jettySize=auto;endArrow=block;endFill=1;strokeColor=#5A6B7B;fontColor=#233240;fontSize=13;labelBackgroundColor=#FFFFFF;spacingTop=2;spacingBottom=2;";
  if (opts.dashed) style += "dashed=1;";
  if (opts.exit) style += `exitX=${opts.exit[0]};exitY=${opts.exit[1]};exitDx=0;exitDy=0;`;
  if (opts.entry) style += `entryX=${opts.entry[0]};entryY=${opts.entry[1]};entryDx=0;entryDy=0;`;
  const pts = opts.points?.length
    ? `<Array as="points">${opts.points.map((p) => `<mxPoint x="${p[0]}" y="${p[1]}"/>`).join("")}</Array>`
    : "";
  return `<mxCell id="${id}" value="${esc(label)}" style="${style}" edge="1" parent="1" source="${src}" target="${tgt}"><mxGeometry relative="1" as="geometry">${pts}</mxGeometry></mxCell>`;
}

function title(id, text, x, y, w) {
  return `<mxCell id="${id}" value="${esc(text)}" style="text;html=1;align=left;verticalAlign=middle;fontSize=18;fontStyle=1;fontColor=#232F3E;" vertex="1" parent="1"><mxGeometry x="${x}" y="${y}" width="${w}" height="32" as="geometry"/></mxCell>`;
}

function doc(name, diagramId, cells, w = 1400, h = 900) {
  return `<mxfile host="app.diagrams.net" type="device"><diagram id="${diagramId}" name="${name}"><mxGraphModel dx="1200" dy="800" grid="0" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="${w}" pageHeight="${h}" math="0" shadow="0"><root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells.join("")}</root></mxGraphModel></diagram></mxfile>`;
}

// ---- Diagram 1: registry core architecture (README + design §1) ----
// Columns: A=40 (user/cf) · B=340 (cognito/apigw) · C=640 (authz/refresh/read col split) · storage row bottom.
const d1 = [
  title("t1", "ODCS Contract Registry — Architecture", 40, 24, 900),
  awsCell("user", "User — React SPA\n(Cognito SRP login)", "user", 40, 150, true),
  awsCell("cf", "CloudFront\nSPA hosting", "cloudfront", 40, 420),
  awsCell("cognito", "Amazon Cognito\nUser Pool · reader/writer groups", "cognito", 420, 70),
  awsCell("apigw", "API Gateway HTTP API\n+ Lambda authorizer", "apigw", 420, 420),
  awsCell("authz", "RegistryAuthorizer\naws-jwt-verify · group rule", "lambda", 820, 70),
  awsCell("refresh", "Refresh / Crawl Lambda\nPOST /refresh (writer)", "lambda", 820, 420),
  boxCell("github", "GitHub source repos\nawp-odcs-publishing · -consuming\nGit Trees+Blobs · fine-grained PAT", 1180, 421, 280, 90, "ext"),
  awsCell("read", "Read Lambdas\nGET /contracts · /entities · /crawls", "lambda", 420, 720),
  awsCell("ddb", "DynamoDB Registry\nsingle-table · GSI byEntity/byKind", "dynamodb", 820, 880),
  awsCell("s3", "S3 ContractsBucket\nraw ODCS YAML · all versions", "s3", 1180, 880),
  edge("e1", "cf", "user", "serves SPA", { exit: [0.5, 0], entry: [0.5, 1] }),
  edge("e2", "user", "cognito", "SRP login", { exit: [1, 0.3], entry: [0, 0.5] }),
  edge("e3", "user", "apigw", "Bearer token", { exit: [1, 0.5], entry: [0, 0.5], points: [[320, 189], [320, 459]] }),
  edge("e4", "authz", "cognito", "verify token + groups", { exit: [0, 0.5], entry: [1, 0.5] }),
  edge("e5", "apigw", "authz", "every route", { exit: [0.5, 0], entry: [0.5, 1], points: [[459, 270], [859, 270]] }),
  edge("e6", "apigw", "refresh", "writer", { exit: [1, 0.5], entry: [0, 0.5] }),
  edge("e7", "apigw", "read", "reader", { exit: [0.5, 1], entry: [0.5, 0] }),
  edge("e8", "refresh", "github", "crawl Trees+Blobs", { exit: [1, 0.5], entry: [0, 0.5] }),
  edge("e9", "refresh", "ddb", "catalog", { exit: [0.5, 1], entry: [0.5, 0] }),
  edge("e10", "refresh", "s3", "raw bytes", { exit: [0.9, 1], entry: [0.5, 0], points: [[886, 660], [1219, 660]] }),
  edge("e11", "read", "ddb", "serve cache", { exit: [1, 0.5], entry: [0, 0.5] }),
  edge("e12", "read", "s3", "raw YAML", { exit: [0.5, 1], entry: [0.5, 1], points: [[459, 1020], [1219, 1020]] }),
];
writeFileSync(join(OUT, "registry-architecture.drawio"), doc("Registry Architecture", "registry-arch", d1, 1520, 1100));

// ---- Diagram 2: Test Generator component (design §9.1) ----
// Told as a "why", not just wiring:
//   · subtitle states the PURPOSE (catch cross-app contract breaks).
//   · @registry/testgen sits ABOVE both zones as a shared npm package (deployed
//     nowhere) — BOTH the cloud Lambda and the local CLI (--local) call into it,
//     so the "why is it a separate package" question is answered visually.
//   · two swimlanes name the halves: ① your machine (local repo) vs ② cloud (AWS).
//   · the read-back path (default/--pull pull GET /test-artifacts/latest) and the
//     catalog source (Lambda reads the DDB catalog) are now drawn.
//   · a legend spells out exactly which calls each of the 3 CLI modes makes.
// Dashed edges = the --local path. Store label sits above its icon to keep the
// arrowheads into its base clear.
const d2 = [
  // zones first (behind everything)
  zone("zLocal", "①  On your machine — local git repo", 40, 320, 470, 900, "local"),
  zone("zCloud", "②  Cloud — AWS (the deployed registry)", 540, 320, 1820, 900, "cloud"),

  title("t2", "Test Generator — Architecture (spec §3.9 · R-80…R-93)", 40, 24, 1400),
  subtitle("st2", "Purpose: auto-generate conformance + cross-app compatibility tests from the contract registry, so one app's schema change can't silently break another. Generation + storage only — actually running the tests is out of scope.", 40, 56, 2000),

  // the shared engine, above both zones — a package, not a deployed resource
  boxCell("testgen", "@registry/testgen — the shared pure engine  (an npm package, deployed nowhere)\nImported by BOTH the cloud Lambda AND the local CLI (--local) ⇒ one code path, identical & deterministic output, unit-tested offline with zero AWS.\nin: contract catalog     →     out: manifest + Vitest test files\n• deriveJsonSchema — schema[] → JSON Schema (Ajv)      • checkCompat — every consumer-required prop must exist in the publisher (⊆)\n• buildManifest — the source-of-truth JSON            • emit Vitest — *.generated.test.ts files", 560, 100, 1780, 180, "pkg"),

  // ① local zone
  awsCell("dev", "Developer / CI\ntriggers a run", "user", 130, 440, true),
  boxCell("cli", "generate-tests CLI\nnpm run generate-tests\nmodes: default · --pull · --local\n(writes files only — never commits)", 95, 590, 380, 150, "plain"),
  boxCell("tree", "generated-tests/  — in THIS repo\nmanifest.json · conformance/… · compat/…\ncommitted to git; you review the diff", 95, 890, 380, 130, "repo"),

  // ② cloud zone
  awsCell("apigw", "API Gateway HTTP API\nLambda authorizer: writer vs reader token", "apigw", 680, 750, true),
  awsCell("gen", "generate.handler\nPOST /generate-tests (writer)", "lambda", 1080, 560),
  awsCell("read", "test-artifacts handlers\nGET /test-artifacts [ /{id} | /latest ] (reader)", "lambda", 1080, 1020),
  boxCell("creads", "Registry read API  (upstream)\nGET /contracts · /{…}/raw (reader)\nsource for --local; raw YAML from S3", 640, 1060, 360, 110, "ctx"),
  awsCell("ddb", "DynamoDB Registry\ncatalog + GEN#{runId} (byKind GSI)", "dynamodb", 2100, 580, true),
  awsCell("s3", "S3 ContractsBucket\ntest-artifacts/{runId}/artifacts.json\n(+ raw ODCS YAML)", "s3", 2100, 1020),

  // developer drives the CLI
  edge("f0", "dev", "cli", "runs", { exit: [0.5, 1], entry: [0.5, 0] }),
  // CLI ⇄ cloud: one HTTPS link (which calls each mode makes is in the legend)
  edge("f1", "cli", "apigw", "HTTPS · Cognito token", { exit: [1, 0.8], entry: [0, 0.35], points: [[565, 710], [565, 780]] }),
  // CLI runs the SAME engine in-process for --local (the shared-package payoff)
  edge("f2", "cli", "testgen", "--local: runs the engine in-process", { dashed: true, exit: [0.75, 0], entry: [0.06, 1], points: [[380, 302], [667, 302]] }),
  // CLI writes the local tree
  edge("f3", "cli", "tree", "writes tree — you review git diff + commit", { exit: [0.5, 1], entry: [0.5, 0] }),

  // routing inside the cloud
  edge("f4", "apigw", "gen", "writer", { exit: [1, 0.3], entry: [0, 0.5] }),
  edge("f5", "apigw", "read", "reader", { exit: [1, 0.7], entry: [0, 0.5] }),
  edge("f6", "apigw", "creads", "reader (--local)", { dashed: true, exit: [0.3, 1], entry: [0.5, 0] }),
  edge("f7", "gen", "testgen", "generateArtifacts(catalog)", { exit: [0.5, 0], entry: [0.5, 1], points: [[1119, 340], [1450, 340]] }),

  // catalog source + store writes/reads — each on its own lane
  edge("f8", "ddb", "gen", "read catalog", { exit: [0, 0.2], entry: [1, 0.2] }),
  edge("f9", "gen", "ddb", "write GEN run", { exit: [1, 0.8], entry: [0, 0.8] }),
  edge("f10", "gen", "s3", "put artifacts", { exit: [1, 0.95], entry: [0, 0.2], points: [[1260, 634], [1260, 880], [2020, 880]] }),
  edge("f11", "read", "s3", "get artifacts", { exit: [1, 0.5], entry: [0, 0.6] }),
  edge("f12", "read", "ddb", "list / get runs", { exit: [0.7, 0], entry: [0.5, 1], points: [[1135, 940], [2139, 940]] }),
  edge("f13", "creads", "ddb", "reads contracts", { exit: [0.9, 1], entry: [1, 0.5], points: [[966, 1200], [2260, 1200], [2260, 619]] }),

  // the payoff legend — exactly what each mode does
  boxCell("legend", "The three CLI modes  ·  every mode ends by writing generated-tests/, which you then review & commit  ·  dashed arrows = the --local path\n   default   →   POST /generate-tests  (generate in the cloud)   →   GET /test-artifacts/latest  (pull the result)   →   write tree\n   --pull    →   GET /test-artifacts/latest  (pull the last stored run only, no new generation)   →   write tree\n   --local   →   GET /contracts + /raw   →   generateArtifacts() on your machine (the SAME engine as the Lambda)   →   write tree", 40, 1270, 2320, 155, "note"),
];
writeFileSync(join(OUT, "testgen-architecture.drawio"), doc("Test Generator Architecture", "testgen-arch", d2, 2400, 1460));

console.log("wrote both .drawio files to", OUT);
