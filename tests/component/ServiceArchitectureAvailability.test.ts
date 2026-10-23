import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdditionalServicesPage from '@/pages/get-started/deployment/additional-services.vue';
import { useAppStore } from '@/stores/app';
import {
  parseThirdPartyServiceCatalog,
  validateThirdPartyServices,
} from '@/utils/thirdPartyServices';

vi.stubGlobal('useSeoMeta', vi.fn());
vi.stubGlobal('navigateTo', vi.fn());

const catalog = `version: 1
services:
  - id: adapter
    name: Adapter
    description: AMD64 adapter
    unsupportedArchitectures:
      arm64: No ARM64 image is published.
    compose:
      adapter:
        image: example/adapter:1
  - id: portable
    name: Portable
    description: Multi-platform service
    compose:
      portable:
        image: example/portable:1
`;

function mountPage(): VueWrapper {
  const slot = { template: '<div><slot /></div>' };
  return mount(AdditionalServicesPage, {
    global: {
      stubs: {
        'v-container': slot,
        'v-alert': slot,
        'v-list': slot,
        'v-list-item': { template: '<article><slot /><slot name="append" /></article>' },
        'v-list-item-title': slot,
        'v-list-item-subtitle': slot,
        'v-btn-toggle': {
          emits: ['update:modelValue'],
          template:
            '<div><button data-arch="amd64" @click="$emit(\'update:modelValue\', \'amd64\')">AMD64</button><button data-arch="arm64" @click="$emit(\'update:modelValue\', \'arm64\')">ARM64</button></div>',
        },
        'v-btn': {
          props: ['disabled'],
          template: '<button :disabled="disabled"><slot /></button>',
        },
        'v-card-actions': slot,
        NuxtLink: slot,
      },
    },
  });
}

describe('service architecture availability', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    useAppStore().initializeStarterDefaults();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => catalog }));
  });

  it('moves unavailable services to the bottom and disables adding them on ARM64', async () => {
    useAppStore().thirdPartyArchitecture = 'arm64';
    const wrapper = mountPage();
    await flushPromises();
    const rows = wrapper.findAll('article');
    expect(rows[0]!.text()).toContain('Portable');
    expect(rows[1]!.text()).toContain('Unavailable on ARM64');
    expect(rows[1]!.text()).toContain('No ARM64 image is published.');
    expect(rows[1]!.find('button').element.disabled).toBe(true);
    await wrapper.find('[data-arch="amd64"]').trigger('click');
    expect(wrapper.findAll('article')[0]!.text()).toContain('Adapter');
    expect(wrapper.findAll('article')[0]!.find('button').element.disabled).toBe(false);
    expect(wrapper.text()).not.toContain('Unavailable on ARM64');
  });

  it('keeps selected settings but blocks continuing after switching to an unsupported architecture', async () => {
    useAppStore().thirdPartyArchitecture = 'amd64';
    const wrapper = mountPage();
    await flushPromises();
    await wrapper.findAll('article')[0]!.find('button').trigger('click');
    await wrapper.find('[data-arch="arm64"]').trigger('click');
    expect(useAppStore().getThirdPartyServices.map(service => service.id)).toContain('adapter');
    expect(
      wrapper.findAll('button').find(button => button.text() === 'Next')!.element.disabled
    ).toBe(true);
    const adapter = wrapper.findAll('article')[1]!;
    expect(adapter.find('button').text()).toBe('Remove');
    await adapter.find('button').trigger('click');
    expect(useAppStore().getThirdPartyServices).toEqual([]);
    expect(
      wrapper.findAll('button').find(button => button.text() === 'Next')!.element.disabled
    ).toBe(false);
  });

  it('restores unavailable selections with the same guard', async () => {
    const store = useAppStore();
    store.thirdPartyArchitecture = 'arm64';
    store.thirdPartyServices = [{ id: 'adapter', values: {} }];
    const wrapper = mountPage();
    await flushPromises();
    expect(
      wrapper.findAll('button').find(button => button.text() === 'Next')!.element.disabled
    ).toBe(true);
    expect(wrapper.text()).toContain('No ARM64 image is published.');
  });

  it('rejects incompatible selections during download validation', () => {
    const services = parseThirdPartyServiceCatalog(catalog);
    const selections = [{ id: 'adapter', values: {} }];
    const compose = { adapter: { image: 'example/adapter:1' } };
    expect(validateThirdPartyServices(services, selections, compose, 'arm64')).toContain(
      'Adapter: Unavailable on ARM64 — No ARM64 image is published.'
    );
    expect(validateThirdPartyServices(services, selections, compose, 'amd64')).toEqual([]);
  });

  it.each(['{ arm64: "" }', '{ sparc: Unsupported }', '[arm64]'])(
    'rejects malformed architecture availability: %s',
    metadata => {
      expect(() =>
        parseThirdPartyServiceCatalog(
          catalog.replace(
            'unsupportedArchitectures:\n      arm64: No ARM64 image is published.',
            `unsupportedArchitectures: ${metadata}`
          )
        )
      ).toThrow(/architecture/i);
    }
  );
});
