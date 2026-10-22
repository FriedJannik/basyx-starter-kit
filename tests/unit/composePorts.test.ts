import { describe, expect, it } from 'vitest';
import { useAppStore } from '@/stores/app';
import {
  findComposePortConflicts,
  publishedPort,
  replacePublishedPort,
} from '@/utils/composePorts';

describe('Compose host ports', () => {
  it.each([
    ['8080:80', '9090:80'],
    ['127.0.0.1:8080:80/tcp', '127.0.0.1:9090:80/tcp'],
    ['[::1]:8080:80/udp', '[::1]:9090:80/udp'],
  ])(
    'preserves the address, target and protocol in %s through both mutation paths',
    (mapping, expected) => {
      expect(replacePublishedPort(mapping, 9090)).toBe(expected);
      expect(publishedPort(mapping)).toBe(8080);
      const store = useAppStore();
      store.initializeStarterDefaults();
      const config = structuredClone(JSON.parse(JSON.stringify(store.getDockerComposeConfig)));
      config.value.services.worker = { ports: [mapping] };
      store.setDockerComposeConfig(config);
      store.setContainerPort('worker', 9090);
      expect(
        (store.getDockerComposeConfig!.value as typeof config.value).services.worker.ports
      ).toEqual([expected]);
    }
  );

  it('detects conflicting ranges and long syntax without flagging separate addresses or protocols', () => {
    expect(
      findComposePortConflicts({
        first: { ports: ['127.0.0.1:8080-8082:80-82/tcp'] },
        second: { ports: [{ target: 90, published: '8081', protocol: 'tcp' }] },
      })
    ).toHaveLength(1);
    expect(
      findComposePortConflicts({
        first: { ports: ['127.0.0.1:8080:80/tcp'] },
        second: { ports: ['127.0.0.1:8080:80/udp'] },
        third: { ports: ['127.0.0.2:8080:80/tcp'] },
      })
    ).toEqual([]);
    expect(findComposePortConflicts({ only: { ports: ['127.0.0.1:5080:8080'] } })).toEqual([]);
  });
});
