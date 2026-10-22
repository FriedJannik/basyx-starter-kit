export type ClientArchitecture = 'amd64' | 'arm64' | 'unknown';

interface ArchitectureNavigator {
  userAgent?: string;
  platform?: string;
  userAgentData?: {
    getHighEntropyValues: (hints: string[]) => Promise<{ architecture?: string; bitness?: string }>;
  };
}

export async function detectClientArchitecture(
  client: ArchitectureNavigator | undefined = typeof navigator === 'undefined'
    ? undefined
    : navigator
): Promise<ClientArchitecture> {
  if (!client) return 'unknown';
  try {
    const hints = await client.userAgentData?.getHighEntropyValues(['architecture', 'bitness']);
    const arch = hints?.architecture?.toLowerCase();
    if (arch === 'arm64' || arch === 'aarch64' || (arch === 'arm' && hints?.bitness === '64'))
      return 'arm64';
    if (arch === 'x86_64' || arch === 'amd64' || (arch === 'x86' && hints?.bitness === '64'))
      return 'amd64';
  } catch {
    // Client hints can be unavailable or blocked by browser permissions policy.
  }
  const identity = `${client.userAgent || ''} ${client.platform || ''}`;
  if (/\b(arm64|aarch64|armv8\w*)\b/i.test(identity)) return 'arm64';
  if (/\b(x86_64|amd64|x64|win64)\b/i.test(identity)) return 'amd64';
  // MacIntel is also reported by Apple Silicon browsers; leave ambiguous clients unknown.
  return 'unknown';
}
