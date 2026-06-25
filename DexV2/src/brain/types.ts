export type IntentKind = 'single-shot' | 'compound' | 'followup' | 'correction';

export interface TaskIntent {
  raw: string;
  normalized: string;
  kind: IntentKind;
  tier: number; // 0, 0.5, 1, 2
  subIntents?: TaskIntent[];
  references?: string[];
}

export interface DeterministicAction {
  tool: 'shell' | 'desktop' | 'browser' | 'msg';
  cmd?: string; // used for shell command line
  goal?: string; // used for desktop or browser automation goal
  app?: string;  // used for desktop app name
  app_hint?: string; // used for desktop app target
  label?: string; // optional human-friendly step label
  ch?: string;   // messaging channel
  to?: string;   // recipient address / identifier
  txt?: string;  // message content string
}

export type StepStatus = 'queued' | 'acting' | 'done' | 'failed';

export interface StepEvent {
  stepId: string;
  name: string;
  status: StepStatus;
  why?: string;
  error?: string;
  result?: string;
}
