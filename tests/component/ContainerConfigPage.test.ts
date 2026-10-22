import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ContainerConfigPage from '@/pages/get-started/deployment/container-config.vue';
import { useAppStore } from '@/stores/app';

vi.stubGlobal('useSeoMeta', vi.fn());

describe('Container config page', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('identifies core and third-party services in panel headers', () => {
    const store = useAppStore();
    store.initializeStarterDefaults();
    store.setDockerComposeConfig({
      name: 'docker-compose.yaml',
      value: {
        services: {
          'aas-environment': { image: 'eclipsebasyx/aasenvironment-go:2.0.0' },
          redis: { image: 'redis:8.2.2-alpine' },
        },
      },
    });

    const wrapper = mount(ContainerConfigPage, {
      global: {
        stubs: {
          'v-container': { template: '<div><slot /></div>' },
          'v-breadcrumbs': { template: '<div />' },
          'v-alert': { template: '<div><slot /></div>' },
          'v-row': { template: '<div><slot /></div>' },
          'v-col': { template: '<div><slot /></div>' },
          'v-icon': { template: '<i />' },
          ClientOnly: { template: '<div><slot /></div>' },
          DockerConfig: { template: '<div />' },
          'v-expansion-panels': { template: '<div><slot /></div>' },
          'v-expansion-panel': { template: '<section><slot /></section>' },
          'v-expansion-panel-title': { template: '<div><slot /></div>' },
          'v-expansion-panel-text': { template: '<div><slot /></div>' },
          'v-chip': { template: '<span><slot /></span>' },
          'v-card-actions': { template: '<div><slot /></div>' },
          'v-btn': { template: '<button><slot /></button>' },
          'v-spacer': { template: '<span />' },
        },
      },
    });

    expect(wrapper.text()).toContain('Core service');
    expect(wrapper.text()).toContain('3rd party');
  });
});
