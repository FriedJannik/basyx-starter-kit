interface Binding {
  service: string;
  host: string;
  start: number;
  end: number;
  protocol: string;
}

function binding(mapping: unknown, service = ''): Binding | undefined {
  let host = '';
  let published: unknown;
  let protocol = 'tcp';
  if (typeof mapping === 'string') {
    const match = mapping.match(
      /^(?:(\[[^\]]+\]|[^:]+):)?(\d+(?:-\d+)?):(\d+(?:-\d+)?)(?:\/(tcp|udp|sctp))?$/
    );
    if (!match) return undefined;
    host = match[1] || '';
    published = match[2];
    protocol = match[4] || 'tcp';
  } else if (mapping && typeof mapping === 'object') {
    const value = mapping as Record<string, unknown>;
    host = typeof value.host_ip === 'string' ? value.host_ip : '';
    published = value.published;
    protocol = typeof value.protocol === 'string' ? value.protocol : 'tcp';
  }
  const range = String(published ?? '').match(/^(\d+)(?:-(\d+))?$/);
  if (!range) return undefined;
  const start = Number(range[1]);
  const end = Number(range[2] || range[1]);
  if (start < 1 || end > 65535 || end < start) return undefined;
  return { service, host: host.replace(/^\[|\]$/g, '').toLowerCase(), start, end, protocol };
}

export function publishedPort(mapping: unknown): number | undefined {
  return binding(mapping)?.start;
}

export function replacePublishedPort(mapping: string, port: number): string {
  const parts = mapping.split(':');
  if (parts.length < 2) return `${port}:${mapping}`;
  parts[parts.length - 2] = String(port);
  return parts.join(':');
}

function overlappingHosts(first: string, second: string): boolean {
  if (!first || !second || first === second) return true;
  if (first === '0.0.0.0') return !second.includes(':');
  if (second === '0.0.0.0') return !first.includes(':');
  if (first === '::') return second.includes(':');
  if (second === '::') return first.includes(':');
  return false;
}

export function findComposePortConflicts(services: Record<string, unknown>): string[] {
  const bindings = Object.entries(services).flatMap(([service, value]) => {
    const ports = value && typeof value === 'object' && 'ports' in value ? value.ports : undefined;
    return (Array.isArray(ports) ? ports : [])
      .map(mapping => binding(mapping, service))
      .filter((value): value is Binding => Boolean(value));
  });
  const errors = new Set<string>();
  bindings.forEach((first, index) => {
    bindings.slice(index + 1).forEach(second => {
      if (
        first.protocol === second.protocol &&
        first.start <= second.end &&
        second.start <= first.end &&
        overlappingHosts(first.host, second.host)
      )
        errors.add(
          `${first.service} and ${second.service} conflict on host port ${Math.max(first.start, second.start)}/${first.protocol}.`
        );
    });
  });
  return [...errors];
}
