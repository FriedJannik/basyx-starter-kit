import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AdditionalServicesPage from '@/pages/get-started/deployment/additional-services.vue';
import { useAppStore } from '@/stores/app';

vi.stubGlobal('useSeoMeta', vi.fn());
vi.stubGlobal('navigateTo', vi.fn());

const catalog = `version: 1
services:
  - id: worker
    name: Worker
    description: Worker
    compose:
      worker:
        image: example/worker:{{ config.imageTag }}
        environment:
          SIGNING_SECRET: "{{ config.jwtSecret }}"
      cache:
        image: redis:8
    configuration:
      - key: imageTag
        label: Image version
        type: text
        default: '1.0'
        arm64Default: '1.0-arm64'
      - key: jwtSecret
        label: Signing secret
        type: password
        required: true
        minLength: 32
        generate: hex-32
`;

async function openPage(architecture?: string): Promise<ReturnType<typeof mount>> {
  vi.stubGlobal('useSeoMeta', vi.fn());
  vi.stubGlobal('navigateTo', vi.fn());
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => catalog }));
  vi.stubGlobal('navigator', {
    userAgent: 'Macintosh; Intel Mac OS X 10_15_7',
    userAgentData: architecture
      ? {
          getHighEntropyValues: vi.fn().mockResolvedValue({ architecture, bitness: '64' }),
        }
      : undefined,
  });
  const slots = { template: '<div><slot /><slot name="append" /></div>' };
  const wrapper = mount(AdditionalServicesPage, {
    global: {
      stubs: {
        NuxtLink: slots,
        'v-container': slots,
        'v-alert': slots,
        'v-list': slots,
        'v-list-item': slots,
        'v-list-item-title': slots,
        'v-list-item-subtitle': slots,
        'v-chip': slots,
        'v-expansion-panels': slots,
        'v-expansion-panel': slots,
        'v-expansion-panel-title': slots,
        'v-expansion-panel-text': slots,
        'v-card-actions': slots,
        'v-row': slots,
        'v-col': slots,
        'v-breadcrumbs': true,
        'v-switch': true,
        'v-select': true,
        'v-number-input': true,
        'v-list-subheader': true,
        'v-menu': true,
        'v-spacer': true,
        'v-text-field': true,
        'v-btn': { template: '<button><slot /></button>' },
        'v-btn-toggle': {
          props: ['modelValue'],
          emits: ['update:modelValue'],
          template: `<div data-architecture :data-selected="modelValue"><button value="amd64" @click="$emit('update:modelValue', 'amd64')">AMD64</button><button value="arm64" @click="$emit('update:modelValue', 'arm64')">ARM64</button></div>`,
        },
      },
    },
  });
  await flushPromises();
  return wrapper;
}

function images(): Record<string, { image: string }> {
  return (
    useAppStore().getDockerComposeConfig!.value as { services: Record<string, { image: string }> }
  ).services;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('third-party CPU architecture switch', () => {
  it('blocks progression on actual port conflicts and accepts a corrected binding', async () => {
    const store = useAppStore();
    store.initializeStarterDefaults();
    const wrapper = await openPage('arm');
    await wrapper
      .findAll('button')
      .find(button => button.text() === 'Add')!
      .trigger('click');
    await flushPromises();
    const config = JSON.parse(JSON.stringify(store.getDockerComposeConfig!));
    config.value.services.cache.ports = ['127.0.0.1:8082:80'];
    store.setDockerComposeConfig(config);
    await flushPromises();
    const next = wrapper.findAll('button').find(button => button.text().trim() === 'Next')!;
    expect(next.attributes('disabled')).toBeDefined();
    expect(wrapper.text()).toContain('host port 8082');
    store.setContainerPort('cache', 8089);
    await flushPromises();
    expect(next.attributes('disabled')).toBeUndefined();
    wrapper.unmount();
  });

  it('defaults to browser ARM64 and switches all catalogue defaults to AMD64', async () => {
    useAppStore().initializeStarterDefaults();
    const wrapper = await openPage('arm');
    expect(wrapper.find('[data-architecture]').attributes('data-selected')).toBe('arm64');
    await wrapper
      .findAll('button')
      .find(button => button.text() === 'Add')!
      .trigger('click');
    await flushPromises();
    expect(images().worker?.image).toBe('example/worker:1.0-arm64');
    expect(images().cache?.image).toBe('redis:8');
    const generatedSecret = useAppStore().getThirdPartyServices[0]!.values.jwtSecret;
    expect(generatedSecret).toMatch(/^[a-f0-9]{64}$/);
    expect(wrapper.text()).not.toContain('Signing secret');

    await wrapper.find('button[value="amd64"]').trigger('click');
    await flushPromises();
    expect(images().worker?.image).toBe('example/worker:1.0');
    expect(useAppStore().getThirdPartyServices[0]!.values.jwtSecret).toBe(generatedSecret);
    expect(useAppStore().thirdPartyArchitecture).toBe('amd64');
    expect(useAppStore().createSerializableSnapshot().thirdPartyArchitecture).toBe('amd64');
    wrapper.unmount();
  });

  it('restores a saved target architecture instead of changing it to the browser architecture', async () => {
    const store = useAppStore();
    store.initializeStarterDefaults();
    const snapshot = store.createSerializableSnapshot();
    snapshot.thirdPartyArchitecture = 'amd64';
    snapshot.thirdPartyServices = [{ id: 'worker', values: { imageTag: '1.0' } }];
    store.applySerializableSnapshot(snapshot);
    const wrapper = await openPage('arm');
    expect(wrapper.find('[data-architecture]').attributes('data-selected')).toBe('amd64');
    expect(images().worker?.image).toBe('example/worker:1.0');
    wrapper.unmount();
  });

  it('lets an unknown client choose ARM64 manually and preserves custom image tags', async () => {
    const store = useAppStore();
    store.initializeStarterDefaults();
    store.thirdPartyServices = [{ id: 'worker', values: { imageTag: 'custom-version' } }];
    const wrapper = await openPage();
    expect(wrapper.text()).toContain('Browser architecture unavailable');
    await wrapper.find('button[value="arm64"]').trigger('click');
    await flushPromises();
    expect(images().worker?.image).toBe('example/worker:custom-version');
    wrapper.unmount();
  });
});
