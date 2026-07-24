import { StackContext, Table, Bucket } from 'sst/constructs';
import { TableEncryption } from 'aws-cdk-lib/aws-dynamodb';
import { BlockPublicAccess, BucketEncryption, ObjectOwnership } from 'aws-cdk-lib/aws-s3';

/**
 * T-06 — Persistence for the registry (design §2).
 *
 *   R-40 — catalog metadata (entries, versions, crawl runs, lock) in DynamoDB.
 *   R-41 — raw ODCS documents (every version) in S3.
 *   R-42 — encrypted at rest; bucket blocks public access.
 *
 * Single-table design. Item kinds by key shape (design §2.1):
 *   entry        PK=SRC#{source}      SK=CON#{id}
 *   version      PK=VER#{source}#{id} SK=V#{000n}
 *   run          PK=RUN#{runId}       SK=RUN           (kind="CRAWL")
 *   generation   PK=GEN#{runId}       SK=GEN           (kind="GENERATION")
 *   requirement  PK=REQ#{source}      SK=R#{id}        (§3.10, R-106)
 *   lock         PK=LOCK              SK=CRAWL         (ttl attr, D-15)
 * GSIs: byEntity (entity → source) backs GET /entities/{entity};
 *       byKind   (kind → startedAt) backs GET /crawls (kind="CRAWL") and
 *                GET /test-artifacts (kind="GENERATION"), each newest-first.
 */
export function StorageStack({ stack }: StackContext) {
  const registry = new Table(stack, 'Registry', {
    fields: {
      PK: 'string',
      SK: 'string',
      entity: 'string',
      source: 'string',
      kind: 'string',
      startedAt: 'string',
    },
    primaryIndex: { partitionKey: 'PK', sortKey: 'SK' },
    globalIndexes: {
      byEntity: { partitionKey: 'entity', sortKey: 'source' },
      byKind: { partitionKey: 'kind', sortKey: 'startedAt' },
    },
    cdk: {
      table: {
        encryption: TableEncryption.AWS_MANAGED,
        timeToLiveAttribute: 'ttl',
      },
    },
  });

  // Raw ODCS documents, one object per cataloged version (R-41). Block ALL
  // public access and encrypt at rest (R-42).
  const contracts = new Bucket(stack, 'Contracts', {
    cors: false,
    cdk: {
      bucket: {
        blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
        encryption: BucketEncryption.S3_MANAGED,
        enforceSSL: true,
        objectOwnership: ObjectOwnership.BUCKET_OWNER_ENFORCED,
      },
    },
  });

  stack.addOutputs({
    RegistryTableName: registry.tableName,
    ContractsBucketName: contracts.bucketName,
  });

  return { registry, contracts };
}
