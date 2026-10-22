import { describe, expect, it, vi } from 'vitest';
import { detectClientArchitecture } from '@/utils/clientArchitecture';

describe('client architecture detection', () => {
  it.each([
    ['arm', '64', 'arm64'],
    ['arm64', '', 'arm64'],
    ['x86', '64', 'amd64'],
    ['arm', '32', 'unknown'],
    ['x86', '32', 'unknown'],
    ['', '', 'unknown'],
  ])('uses client hints %s/%s as %s', async (architecture, bitness, expected) => {
    const getHighEntropyValues = vi.fn().mockResolvedValue({ architecture, bitness });
    expect(
      await detectClientArchitecture({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        platform: 'MacIntel',
        userAgentData: { getHighEntropyValues },
      })
    ).toBe(expected);
    expect(getHighEntropyValues).toHaveBeenCalledWith(['architecture', 'bitness']);
  });

  it('falls back to explicit ARM64 identifiers if client hints are unavailable or denied', async () => {
    expect(
      await detectClientArchitecture({ userAgent: 'Linux aarch64', platform: 'Linux aarch64' })
    ).toBe('arm64');
    expect(
      await detectClientArchitecture({
        userAgent: 'Linux arm64',
        userAgentData: { getHighEntropyValues: vi.fn().mockRejectedValue(new Error('denied')) },
      })
    ).toBe('arm64');
    expect(await detectClientArchitecture({ userAgent: 'Linux x86_64' })).toBe('amd64');
  });

  it('does not guess ARM64 or AMD64 from ambiguous Mac identifiers', async () => {
    expect(
      await detectClientArchitecture({
        userAgent: 'Macintosh; Intel Mac OS X 10_15_7',
        platform: 'MacIntel',
      })
    ).toBe('unknown');
    expect(await detectClientArchitecture({})).toBe('unknown');
  });
});
