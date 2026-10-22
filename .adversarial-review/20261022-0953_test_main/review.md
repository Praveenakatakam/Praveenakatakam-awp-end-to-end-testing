# Adversarial test review — 20261022-0953_test_main
**Verdict: FAIL — Major**
- Reviewer: adversarial-test-review v0.8, model claude-fable-5-1, 2026-10-22T14:20:54.238Z
- Scope: generated-tests @ fea19df · Pass 1 written 2026-10-22T14:00:22.273Z, before Pass 2
- Dropped by posture lint: 0 · Unevidenced: 0 · Malformed: 0
- Blind items: 96 · covered 93 · uncovered 3 · not assessed by Pass 2 0
- Citation audit: 106 items checked · 0 NOT FOUND · 1 imprecise
- Claim verification (Pass 3, model claude-fable-5-1): 7 confirmed · 0 refuted · 3 unclear · 0 not verified

## Needs your decision
- D-01 — X-75 / X-76 / X-96 — provenance of jira-awp/BAWP-1551 and jira-awp/BAWP-2486 (OQ-17) — Both ids are in the committed functional manifest as skips with reason 'references no cataloged entity'. That contradicts OQ-17's note that their text 'mirror[s] CRE-R-24's text verbatim': a verbatim copy of CRE-R-24 would have matched the same entity (ground.ts mentions() is a whole-word test on the text, and CRE-R-24 did ground to TaskPublished), hit CRE-R-24's cached plan and been re-stamped, not skipped as entity-less. Either OQ-17's description is stale or the two entries' text changed between runs. SOURCES still defines exactly one source, and no ingestion path for a 'jira-awp' source exists in packages/ or stacks/ (the only non-spec hits for 'jira' are two unit-test fixtures). Decide whether these two entries are legitimate catalog members; until then the manifest's accounting of 168 ids rests on two ids of unknown origin. — evidence: generated-tests/functional/manifest.json:672-679; packages/core/src/sources.ts:19-21; packages/functest/src/ground.ts:86-88,113-116; specs/active/odcs-contract-registry/requirements.md:530 (OQ-17); Grep -i 'jira' excluding generated-tests/.adversarial-review/adversarial-reports/node_modules → 6 files, none under packages/*/src or stacks/
- D-02 — X-79 — working tree differs from HEAD for every generated file although the catalog is unchanged — git status at the start of this run lists all four compat files, the conformance file and both manifests as modified (M), yet the eight contract hashes in this run's blind-inputs.json are identical to the previous run's snapshot (.adversarial-review/20261021-1148_test_main/blind-inputs.json). Either the generator source changed between the committed tree and this regeneration (an expected diff), or R-88 byte-identity is broken. This agent's shell allowlist does not include git diff, so I could not tell which. A human should run git diff generated-tests/ and confirm the diff is explained by a generator change. — evidence: .adversarial-review/20261022-0953_test_main/blind-inputs.json:174-215 vs .adversarial-review/20261021-1148_test_main/blind-inputs.json:174-215 (same eight contentHash values); R-88; git status snapshot in the task context
- D-03 — Handoff listed only the §3.11 job report; the §3.9 run report for this tree was not passed — in_product_reports named only adversarial-reports/1792676514926-j6neyt/report.json (functest). A §3.9 testgen report for the same tree exists at adversarial-reports/1792676477717-l7axmi/report.json (executed tier, 4 entities, 83 mutants, 0 survivors). I read it anyway because X-24..X-28 can only be assessed from it. The skill says in_product_reports 'covers both the §3.9 run and the §3.11 job'. Decide whether the omission is a CLI handoff defect (in --pull mode the §3.9 report is only delivered when latest.artifacts.report exists, scripts/generate-tests.ts:490-492) or an operator omission. — evidence: scripts/generate-tests.ts:369-377,458-463,485-492; adversarial-reports/1792676477717-l7axmi/report.json:35-66; .claude/skills/adversarial-test-review/SKILL.md:116

## Findings
| ID | Severity | Target | Defect | Failure scenario | Evidence | In-product | Verified |
|---|---|---|---|---|---|---|---|
| F-01 | Major | generated-tests/functional/manifest.json:101 | The CRE-R-24 plan's trigger POST /api/create/review/advance is present in no API mapping: API_MAP has one TaskPublished entry and it is get-ready's GET /api/grdy/assignments/getTasks. | The two TaskPublished plans in this job name two different create write paths for the same publisher and entity (/api/create/review/advance here, /api/create/tasks/publish for XCT-R-11); at most one can be the real write, so at least one of the two tests fails at the trigger (non-2xx → expect(res.ok) red) against a correct create service and never exercises propagation. Nothing in the repository can tell which. | R-133e (OQ-15 → (b), D-88: Major). packages/core/src/api-map.ts:41-43 maps only '/api/grdy/assignments/getTasks' for TaskPublished; adversarial-reports/1792676514926-j6neyt/report.json:154 'The trigger POST /api/create/review/advance is in no API mapping' and :210 'The trigger POST /api/create/tasks/publish is in no API mapping'; committed finding generated-tests/functional/manifest.json:791. Plan withheld (manifest.json:101-103), so the path is also unverifiable from the tree. | A-08 | UNCLEAR |
| F-02 | Major | generated-tests/functional/manifest.json:669 | The XCT-R-11 plan's trigger POST /api/create/tasks/publish is present in no API mapping: API_MAP has one TaskPublished entry and it is get-ready's GET /api/grdy/assignments/getTasks. | Same publisher and entity as CRE-R-24 but a different write path; if /api/create/review/advance is the real write (the create contract's own description says TaskPublished is emitted 'via review.advance'), this test fails at the trigger against a correct create service and the propagation it claims to test is never exercised. | R-133e (OQ-15 → (b), D-88: Major). packages/core/src/api-map.ts:41-43; packages/adversary/tests/__fixtures__/calibration/live-20261009/create.content-events.odcs.yaml:67-71 ('approved via review.advance'; blob 506cbba… matches generated-tests/manifest.json:403); adversarial-reports/1792676514926-j6neyt/report.json:210; committed finding generated-tests/functional/manifest.json:847. | A-12 | UNCLEAR |
| F-03 | Major | packages/adversary/src/mutate-testgen.ts:69 | The manifest-tier compat oracle grades a consumer-required property with no logicalType on either side as green (undefined === undefined), while the emitted compat test and checkCompat grade the same case red ('type undeclared', R-84a). | A catalog pair where a consumer-required property omits logicalType on both sides (the ODCS validator does not constrain logicalType, so such a contract is 'valid'): the executed tier runs the emitted file → red baseline → applicable:false; the manifest tier → green → applicable:true with mutants. reviewTestgenForCli compares the two shapes and throws 'adversarial mutation tiers disagree', so the whole generate-tests CLI run aborts for one contract — the fault isolation R-85/NFR-4 promise is broken. Inside the Lambda (manifest tier only) the stage reports a green baseline for a test that is actually red. | packages/adversary/src/mutate-testgen.ts:69-71 'return t.consumerRequired.every((r) => { const name = t.fieldMap?.[r.name] ?? r.name; return pub.has(name) && pub.get(name) === r.logicalType; })'; packages/testgen/src/emit.ts:91 'expect(req.logicalType !== undefined, …).toBe(true)'; packages/testgen/src/compat.ts:74-79 'type undeclared' violation; scripts/generate-tests.ts:399-407 throws on shape mismatch; Grep 'logicalType' in packages/core/src/odcs-validator.ts → 0 matches. Rules: R-135, R-84a, R-85. | — | CONFIRMED |
| F-04 | Minor | packages/adversary/src/mutate-testgen.ts:92 | compatMutants reads only schema[0].properties, so M1–M3 are derived for top-level consumer-required properties only; nested consumer-required paths that R-84d makes compat compare (items[].itemId, address.city) are never deleted, retyped or renamed. | A regression in flattenContractProperties or checkCompat that stops comparing nested paths keeps every compat test green, and R-135 reports 100% kills because no nested mutant exists to survive; the generator defect D-86 was introduced to catch (a publisher dropping items[].itemId) would pass the mutation attack. Narrow today: no consumer in this catalog declares a nested required property (every consumerRequired entry in generated-tests/manifest.json is top-level). | packages/adversary/src/mutate-testgen.ts:90-93 'return doc?.schema?.[0]?.properties ?? []' and :118-121 required = propsOf(con.rawYaml).filter(p.required === true …); R-135 'delete a consumer-required property'; R-84d; D-86; adversarial-reports/1792676477717-l7axmi/report.json:60-65 (TaskPublished total 17 = 5 top-level × 3 + M4 + C1). | — | CONFIRMED |
| F-05 | Minor | packages/functest/src/emit.ts:72 | The functest emitter and the adversary compare ODCS logicalType case-sensitively (wireType / typeMatches), while testgen's compat and derive-schema lowercase it; the ODCS validator does not constrain logicalType casing. | A contract that writes logicalType: String (valid to the registry) yields either a correct plan withheld — the model's matchesType literal 'string' ≠ contract 'String' → R-133a Critical in grounding.ts:108-119 — or, if the model copies 'String', an emitted typeMatches(value, "String", …) that is red against a correct consumer because logicalTypeOf returns typeof's lowercase 'string'. | packages/functest/src/emit.ts:72-75 (declared = String(a.expected.value) used verbatim) and :121-133 (logicalTypeOf returns typeof value); packages/adversary/src/text.ts:19-22 (no lowercasing); contrast packages/testgen/src/compat.ts:58-59 'logicalType is compared case-insensitively' and packages/testgen/src/derive-schema.ts:24; Grep 'logicalType' in packages/core/src/odcs-validator.ts → 0 matches. Rules: R-117b, R-133a. | — | UNCLEAR |
| F-06 | Minor | packages/functest/src/emit.ts:152 | pollUntil sleeps pollIntervalSeconds after every fetch, including the last one before the deadline, and exits without a final fetch, so the observed window is timeoutSeconds minus up to one interval. | timeoutSeconds 30, pollIntervalSeconds 3 (the plans in this job): fetches happen at ~0,3,…,27 s; a record that lands at 28 s is never read, pollUntil returns undefined and the test fails 'never reflected taskId within 30s' against a correct, slightly slow consumer. | packages/functest/src/emit.ts:151-162 'while (Date.now() < deadline) { … await new Promise((resolve) => setTimeout(resolve, opts.pollIntervalSeconds * 1000)); } return undefined;' — no fetch after the loop; critic C-06 in adversarial-reports/1792676514926-j6neyt/report.json:321-333 describes the same window on the withheld CRE-R-24 file. Rule: R-117b (bounded wait). | — | CONFIRMED |
| F-07 | Minor | packages/functest/src/emit.ts:154 | pollUntil treats every non-ok read-back response as 'not found yet' and keeps polling, so an authentication or path error on the consumer endpoint is reported as a propagation timeout. | GET_READY_TOKEN expired (401) or the read-back path wrong (404): the loop burns the full timeoutSeconds, then fails with 'get-ready never reflected taskId within 30s' — indistinguishable from CDC never delivering — so a credential problem is triaged as a broken flow and the real cause is hidden. | packages/functest/src/emit.ts:153-159 'const res = await fetch(opts.url, …); if (res.ok) { … }' with no else branch and :187 the only failure message; contrast the conformance emitter which asserts res.ok with the status (packages/testgen/src/emit.ts:47). Rule: R-117b. | — | CONFIRMED |
| F-08 | Minor | packages/functest/src/ground.ts:127 | When none of several referenced entities is groundable, ground() falls back to referenced[0] — the alphabetically-first mention — so the recorded skip reason can name an incidental single-source entity instead of the requirement's cross-service subject. | A requirement that mentions both ResultPackage (two sources, unmapped) and CdcEnvelope (one source) is skipped as "single-service entity 'CdcEnvelope' (no cross-service counterpart)" although the entity it is about is ResultPackage and the R-121 reason that applies is "no API mapping for entity 'ResultPackage'"; a reader triaging skips by reason is sent to the wrong entity and the wrong fix (declare a flow vs add an API mapping). | packages/functest/src/ground.ts:113 entities sorted, :121-127 'const entity = groundable ?? referenced[0];' after the groundable find() fails; the doc comment at :99-102 says grounding 'picks the referenced entity with an API mapping' and :121-122 'report the most specific reason', which the fallback does not do. Rule: R-121. | — | CONFIRMED |
| F-09 | Minor | packages/testgen/src/emit.ts:44 | Both emitters concatenate the base-URL env var and the mapped path with no slash normalisation. | GET_READY_API_URL set to 'https://host/' (a trailing slash is how many deployments publish a base URL) produces 'https://host//api/grdy/assignments/getTasks'; a server or gateway that does not collapse double slashes returns 404, expect(res.ok) is red (conformance) or the read-back polls to timeout (functional), against a correct system. | packages/testgen/src/emit.ts:44 'fetch(`${baseUrl}${t.target.path}`' (rendered at generated-tests/conformance/get-ready.TaskPublished.generated.test.ts:81); packages/functest/src/emit.ts:170 '`${publisherBase}` + "<path>"' and :179 'url: `${consumerBase}` + "<path>"'. Rule: R-83a / R-117b (env-var-sourced base URL). | — | CONFIRMED |
| F-10 | Minor | packages/testgen/src/generate.ts:115 | The conformance file path conformance/<source>.<entity>.generated.test.ts is keyed by {source, entity} while manifest entries are one per contract, so two valid contracts in one source whose schema[0].name is the same mapped entity yield two manifest entries and a single file. | Source S has contracts A and B both with schema[0].name = E, and API_MAP[S][E] exists: the manifest lists two conformance tests (#i and #j), files[] carries two entries with the same path, writeArtifactTree writes both and the second overwrites the first; the tree holds one file whose header names only test #j, and the manifest's test #i has no file — the manifest is no longer the source of truth for what is on disk (R-86/R-87) and the orphan is invisible to a runner. | packages/testgen/src/generate.ts:38-62 (one conformance entry per catalog contract), :112-118 (path from source+entity only, no dedupe), scripts/generate-tests.ts:131-136 (sequential writeFileSync). Rules: R-86, R-87, R-92. | — | CONFIRMED |

## Citations not verified
References in the findings and decision items that point at nothing (no such file, a line past the end, an undefined rule id, text found nowhere in the repo). This list does not change the verdict; check each against the code before relying on its finding.
None.

## Expected behaviours not covered
| Behaviour (Pass 1) | Quote | Covered by |
|---|---|---|
| X-75 | `jira-awp/BAWP-1551` and `jira-awp/BAWP-2486` come from a source that `SOURCES` does not define; any plan or skip for them must trace to a requirement actually in the catalog from a configured source, otherwise its skip reason/plan is unverified provenance. | nothing — no test, generator check or manifest field verifies a requirement's source against SOURCES (packages/core/src/sources.ts:19-21 defines only 'awp-app-plane'); the two entries sit at generated-tests/functional/manifest.json:672-679 with reason 'references no cataloged entity'. See needsDecision. |
| X-79 | Re-running on the same catalog yields byte-identical manifests and files: no timestamps, run ids, job ids or random values anywhere under `generated-tests/**`. | not confirmable in this run — no check exercises a re-run; the code is designed for it (packages/testgen/src/generate.ts:102-118, packages/functest/src/generate.ts:153-165) and no timestamp/run id appears in the tree, but git status shows all five generated files and both manifests modified against HEAD while the catalog hashes equal the previous run's snapshot, and git diff is outside this agent's shell allowlist. See needsDecision. |
| X-96 | The §3.11 job operates only on cataloged requirements and contracts; a requirement id from a source not in `SOURCES` cannot legitimately enter the manifest. | nothing — generateFunctionalPlans (packages/functest/src/generate.ts:112-119) takes whatever RequirementInput[] the caller supplies and never checks req.source against SOURCES, and the committed manifest carries two 'jira-awp/…' ids (generated-tests/functional/manifest.json:672-679). |

## Expected behaviours covered
| Behaviour (Pass 1) | Checked by |
|---|---|
| X-01 | generated-tests/manifest.json:6-8 (sole conformance entry); generated-tests/manifest.json:530-574 (Grep '"kind": "conformance"' → 10 = 1 test + 9 skips); Glob generated-tests/** → one conformance file |
| X-02 | generated-tests/conformance/get-ready.TaskPublished.generated.test.ts:7-8,81-83 |
| X-03 | generated-tests/conformance/get-ready.TaskPublished.generated.test.ts:66-75 |
| X-04 | generated-tests/conformance/get-ready.TaskPublished.generated.test.ts:87 |
| X-05 | generated-tests/conformance/get-ready.TaskPublished.generated.test.ts:88-92 |
| X-06 | generated-tests/conformance/get-ready.TaskPublished.generated.test.ts:9,78 |
| X-07 | packages/testgen/src/derive-schema.ts:108-112 (the get-ready TaskPublished object declares no nested properties, live fixture packages/adversary/tests/__fixtures__/calibration/live-20261009/get-ready.assignments-api.odcs.yaml:51-122, so the embedded schema correctly has none) |
| X-08 | generated-tests/conformance/get-ready.TaskPublished.generated.test.ts:46-49 (format uuid), :36-39 (minItems 1); packages/testgen/src/derive-schema.ts:72-95 |
| X-09 | generated-tests/conformance/get-ready.TaskPublished.generated.test.ts:21-32,40-45 (string\|null, integer\|null, array\|null) and :13-19,33-35,46-62 (required properties carry no null) |
| X-10 | generated-tests/conformance/get-ready.TaskPublished.generated.test.ts:64 |
| X-11 | generated-tests/conformance/get-ready.TaskPublished.generated.test.ts:36-39 (items has no item schema); packages/core/src/schema-model.ts:130-137 |
| X-12 | generated-tests/manifest.json:9-17 |
| X-13 | generated-tests/manifest.json:530-534 |
| X-14 | generated-tests/manifest.json:400-411; packages/core/src/api-map.ts:70; packages/testgen/src/generate.ts:73-79 |
| X-15 | generated-tests/compat/TaskPublished.generated.test.ts:118 |
| X-16 | generated-tests/compat/TaskPublished.generated.test.ts:121 |
| X-17 | generated-tests/compat/TaskPublished.generated.test.ts:120 |
| X-18 | generated-tests/compat/TaskPublished.generated.test.ts:115 (iterates consumerRequired only) |
| X-19 | packages/core/src/schema-model.ts:72-79; packages/testgen/src/compat.ts:52-53 |
| X-20 | generated-tests/manifest.json:397-517 (no fieldMap key); packages/testgen/src/generate.ts:98 |
| X-21 | generated-tests/manifest.json:403,409 |
| X-22 | generated-tests/manifest.json:413-434 (five consumerRequired entries) |
| X-23 | generated-tests/compat/TaskPublished.generated.test.ts:5-112 (single vitest import, embedded lists, no process.env) |
| X-24 | adversarial-reports/1792676477717-l7axmi/report.json:60-65 (TaskPublished 17/17 killed, executed tier); packages/adversary/src/mutate-testgen.ts:127-137 |
| X-25 | adversarial-reports/1792676477717-l7axmi/report.json:60-65; packages/adversary/src/mutate-testgen.ts:138-148 |
| X-26 | adversarial-reports/1792676477717-l7axmi/report.json:60-65; packages/adversary/src/mutate-testgen.ts:149-159 |
| X-27 | adversarial-reports/1792676477717-l7axmi/report.json:60-65; packages/adversary/src/mutate-testgen.ts:161-171 |
| X-28 | adversarial-reports/1792676477717-l7axmi/report.json:60-65; packages/adversary/src/mutate-testgen.ts:172-182 |
| X-29 | generated-tests/manifest.json:78,84 |
| X-30 | generated-tests/compat/ClassAssignment.generated.test.ts:94-97 |
| X-31 | generated-tests/manifest.json:80,86,89 (no fieldMap key in :75-170) |
| X-32 | generated-tests/manifest.json:535-539,545-549 |
| X-33 | generated-tests/manifest.json:175,181 |
| X-34 | generated-tests/compat/ResultPackage.generated.test.ts:103-109 |
| X-35 | generated-tests/manifest.json:177,183 |
| X-36 | generated-tests/manifest.json:540-544,565-569 |
| X-37 | generated-tests/manifest.json:284,290 (score is publisher here, consumer at :181) |
| X-38 | generated-tests/compat/StudentTaskScoredEvent.generated.test.ts:114-117 |
| X-39 | generated-tests/manifest.json:286,292 |
| X-40 | generated-tests/manifest.json:560-564,570-574 |
| X-41 | generated-tests/manifest.json:520-524 ('single-source (onboard only)') |
| X-42 | generated-tests/manifest.json:525-529 ('single-source (get-ready only)') |
| X-43 | generated-tests/manifest.json:550-559 |
| X-44 | generated-tests/manifest.json:550-554 |
| X-45 | generated-tests/manifest.json:553 ("no API mapping for entity 'SessionEventDetail'") |
| X-46 | generated-tests/manifest.json:555-559 and :520-524 (CdcEnvelope single-source, so never a compat variant) |
| X-47 | scripts/generate-tests.ts:123-124,219 (rmSync before write); Glob generated-tests/** → exactly 5 *.generated.test.ts, none for the skipped contracts |
| X-48 | packages/testgen/src/generate.ts:39-41,80-87 (neither skipped contract is 'validation: invalid' — their reasons at generated-tests/manifest.json:553,558 are no-mapping) |
| X-49 | generated-tests/functional/manifest.json:6-7 — Grep '"requirement": "awp-app-plane/' → 166 and '"requirement": "jira-awp/' → 2 (168, all canonical), plans [] so none is in both |
| X-50 | generated-tests/functional/manifest.json:7-680 — Grep '"reason": "references no cataloged entity"' → 159, '"reason": "no API mapping for entity' → 7, '"reason": "adversarial:' → 2 (sum 168; no other reason text) |
| X-51 | generated-tests/functional/manifest.json:6 (plans []), :109-119,149-151,561-563,661-667 (ClassAssignment/ResultPackage/StudentTaskScoredEvent → no API mapping) |
| X-52 | packages/functest/src/plan.ts:307-312 |
| X-53 | packages/functest/src/plan.ts:338-341,349 |
| X-54 | packages/adversary/src/grounding.ts:124-151 (A-07 at adversarial-reports/1792676514926-j6neyt/report.json:140-142 shows it firing) |
| X-55 | packages/functest/src/plan.ts:82,257-260 |
| X-56 | packages/functest/src/plan.ts:262-265; packages/functest/src/emit.ts:184-185 |
| X-57 | packages/functest/src/emit.ts:157 |
| X-58 | packages/functest/src/emit.ts:136-139,156 |
| X-59 | packages/adversary/src/grounding.ts:50-63,82-106 (A-11 at adversarial-reports/1792676514926-j6neyt/report.json:196-198 shows it firing on get-ready 'schemaVersion') |
| X-60 | packages/adversary/src/vacuity.ts:116-127 |
| X-61 | packages/functest/src/plan.ts:253-255; packages/functest/src/emit.ts:178-189 |
| X-62 | packages/adversary/src/vacuity.ts:161-177 (A-09, A-10, A-13) |
| X-63 | packages/functest/src/plan.ts:234-236; packages/functest/src/emit.ts:52-54 |
| X-64 | packages/functest/src/emit.ts:62-68 |
| X-65 | packages/functest/src/emit.ts:129-133; packages/functest/src/plan.ts:247-249 |
| X-66 | packages/adversary/src/grounding.ts:154-164; packages/adversary/src/text.ts:52-62 (A-01…A-06) |
| X-67 | packages/adversary/src/vacuity.ts:142-158 |
| X-68 | packages/functest/src/emit.ts:175 |
| X-69 | packages/adversary/src/vacuity.ts:87-102; Grep 'it\.(todo\|skip)\(\|^\s*//\s*body\s*:' over generated-tests → 0 |
| X-70 | packages/adversary/src/grounding.ts:167-222; packages/functest/src/emit.ts:108-111 |
| X-71 | packages/functest/src/generate.ts:162,168-172; packages/functest/src/emit.ts:104 |
| X-72 | packages/adversary/src/mutate-functest.ts:51-54,77-87; adversarial-reports/1792676514926-j6neyt/report.json:503-520 (both plans 0.9375, M-noprop killed) |
| X-73 | generated-tests/functional/manifest.json:6,101-103,669-671,688-692 — Grep '"withheld": true' → 13, '"file":' → 0 |
| X-74 | generated-tests/manifest.json:576-578; generated-tests/functional/manifest.json:681 — Grep '"C-\d\d"\|"id": "C-' over generated-tests → 0 |
| X-76 | packages/functest/src/generate.ts:128-131 (re-stamp on cache hit), :168-172 (slug from requirementIds[0]); not exercised here because both jira ids are skipped (generated-tests/functional/manifest.json:672-679) |
| X-77 | packages/functest/src/ground.ts:160-174 |
| X-78 | packages/adversary/src/grounding.ts:225-233 (Major); packages/adversary/src/review.ts:194-196 (only Critical withholds) |
| X-80 | packages/core/src/compare.ts:12-39; packages/testgen/src/generate.ts:104-106; packages/functest/src/generate.ts:112,153-154; packages/testgen/src/derive-schema.ts:54 |
| X-81 | packages/core/src/api-map.ts:87-97; packages/testgen/src/generate.ts:73-77 |
| X-82 | packages/testgen/src/compat.ts:68-71; generated-tests/compat/TaskPublished.generated.test.ts:115-121 |
| X-83 | packages/functest/src/plan.ts:342-347 |
| X-84 | packages/testgen/src/generate.ts:39-51,69-87; packages/functest/src/generate.ts:117-119,143-146 |
| X-85 | packages/testgen/src/emit.ts:12,18-19,74-77; packages/functest/src/emit.ts:17-18,104 |
| X-86 | packages/testgen/src/generate.ts:115-116; packages/functest/src/generate.ts:162; scripts/generate-tests.ts:123-124,219 |
| X-87 | vitest.config.ts:13 |
| X-88 | package.json:28-29 |
| X-89 | packages/functest/src/generate.ts:128; packages/functest/src/plan.ts:31 |
| X-90 | packages/functest/src/plan.ts:204-209,221,225-230; packages/functest/src/emit.ts:116-118,170,179 |
| X-91 | packages/core/src/schema-model.ts:76-79,130-137; packages/testgen/src/derive-schema.ts:110-111 |
| X-92 | packages/functest/src/plan.ts:99-112,359-367 |
| X-93 | packages/adversary/src/review.ts:83-119 (no withhold path for testgen); packages/adversary/src/mutate-testgen.ts:237-250 |
| X-94 | packages/functest/src/ground.ts:146-151 |
| X-95 | packages/testgen/src/compat.ts:36-45,69-70; packages/testgen/src/emit.ts:69-73; generated-tests/manifest.json (no fieldMap key on any compat entry, :75-517) |

## Discarded embedded instructions
- None found: no spec, contract, generated file, manifest or report read in this pass contained text attempting to direct the reviewer.
