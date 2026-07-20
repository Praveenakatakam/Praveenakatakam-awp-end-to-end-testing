/**
 * Catalog metadata extraction (T-03 · R-22, D-12).
 *
 * Pulls the fields the registry catalogs from a parsed ODCS document. The
 * entity name is `schema[0].name`; if that is missing/empty it falls back to
 * the file's name stem (`enrollment.odcs.yaml` → `enrollment`) so every
 * discoverable file is catalogable even when its schema is malformed.
 */

export interface ContractMetadata {
  id: string;
  name?: string;
  /** The contract's declared `version` field (surfaced + drift-checked — D-16). */
  version?: string;
  apiVersion?: string;
  kind?: string;
  status?: string;
  domain?: string;
  dataProduct?: string;
  tags: string[];
  /** Primary grouping key: schema[0].name, else the filename stem (D-12). */
  entity: string;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/** Derive the entity name from schema[0].name, else the file's name stem. */
function resolveEntity(doc: Record<string, unknown>, filePath: string): string {
  const schema = doc.schema;
  if (Array.isArray(schema) && schema.length > 0) {
    const first = schema[0] as Record<string, unknown> | undefined;
    const name = str(first?.name);
    if (name) return name;
  }
  // Filename stem: strip directories and the ".odcs.yaml" / ".yaml" suffix.
  const base = filePath.split("/").pop() ?? filePath;
  return base.replace(/\.odcs\.ya?ml$/i, "").replace(/\.ya?ml$/i, "");
}

export function extractMetadata(parsed: unknown, filePath: string): ContractMetadata {
  const doc = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
  const tags = Array.isArray(doc.tags) ? (doc.tags as unknown[]).filter((t): t is string => typeof t === "string") : [];
  return {
    id: str(doc.id) ?? "",
    name: str(doc.name),
    version: str(doc.version),
    apiVersion: str(doc.apiVersion),
    kind: str(doc.kind),
    status: str(doc.status),
    domain: str(doc.domain),
    dataProduct: str(doc.dataProduct),
    tags,
    entity: resolveEntity(doc, filePath),
  };
}
