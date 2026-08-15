import { DexRequest } from './events/types';

export interface OwnerConfig {
  whatsapp?: string | null;
  telegram_id?: number | null;
  discord_id?: string | null;
  slack_user_id?: string | null;
}

export class OwnerGate {
  constructor(private config: OwnerConfig) {}

  verify(request: DexRequest): boolean {
    switch (request.source) {
      case 'cli':
        return true;
      case 'flutter':
        return true; // loopback-only — enforced at connection level
      case 'telegram':
        return this.config.telegram_id != null &&
          request.senderId === String(this.config.telegram_id);
      case 'discord':
        return this.config.discord_id != null &&
          request.senderId === this.config.discord_id;
      case 'whatsapp':
        return this.config.whatsapp != null &&
          request.senderId === this.config.whatsapp;
      case 'slack':
        return this.config.slack_user_id != null &&
          request.senderId === this.config.slack_user_id;
      default:
        return false;
    }
  }
}
