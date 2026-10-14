export interface HealthReport {
  status: 'ok' | 'degraded';
  service: string;
  version: string;
  time: string;
}

/** Build the payload served at /healthz. Pure so it is trivially testable. */
export function buildHealth(service: string, version: string, now: Date = new Date()): HealthReport {
  return { status: 'ok', service, version, time: now.toISOString() };
}
