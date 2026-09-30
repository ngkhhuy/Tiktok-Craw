export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

function sanitizeMessage(msg: string): string {
  // Strip out sensitive patterns like cookies, tokens, long auth headers
  return msg
    .replace(/(cookie|authorization|token|key|secret)=[^&\s]+/gi, '$1=[REDACTED]')
    .replace(/ttwid=[^;\s&]+/gi, 'ttwid=[REDACTED]')
    .replace(/msToken=[^;\s&]+/gi, 'msToken=[REDACTED]');
}

export class Logger {
  private verbose: boolean = false;

  constructor(verbose: boolean = false) {
    this.verbose = verbose;
  }

  setVerbose(verbose: boolean): void {
    this.verbose = verbose;
  }

  stage(stageName: string, message: string): void {
    const timestamp = new Date().toISOString();
    console.log(`[${stageName.toUpperCase()}] ${sanitizeMessage(message)}`);
  }

  info(message: string): void {
    console.log(sanitizeMessage(message));
  }

  debug(message: string): void {
    if (this.verbose) {
      console.log(`[DEBUG] ${sanitizeMessage(message)}`);
    }
  }

  warn(message: string): void {
    console.warn(`[WARN] ${sanitizeMessage(message)}`);
  }

  error(message: string, err?: unknown): void {
    const errDetails = err instanceof Error ? `: ${err.message}` : '';
    console.error(`[ERROR] ${sanitizeMessage(message)}${errDetails}`);
  }

  videoProgress(videoId: string, stage: string, status: 'started' | 'success' | 'failed' | 'skipped' | 'unavailable', detail?: string): void {
    const mark = status === 'success' ? '✓' : status === 'skipped' ? '↷' : status === 'unavailable' ? '∅' : status === 'failed' ? '✗' : '→';
    const detailStr = detail ? ` (${detail})` : '';
    console.log(`  ${mark} ${stage}${detailStr}`);
  }
}

export const logger = new Logger();
