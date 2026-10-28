export function isValidPromptVersion(s: string): boolean {
  return /^[a-z0-9\-_.]{1,64}$/.test(s);
}

export type ExperimentStatus = 'pending' | 'running' | 'succeeded' | 'failed';

export interface PromptVersionRecord {
  promptVersion: string;
  text: string;
  modelId: string;
  createdAt: string;
  startedAt: string;
  createdBy: string;
  notes?: string;
}

export interface ExperimentRecord {
  experimentId: string;
  kind: 'EXPERIMENT';
  status: ExperimentStatus;
  promptVersion: string;
  createdAt: string;
  startedAt: string;
  createdBy: string;
  planCount?: number;
  skipCount?: number;
  skips?: string[];
  artifactKey?: string;
  error?: string;
}
