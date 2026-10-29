/**
 * Adversarial runs API handlers (T-AR-02 · R-8, R-9, R-35).
 *
 * GET /adversarial-runs?kind={test|code}
 *   List runs for the given kind, newest first, capped at 100 (R-35).
 * GET /adversarial-runs/{kind}/{run_dir}/findings
 *   Fetch findings for one run from S3; SHA-256 integrity check against DynamoDB.
 *
 * Env vars ADVERSARIAL_TABLE and ADVERSARIAL_BUCKET are set by the SST wiring
 * (T-AR-03). This Lambda opts out of defaults.function.bind (D-AR-9).
 */
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';
import { json, notFound } from './http.js';

const TABLE = process.env['ADVERSARIAL_TABLE']!;
const BUCKET = process.env['ADVERSARIAL_BUCKET']!;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3 = new S3Client({});

const KIND_ATTR: Record<string, string> = { test: 'ADVERSARIAL_TEST', code: 'ADVERSARIAL_CODE', requirements: 'ADVERSARIAL_REQUIREMENTS' };

/** GET /adversarial-runs?kind={test|code} (R-8, R-35). */
export async function listAdversarialRuns(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  const kind = event.queryStringParameters?.kind;
  const kindAttr = kind ? KIND_ATTR[kind] : undefined;
  if (!kindAttr) return json(400, { error: 'bad_request', message: 'kind query parameter must be test, code, or requirements' });

  const result = await ddb.send(
    new QueryCommand({
      TableName: TABLE,
      IndexName: 'byKind',
      KeyConditionExpression: 'kind = :k',
      ExpressionAttributeValues: { ':k': kindAttr },
      ScanIndexForward: false,
      Limit: 100,
    }),
  );

  const runs = (result.Items ?? []).map((item) => ({
    reviewKind: item['reviewKind'] as string,
    run_dir: item['SK'] as string,
    startedAt: item['startedAt'] as string,
    scope: item['scope'] as string,
    verdict: item['verdict'] as string,
    countCritical: item['countCritical'] as number,
    countMajor: item['countMajor'] as number,
    countMinor: item['countMinor'] as number,
    verificationStatus: (item['verificationStatus'] ?? 'not_run') as string,
  }));

  return json(200, runs);
}

/** GET /adversarial-runs/{kind}/{run_dir}/findings (R-9). */
export async function getAdversarialFindings(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  const { kind, run_dir } = event.pathParameters ?? {};
  const kindAttr = kind ? KIND_ATTR[kind] : undefined;
  if (!kindAttr || !run_dir) return notFound();

  // Fetch stored SHA-256 from DynamoDB first (cheap; guards against stale S3 reads)
  const dbResult = await ddb.send(
    new GetCommand({
      TableName: TABLE,
      Key: { PK: `ADV#${kindAttr}`, SK: run_dir },
    }),
  );
  if (!dbResult.Item) return notFound(`run ${run_dir} not found`);
  const storedSha = dbResult.Item['reviewSha256'] as string | undefined;

  // Read review.json from S3
  const s3Key = `adversarial-runs/${kind}/${run_dir}/review.json`;
  let reviewContent: string;
  try {
    const obj = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: s3Key }));
    reviewContent = await obj.Body!.transformToString();
  } catch {
    return notFound(`review.json for run ${run_dir} not found in S3`);
  }

  // SHA-256 integrity check (R-9 step 4)
  if (storedSha) {
    const actualSha = createHash('sha256').update(reviewContent).digest('hex');
    if (storedSha !== actualSha) {
      return json(409, { error: 'integrity_mismatch', message: 'review.json SHA-256 does not match stored value' });
    }
  }

  const review = JSON.parse(reviewContent) as {
    findings: unknown[];
    verification?: { status: string };
  };
  const verificationStatus = review.verification?.status ?? 'not_run';

  return json(200, { findings: review.findings, verificationStatus });
}

/** GET /adversarial-runs/{kind}/{run_dir}/metadata — efficient polling support. */
export async function getAdversarialRunMetadata(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyStructuredResultV2> {
  const { kind, run_dir } = event.pathParameters ?? {};
  const kindAttr = kind ? KIND_ATTR[kind] : undefined;
  if (!kindAttr || !run_dir) return notFound();

  // Fetch metadata from DynamoDB
  const dbResult = await ddb.send(
    new GetCommand({
      TableName: TABLE,
      Key: { PK: `ADV#${kindAttr}`, SK: run_dir },
    }),
  );
  if (!dbResult.Item) return notFound(`run ${run_dir} not found`);

  return json(200, {
    sha256: dbResult.Item['reviewSha256'] as string,
    updatedAt: dbResult.Item['startedAt'] as string,
    lastModified: new Date(dbResult.Item['startedAt'] as string).getTime(),
  });
}
