import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { vi } from 'vitest';
import { defineComponent, nextTick } from 'vue';
import DockerConfig from '@/components/DockerConfig.vue';
import { useAppStore } from '@/stores/app';

const ComboboxStub = defineComponent({
  name: 'ComboboxStub',
  props: {
    modelValue: {
      type: String,
      default: '',
    },
  },
  emits: ['update:modelValue'],
  template:
    '<button class="tag-update" @click="$emit(\'update:modelValue\', \'1.0.0-rc.2\')">{{ modelValue }}</button>',
});

const TextFieldStub = defineComponent({
  name: 'TextFieldStub',
  props: {
    label: {
      type: String,
      default: '',
    },
  },
  emits: ['update:modelValue'],
  template:
    "<button class=\"text-field-update\" :data-label=\"label\" @click=\"$emit('update:modelValue', label === 'BASE_PATH' ? 'basyx-ui/' : 'api/aas/')\">{{ label }}</button>",
});

const NumberInputStub = defineComponent({
  name: 'NumberInputStub',
  emits: ['update:modelValue'],
  template:
    '<button class="number-input-update" @click="$emit(\'update:modelValue\', 9090)">port</button>',
});

const DisplayNumberInputStub = defineComponent({
  name: 'DisplayNumberInputStub',
  props: {
    modelValue: {
      type: Number,
      default: undefined,
    },
  },
  template: '<input class="external-port" :value="modelValue" />',
});

const DisplayTextFieldStub = defineComponent({
  name: 'DisplayTextFieldStub',
  props: {
    modelValue: {
      type: String,
      default: undefined,
    },
  },
  template: '<input class="container-name" :value="modelValue" />',
});

function flushPromises(): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, 0);
  });
}

describe('DockerConfig', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ tags: ['latest', '1.0.0-rc.2'] }),
      }))
    );
  });

  it('syncs only the tag between AAS Environment and Configuration Service images', async () => {
    const store = useAppStore();
    store.initializeStarterDefaults();

    const wrapper = mount(DockerConfig, {
      props: {
        serviceName: 'aas-environment',
      },
      global: {
        stubs: {
          'v-slide-y-transition': { template: '<div><slot /></div>' },
          'v-combobox': ComboboxStub,
          'v-list-item': { template: '<div><slot name="append" /></div>' },
          'v-chip': { template: '<span><slot /></span>' },
          'v-divider': { template: '<hr />' },
          'v-number-input': { template: '<input />' },
          'v-text-field': { template: '<input />' },
        },
      },
    });

    await flushPromises();
    await nextTick();
    await wrapper.find('button.tag-update').trigger('click');
    await nextTick();

    const compose = store.getDockerComposeConfig?.value as {
      services: Record<string, { image?: string }>;
    };

    expect(compose.services['aas-environment']?.image).toBe(
      'eclipsebasyx/aasenvironment-go:1.0.0-rc.2'
    );
    expect(compose.services.basyx_configuration?.image).toBe(
      'eclipsebasyx/basyxconfigurationservice-go:1.0.0-rc.2'
    );
  });

  it('updates the AAS Environment tag when the Configuration Service tag changes', async () => {
    const store = useAppStore();
    store.initializeStarterDefaults();
    const wrapper = mount(DockerConfig, {
      props: { serviceName: 'basyx_configuration' },
      global: {
        stubs: {
          'v-slide-y-transition': { template: '<div><slot /></div>' },
          'v-combobox': ComboboxStub,
          'v-list-item': { template: '<div><slot name="append" /></div>' },
          'v-chip': { template: '<span><slot /></span>' },
          'v-divider': { template: '<hr />' },
          'v-text-field': { template: '<input />' },
        },
      },
    });

    await flushPromises();
    await wrapper.find('button.tag-update').trigger('click');
    const services = (
      store.getDockerComposeConfig?.value as {
        services: Record<string, { image?: string }>;
      }
    ).services;
    expect(services.basyx_configuration?.image).toBe(
      'eclipsebasyx/basyxconfigurationservice-go:1.0.0-rc.2'
    );
    expect(services['aas-environment']?.image).toBe('eclipsebasyx/aasenvironment-go:1.0.0-rc.2');
  });

  it('persists the AAS Environment context path and reapplies generated external URLs', async () => {
    const store = useAppStore();
    store.initializeStarterDefaults();
    store.updateExternalBaseUrl('http://192.168.100.200:4000');

    const wrapper = mount(DockerConfig, {
      props: {
        serviceName: 'aas-environment',
      },
      global: {
        stubs: {
          'v-slide-y-transition': { template: '<div><slot /></div>' },
          'v-combobox': ComboboxStub,
          'v-list-item': { template: '<div><slot name="append" /></div>' },
          'v-chip': { template: '<span><slot /></span>' },
          'v-divider': { template: '<hr />' },
          'v-number-input': { template: '<input />' },
          'v-text-field': TextFieldStub,
        },
      },
    });

    await flushPromises();
    await nextTick();

    const contextPathButton = wrapper
      .findAll('.text-field-update')
      .find(button => button.attributes('data-label') === 'SERVER_CONTEXTPATH');

    expect(contextPathButton).toBeTruthy();
    await contextPathButton?.trigger('click');
    await nextTick();

    const compose = store.getDockerComposeConfig?.value as {
      services: Record<string, { environment?: string[] }>;
    };
    const environment = compose.services['aas-environment']?.environment || [];

    expect(store.getContextPath('aas-environment')).toBe('/api/aas');
    expect(store.getExternalBaseUrl).toBe('http://192.168.100.200:4000/api/aas');
    expect(environment).toContain('SERVER_CONTEXTPATH=/api/aas');
    expect(environment).toContain('GENERAL_EXTERNALURL=http://192.168.100.200:4000/api/aas');
  });

  it('normalizes the AAS Web UI base path in Docker config', async () => {
    const store = useAppStore();
    store.initializeStarterDefaults();

    const wrapper = mount(DockerConfig, {
      props: {
        serviceName: 'aas-ui',
      },
      global: {
        stubs: {
          'v-slide-y-transition': { template: '<div><slot /></div>' },
          'v-combobox': ComboboxStub,
          'v-list-item': { template: '<div><slot name="append" /></div>' },
          'v-chip': { template: '<span><slot /></span>' },
          'v-divider': { template: '<hr />' },
          'v-number-input': NumberInputStub,
          'v-text-field': TextFieldStub,
        },
      },
    });

    await flushPromises();
    await nextTick();

    const basePathButton = wrapper
      .findAll('.text-field-update')
      .find(button => button.attributes('data-label') === 'BASE_PATH');

    expect(basePathButton).toBeTruthy();
    await basePathButton?.trigger('click');
    await nextTick();

    const compose = store.getDockerComposeConfig?.value as {
      services: Record<string, { environment?: Record<string, string> }>;
    };
    const environment = compose.services['aas-ui']?.environment || {};

    expect(store.getContextPath('aas-ui')).toBe('/basyx-ui');
    expect(environment.BASE_PATH).toBe('/basyx-ui');
  });

  it('syncs an explicit External Base URL port when the AAS Environment port changes', async () => {
    const store = useAppStore();
    store.initializeStarterDefaults();
    store.updateExternalBaseUrl('http://192.168.100.200:4000');

    const wrapper = mount(DockerConfig, {
      props: {
        serviceName: 'aas-environment',
      },
      global: {
        stubs: {
          'v-slide-y-transition': { template: '<div><slot /></div>' },
          'v-combobox': ComboboxStub,
          'v-list-item': { template: '<div><slot name="append" /></div>' },
          'v-chip': { template: '<span><slot /></span>' },
          'v-divider': { template: '<hr />' },
          'v-number-input': NumberInputStub,
          'v-text-field': { template: '<input />' },
        },
      },
    });

    await flushPromises();
    await nextTick();
    await wrapper.find('.number-input-update').trigger('click');
    await nextTick();

    const compose = store.getDockerComposeConfig?.value as {
      services: Record<string, { ports?: string[]; environment?: string[] }>;
    };
    const aasEnvironment = compose.services['aas-environment'];
    const environment = aasEnvironment?.environment || [];

    expect(store.getExternalBaseUrl).toBe('http://192.168.100.200:9090');
    expect(store.getContainerPort('aas-environment')).toBe(9090);
    expect(aasEnvironment?.ports).toEqual(['9090:9090']);
    expect(environment).toContain('SERVER_PORT=9090');
    expect(environment).toContain('GENERAL_EXTERNALURL=http://192.168.100.200:9090');
  });

  it('derives third-party container defaults from the Compose service', async () => {
    const store = useAppStore();
    store.initializeStarterDefaults();
    store.setDockerComposeConfig({
      name: 'docker-compose.yaml',
      value: {
        services: {
          redis: {
            image: 'redis:8.2.2-alpine',
            ports: ['127.0.0.1:6379:6379'],
          },
        },
      },
    });

    const wrapper = mount(DockerConfig, {
      props: { serviceName: 'redis' },
      global: {
        stubs: {
          'v-slide-y-transition': { template: '<div><slot /></div>' },
          'v-combobox': ComboboxStub,
          'v-list-item': { template: '<div><slot name="append" /></div>' },
          'v-chip': { template: '<span><slot /></span>' },
          'v-divider': { template: '<hr />' },
          'v-number-input': DisplayNumberInputStub,
          'v-text-field': DisplayTextFieldStub,
        },
      },
    });

    await flushPromises();
    await nextTick();

    expect((wrapper.find('.external-port').element as HTMLInputElement).value).toBe('6379');
    expect((wrapper.find('.container-name').element as HTMLInputElement).value).toBe('redis');
  });
});
