import { describe, it, expect } from 'vitest';
import { PROJECT } from '../src/index.js';

// T-01 harness smoke test: proves the offline vitest suite runs.
describe('core scaffold', () => {
  it('pins the ODCS version and the four OneRoster entities', () => {
    expect(PROJECT.odcsVersion).toBe('v3.1.0');
    expect(PROJECT.oneRosterEntities).toEqual(['org', 'user', 'class', 'enrollment']);
  });
});
