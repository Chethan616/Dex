export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

class Logger {
  private level: LogLevel = LogLevel.INFO;

  constructor() {
    if (process.env.DEX_LOG_LEVEL) {
      const envLevel = process.env.DEX_LOG_LEVEL.toUpperCase();
      if (envLevel in LogLevel) {
        this.level = LogLevel[envLevel as keyof typeof LogLevel];
      }
    }
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  private formatMessage(levelStr: string, moduleName: string, message: string, ...args: any[]): string {
    const timestamp = new Date().toISOString();
    let formatted = `[${timestamp}] [${levelStr}] [${moduleName}] ${message}`;
    if (args.length > 0) {
      formatted += ' ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
    }
    return formatted;
  }

  debug(moduleName: string, message: string, ...args: any[]): void {
    if (this.level <= LogLevel.DEBUG) {
      console.debug(this.formatMessage('DEBUG', moduleName, message, ...args));
    }
  }

  info(moduleName: string, message: string, ...args: any[]): void {
    if (this.level <= LogLevel.INFO) {
      console.info(this.formatMessage('INFO ', moduleName, message, ...args));
    }
  }

  warn(moduleName: string, message: string, ...args: any[]): void {
    if (this.level <= LogLevel.WARN) {
      console.warn(this.formatMessage('WARN ', moduleName, message, ...args));
    }
  }

  error(moduleName: string, message: string, ...args: any[]): void {
    if (this.level <= LogLevel.ERROR) {
      console.error(this.formatMessage('ERROR', moduleName, message, ...args));
    }
  }
}

export const logger = new Logger();
