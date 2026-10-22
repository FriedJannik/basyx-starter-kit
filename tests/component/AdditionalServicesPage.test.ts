import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick } from 'vue';
import AdditionalServicesPage from '@/pages/get-started/deployment/additional-services.vue';
import { useAppStore } from '@/stores/app';

vi.stubGlobal('useSeoMeta', vi.fn());
vi.stubGlobal('navigateTo', vi.fn());

const catalog = `version: 1
services:
  - id: redis
    name: Redis
    description: Cache
    tags: [cache]
    compose:
      redis:
        image: redis:8.2.2-alpine
`;

const referenceCatalog = `version: 1
services:
  - id: redis
    name: Redis
    description: Cache
    tags: [cache]
    compose:
      redis:
        image: redis:8.2.2-alpine
        ports: ['127.0.0.1:6379:6379']
  - id: worker
    name: Worker
    description: Worker
    tags: [integration]
    compose:
      worker:
        image: example/worker:1.0.0
    configuration:
      - key: redisUrl
        label: Redis URL
        type: text
        environment: REDIS_URL
        default: 'redis://{{ services.redis.host }}:{{ services.redis.port }}'
`;

const requiredConfigurationCatalog = `version: 1
services:
  - id: protected-worker
    name: Protected worker
    description: Worker with a required setting.
    tags: [integration]
    compose:
      protected-worker:
        image: example/protected-worker:1.0.0
    configuration:
      - key: accessToken
        label: Access token
        type: password
        environment: ACCESS_TOKEN
        required: true
        minLength: 32
`;

const SwitchStub = defineComponent({
  props: { modelValue: Boolean, label: String },
  emits: ['update:modelValue'],
  template:
    '<input type="checkbox" :data-label="label" :checked="modelValue" @change="$emit(\'update:modelValue\', $event.target.checked)" />',
});

describe('Additional services page', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    useAppStore().initializeStarterDefaults();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => catalog }));
  });

  it('adds a selected catalogue service to the generated Compose setup', async () => {
    const wrapper = mount(AdditionalServicesPage, {
      global: {
        stubs: {
          'v-container': { template: '<div><slot /></div>' },
          NuxtLink: { template: '<a><slot /></a>' },
          'v-breadcrumbs': { template: '<div />' },
          'v-alert': { template: '<div><slot /></div>' },
          'v-text-field': { template: '<input />' },
          'v-select': { template: '<select />' },
          'v-number-input': { template: '<input type="number" />' },
          'v-list': { template: '<div><slot /></div>' },
          'v-list-item': {
            props: { title: String, subtitle: String },
            emits: ['click'],
            template:
              '<div :data-title="title" @click="$emit(\'click\')">{{ title }}{{ subtitle }}<slot /><slot name="append" /></div>',
          },
          'v-list-item-title': { template: '<div><slot /></div>' },
          'v-list-item-subtitle': { template: '<div><slot /></div>' },
          'v-expansion-panels': { template: '<div><slot /></div>' },
          'v-expansion-panel': { template: '<section><slot /></section>' },
          'v-expansion-panel-title': { template: '<div><slot /></div>' },
          'v-expansion-panel-text': { template: '<div><slot /></div>' },
          'v-chip': { template: '<span><slot /></span>' },
          'v-switch': SwitchStub,
          'v-divider': { template: '<hr />' },
          'v-row': { template: '<div><slot /></div>' },
          'v-col': { template: '<div><slot /></div>' },
          'v-btn': {
            emits: ['click'],
            template: '<button @click="$emit(\'click\')"><slot /></button>',
          },
          'v-card-actions': { template: '<div><slot /></div>' },
          'v-spacer': { template: '<span />' },
        },
      },
    });
    await flushPromises();

    await wrapper
      .findAll('button')
      .find(button => button.text().trim() === 'Add')
      ?.trigger('click');
    await nextTick();
    expect(wrapper.text()).toContain('Remove');
    expect(wrapper.text()).not.toContain('Added services');

    const compose = useAppStore().getDockerComposeConfig?.value as {
      services: Record<string, unknown>;
    };
    expect(compose.services.redis).toMatchObject({ image: 'redis:8.2.2-alpine' });
  });

  it('highlights and focuses the first missing required setting after adding a service', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, text: async () => requiredConfigurationCatalog })
    );
    const wrapper = mount(AdditionalServicesPage, {
      attachTo: document.body,
      global: {
        stubs: {
          'v-container': { template: '<div><slot /></div>' },
          NuxtLink: { template: '<a><slot /></a>' },
          'v-breadcrumbs': { template: '<div />' },
          'v-alert': { template: '<div><slot /></div>' },
          'v-text-field': {
            props: { id: String, label: String, error: Boolean, errorMessages: String },
            template:
              '<input :id="id" :data-label="label" :data-error="String(error)" :data-error-message="errorMessages" />',
          },
          'v-select': { template: '<select />' },
          'v-number-input': { template: '<input type="number" />' },
          'v-list': { template: '<div><slot /></div>' },
          'v-list-item': { template: '<div><slot /><slot name="append" /></div>' },
          'v-list-item-title': { template: '<div><slot /></div>' },
          'v-list-item-subtitle': { template: '<div><slot /></div>' },
          'v-expansion-panels': { template: '<div><slot /></div>' },
          'v-expansion-panel': { template: '<section><slot /></section>' },
          'v-expansion-panel-title': { template: '<div><slot /></div>' },
          'v-expansion-panel-text': { template: '<div><slot /></div>' },
          'v-chip': { template: '<span><slot /></span>' },
          'v-switch': SwitchStub,
          'v-row': { template: '<div><slot /></div>' },
          'v-col': { template: '<div><slot /></div>' },
          'v-btn': {
            emits: ['click'],
            template: '<button @click="$emit(\'click\')"><slot /></button>',
          },
          'v-card-actions': { template: '<div><slot /></div>' },
          'v-spacer': { template: '<span />' },
        },
      },
    });
    await flushPromises();

    await wrapper
      .findAll('button')
      .find(button => button.text().trim() === 'Add')
      ?.trigger('click');
    await nextTick();

    const requiredInput = wrapper.find('#service-protected-worker-accessToken');
    expect(wrapper.text()).toContain('Complete required settings before continuing.');
    expect(wrapper.text()).toContain('Protected worker: Access token');
    expect(requiredInput.attributes('data-error')).toBe('true');
    expect(requiredInput.attributes('data-error-message')).toBe('Required');
    expect(document.activeElement).toBe(requiredInput.element);

    const inputComponent = wrapper.findComponent(
      '#service-protected-worker-accessToken'
    ) as VueWrapper;
    inputComponent.vm.$emit('update:modelValue', 'test');
    await flushPromises();
    expect(requiredInput.attributes('data-error-message')).toBe('Use at least 32 characters.');
    const next = wrapper.findAll('button').find(button => button.text().trim() === 'Next')!;
    expect(next.attributes('disabled')).toBeDefined();

    inputComponent.vm.$emit('update:modelValue', 'a'.repeat(32));
    await flushPromises();
    expect(requiredInput.attributes('data-error')).toBe('false');
    expect(next.attributes('disabled')).toBeUndefined();

    wrapper.unmount();
  });

  it('resolves service placeholders before generating Compose configuration', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, text: async () => referenceCatalog })
    );
    const wrapper = mount(AdditionalServicesPage, {
      global: {
        stubs: {
          'v-container': { template: '<div><slot /></div>' },
          NuxtLink: { template: '<a><slot /></a>' },
          'v-breadcrumbs': { template: '<div />' },
          'v-alert': { template: '<div><slot /></div>' },
          'v-text-field': { template: '<input />' },
          'v-select': { template: '<select />' },
          'v-number-input': { template: '<input type="number" />' },
          'v-list': { template: '<div><slot /></div>' },
          'v-list-item': {
            props: { title: String, subtitle: String },
            emits: ['click'],
            template:
              '<button v-if="title" :data-reference="title" @click="$emit(\'click\')">{{ title }}</button><div v-else><slot /><slot name="append" /></div>',
          },
          'v-list-item-title': { template: '<div><slot /></div>' },
          'v-list-item-subtitle': { template: '<div><slot /></div>' },
          'v-expansion-panels': { template: '<div><slot /></div>' },
          'v-expansion-panel': { template: '<section><slot /></section>' },
          'v-expansion-panel-title': { template: '<div><slot /></div>' },
          'v-expansion-panel-text': { template: '<div><slot /></div>' },
          'v-chip': { template: '<span><slot /></span>' },
          'v-switch': SwitchStub,
          'v-row': { template: '<div><slot /></div>' },
          'v-col': { template: '<div><slot /></div>' },
          'v-btn': {
            emits: ['click'],
            template: '<button @click="$emit(\'click\')"><slot /></button>',
          },
          'v-card-actions': { template: '<div><slot /></div>' },
          'v-spacer': { template: '<span />' },
        },
      },
    });
    await flushPromises();

    await wrapper
      .findAll('button')
      .find(button => button.text().trim() === 'Add')
      ?.trigger('click');
    await nextTick();
    await wrapper
      .findAll('button')
      .find(button => button.text().trim() === 'Add')
      ?.trigger('click');
    await nextTick();

    const compose = useAppStore().getDockerComposeConfig?.value as {
      services: Record<string, { environment?: Record<string, string> }>;
    };
    expect(compose.services.worker?.environment?.REDIS_URL).toBe('redis://redis:6379');

    await wrapper
      .findAll('button')
      .find(button => button.text().trim() === 'Remove')
      ?.trigger('click');
    await nextTick();

    const updatedCompose = useAppStore().getDockerComposeConfig?.value as {
      services: Record<string, { environment?: Record<string, string> }>;
    };
    expect(updatedCompose.services.redis).toBeUndefined();
    expect(updatedCompose.services.worker).toBeUndefined();
    expect(wrapper.text()).toContain('Fix service references before continuing.');
  });

  it('offers generated placeholders from the selected service catalogue', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, text: async () => referenceCatalog })
    );
    const store = useAppStore();
    const dockerCompose = JSON.parse(JSON.stringify(store.getDockerComposeConfig)) as {
      name: string;
      value: { services: Record<string, { environment?: Record<string, string> }> };
    };
    dockerCompose.value.services.db = {
      environment: { POSTGRES_DB: 'configured-basyx-db', POSTGRES_PASSWORD: 'do-not-offer' },
    };
    store.setDockerComposeConfig(dockerCompose);
    const wrapper = mount(AdditionalServicesPage, {
      global: {
        stubs: {
          'v-container': { template: '<div><slot /></div>' },
          NuxtLink: { template: '<a><slot /></a>' },
          'v-breadcrumbs': { template: '<div />' },
          'v-alert': { template: '<div><slot /></div>' },
          'v-text-field': { template: '<div><slot name="append-inner" /></div>' },
          'v-select': { template: '<select />' },
          'v-number-input': { template: '<input type="number" />' },
          'v-list': { template: '<div><slot /></div>' },
          'v-list-item': {
            props: { title: String, subtitle: String },
            emits: ['click'],
            template:
              '<button v-if="title" :data-reference="title" @click="$emit(\'click\')">{{ title }}</button><div v-else><slot /><slot name="append" /></div>',
          },
          'v-list-item-title': { template: '<div><slot /></div>' },
          'v-list-item-subtitle': { template: '<div><slot /></div>' },
          'v-expansion-panels': { template: '<div><slot /></div>' },
          'v-expansion-panel': { template: '<section><slot /></section>' },
          'v-expansion-panel-title': { template: '<div><slot /></div>' },
          'v-expansion-panel-text': { template: '<div><slot /></div>' },
          'v-menu': {
            props: { modelValue: Boolean },
            template:
              '<div data-reference-menu :data-open="String(modelValue)"><slot name="activator" :props="{}" /><slot /></div>',
          },
          'v-list-subheader': { template: '<div><slot /></div>' },
          'v-tooltip': {
            template: '<div><slot name="activator" :props="{}" /><slot /></div>',
          },
          'v-chip': { template: '<span><slot /></span>' },
          'v-switch': SwitchStub,
          'v-row': { template: '<div><slot /></div>' },
          'v-col': { template: '<div><slot /></div>' },
          'v-btn': {
            emits: ['click'],
            template: '<button v-bind="$attrs" @click="$emit(\'click\')"><slot /></button>',
          },
          'v-card-actions': { template: '<div><slot /></div>' },
          'v-spacer': { template: '<span />' },
        },
      },
    });
    await flushPromises();

    for (const button of wrapper
      .findAll('button')
      .filter(button => button.text().trim() === 'Add')) {
      await button.trigger('click');
    }
    await nextTick();

    expect(wrapper.find('[aria-label="Available placeholders"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('Available placeholders');
    expect(wrapper.text()).toContain('Redis: host');
    expect(wrapper.text()).toContain('{{ services.redis.host }}');
    expect(wrapper.text()).toContain('db: POSTGRES_DB');
    expect(wrapper.text()).not.toContain('db: POSTGRES_PASSWORD');

    await wrapper.find('[data-reference="db: POSTGRES_DB"]').trigger('click');
    await nextTick();

    const compose = useAppStore().getDockerComposeConfig?.value as {
      services: Record<string, { environment?: Record<string, string> }>;
    };
    expect(compose.services.worker?.environment?.REDIS_URL).toBe('configured-basyx-db');
    expect(wrapper.find('[data-reference-menu]').attributes('data-open')).toBe('false');
  });
});
