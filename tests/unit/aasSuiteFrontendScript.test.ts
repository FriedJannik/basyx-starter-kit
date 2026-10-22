import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const script = readFileSync('assets/aas-suite/frontend-start.sh', 'utf8');

describe('AAS Suite frontend URL encoding', () => {
  it.each([
    'https://example.test',
    'https://example.test/${globalThis.injected=true}/`',
    'https://example.test/";globalThis.injected=true;//',
    "https://example.test/';globalThis.injected=true;//",
    'https://example.test/\\x\nline\r\tend\n',
  ])('keeps %j as data in runtime and bundled JavaScript', value => {
    const root = mkdtempSync(join(tmpdir(), 'aas-frontend-'));
    try {
      const bin = join(root, 'bin');
      mkdirSync(bin);
      writeFileSync(join(bin, 'caddy'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
      if (process.platform === 'darwin')
        writeFileSync(
          join(bin, 'sed'),
          '#!/bin/sh\nif [ "$1" = -i ]; then shift; exec /usr/bin/sed -i "" "$@"; fi\nexec /usr/bin/sed "$@"\n',
          { mode: 0o755 }
        );
      writeFileSync(
        join(root, 'bundle.js'),
        `window.api="http://localhost:5196/designer-api"; window.gateway='http://localhost:5196'; window.template=\`http://localhost:5196\`;`
      );
      execFileSync('/bin/sh', ['-s'], {
        input: script
          .replace('ROOT_DIR="/usr/share/caddy"', 'ROOT_DIR="$TEST_ROOT"')
          .replace('cat >/tmp/Caddyfile', 'cat >"$TEST_ROOT/Caddyfile"'),
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          TEST_ROOT: root,
          FRONTEND_API_BASE_URL: `${value}/designer-api`,
          FRONTEND_FEEDMAPPING_BASE_URL: value,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const context = { window: {} as Record<string, string>, injected: false };
      runInNewContext(readFileSync(join(root, 'runtime-config.js'), 'utf8'), context);
      expect(context.window.__AAS_FRONTEND_API_BASE_URL).toBe(`${value}/designer-api`);
      expect(context.window.__AAS_FRONTEND_FEEDMAPPING_BASE_URL).toBe(value.replace(/\/$/, ''));
      runInNewContext(readFileSync(join(root, 'bundle.js'), 'utf8'), context);
      expect(context.window.api).toBe(`${value}/designer-api`);
      expect(context.window.gateway).toBe(value);
      expect(context.window.template).toBe(value);
      expect(context.injected).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
