import * as fs from 'fs';
import * as path from 'path';
import { VerificationResult } from '../events/types';

export interface EvidenceRecord {
  requestId: string;
  stepId: string;
  action: string;
  params: Record<string, unknown>;
  beforeState?: unknown;
  /** What the agent claimed, kept alongside what verification made of it. */
  agentResult?: { success: boolean; data?: unknown };
  verificationResult: VerificationResult;
  timestamp: number;
}

export class EvidenceStore {
  private dir: string;

  constructor(baseDir = 'data/evidence') {
    this.dir = path.resolve(baseDir);
    fs.mkdirSync(this.dir, { recursive: true });
  }

  async record(evidence: EvidenceRecord): Promise<void> {
    const filename = `${evidence.timestamp}_${evidence.requestId.slice(0, 8)}_${evidence.stepId}.json`;
    const filepath = path.join(this.dir, filename);
    fs.writeFileSync(filepath, JSON.stringify(evidence, null, 2), 'utf8');
  }
}
