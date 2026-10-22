<template>
  <v-container class="py-0 px-4 px-sm-8 px-md-12" fluid>
    <v-breadcrumbs class="px-0 pb-0 text-body-2 mb-3" divider="›" :items="breadcrumbs" />
    <h1 class="mb-3 text-header">Additional Services</h1>
    <p class="text-normalText mb-6">
      Add optional services to extend your BaSyx deployment, then configure the settings specific to
      each application.
    </p>

    <v-alert variant="tonal" type="info" class="mb-8">
      Configure ports, images, and other container settings on the
      <NuxtLink
        class="text-primary font-weight-medium"
        to="/get-started/deployment/container-config"
      >
        Container Config
      </NuxtLink>
      page. This page is for application-specific settings only.
    </v-alert>

    <div class="mb-8">
      <div id="cpu-architecture-label" class="text-subtitle-2 mb-2">CPU architecture</div>
      <v-btn-toggle
        :model-value="architecture"
        mandatory
        divided
        color="primary"
        variant="outlined"
        aria-labelledby="cpu-architecture-label"
        @update:model-value="setArchitecture"
      >
        <v-btn value="amd64">AMD64</v-btn>
        <v-btn value="arm64">ARM64</v-btn>
      </v-btn-toggle>
      <p class="text-caption text-medium-emphasis mt-2 mb-0">
        {{
          detectedArchitecture === 'unknown'
            ? 'Browser architecture unavailable.'
            : `Browser detected: ${detectedArchitecture.toUpperCase()}.`
        }}
        Select the CPU architecture of the machine that will run these services.
      </p>
    </div>

    <v-alert v-if="loadError" type="error" variant="tonal" class="mb-8">{{ loadError }}</v-alert>

    <template v-else>
      <v-text-field
        v-model="search"
        label="Filter services"
        prepend-inner-icon="mdi-magnify"
        variant="solo-filled"
        hide-details
        class="mb-6"
      />

      <v-alert v-if="portConflicts.length" type="warning" variant="tonal" class="mb-6">
        {{ portConflicts.join(' ') }} Choose a different host port in Container Config before
        downloading this setup.
      </v-alert>

      <v-alert v-if="referenceResolution.errors.length" type="error" variant="tonal" class="mb-6">
        <div class="font-weight-medium">Fix service references before continuing.</div>
        <ul class="mt-2 pl-4">
          <li v-for="error in referenceResolution.errors" :key="error">{{ error }}</li>
        </ul>
      </v-alert>

      <v-alert v-if="missingRequiredFields.length" type="warning" variant="tonal" class="mb-6">
        <div class="font-weight-medium">Complete required settings before continuing.</div>
        <ul class="mt-2 pl-4">
          <li
            v-for="issue in missingRequiredFields"
            :key="`${issue.service.id}.${issue.field.key}`"
          >
            {{ issue.service.name }}: {{ issue.field.label }} —
            {{ fieldError(issue.service.id, issue.field) }}
          </li>
        </ul>
      </v-alert>

      <h2 class="text-header mb-4">Available services</h2>
      <v-list class="bg-background border rounded-lg mb-8" lines="three">
        <v-list-item
          v-for="service in filteredServices"
          :key="service.id"
          class="py-3 service-catalogue-item"
        >
          <v-list-item-title class="text-subtitle-1 font-weight-medium">
            {{ service.name }}
          </v-list-item-title>
          <v-list-item-subtitle class="text-body-2 text-medium-emphasis mt-1">
            {{ service.description }}
          </v-list-item-subtitle>
          <div class="d-flex flex-wrap ga-1 mt-3">
            <v-chip v-for="tag in service.tags" :key="tag" size="small" variant="tonal">
              {{ tag }}
            </v-chip>
          </div>
          <template #append>
            <v-btn
              :color="isSelected(service.id) ? 'secondary' : 'primary'"
              :prepend-icon="isSelected(service.id) ? 'mdi-minus' : 'mdi-plus'"
              :variant="isSelected(service.id) ? 'text' : 'tonal'"
              @click="isSelected(service.id) ? removeService(service.id) : addService(service)"
            >
              {{ isSelected(service.id) ? 'Remove' : 'Add' }}
            </v-btn>
          </template>
        </v-list-item>
      </v-list>

      <template v-if="configuredServices.length">
        <h2 class="text-header mb-4">Added services</h2>
        <v-expansion-panels v-model="expanded" multiple class="setup-config-panels mb-8">
          <v-expansion-panel
            v-for="service in configuredServices"
            :key="service.id"
            :value="service.id"
          >
            <v-expansion-panel-title>{{ service.name }}</v-expansion-panel-title>
            <v-expansion-panel-text>
              <div class="text-subtitle-2 mb-4">Service configuration</div>
              <p class="text-caption text-medium-emphasis mb-4">
                Text settings can reference selected services, for example
                <code v-pre>{{ services.redis.host }}</code> or
                <code v-pre>{{ services.redis.config.password }}</code
                >.
              </p>
              <v-row density="compact">
                <v-col
                  v-for="field in service.configuration.filter(field => !field.generate)"
                  :key="field.key"
                  cols="12"
                  md="6"
                >
                  <v-switch
                    v-if="field.type === 'switch'"
                    :id="configurationFieldId(service.id, field.key)"
                    v-model="valuesFor(service.id)[field.key]"
                    :label="field.label"
                    color="primary"
                    :error="Boolean(fieldError(service.id, field))"
                    :error-messages="fieldError(service.id, field)"
                    hide-details="auto"
                  />
                  <v-select
                    v-else-if="field.type === 'select'"
                    :id="configurationFieldId(service.id, field.key)"
                    v-model="valuesFor(service.id)[field.key]"
                    :items="field.options || []"
                    item-title="title"
                    item-value="value"
                    :label="field.label"
                    variant="solo-filled"
                    :error="Boolean(fieldError(service.id, field))"
                    :error-messages="fieldError(service.id, field)"
                    :hint="field.description"
                    :persistent-hint="Boolean(field.description)"
                  />
                  <v-number-input
                    v-else-if="field.type === 'number'"
                    :id="configurationFieldId(service.id, field.key)"
                    :model-value="numberValueFor(service.id, field.key)"
                    :label="field.label"
                    variant="solo-filled"
                    :error="Boolean(fieldError(service.id, field))"
                    :error-messages="fieldError(service.id, field)"
                    :hint="field.description"
                    :persistent-hint="Boolean(field.description)"
                    @update:model-value="setValue(service.id, field.key, $event)"
                  />
                  <v-text-field
                    v-else
                    :id="configurationFieldId(service.id, field.key)"
                    v-model="valuesFor(service.id)[field.key]"
                    :label="field.label"
                    :type="field.type === 'password' ? 'password' : 'text'"
                    variant="solo-filled"
                    :error="Boolean(fieldError(service.id, field))"
                    :error-messages="fieldError(service.id, field)"
                    :hint="field.description"
                    :persistent-hint="Boolean(field.description)"
                  >
                    <template v-if="field.type === 'text'" #append-inner>
                      <v-menu
                        v-model="referenceMenus[referenceMenuKey(service.id, field.key)]"
                        location="bottom end"
                      >
                        <template #activator="{ props }">
                          <v-btn
                            v-bind="props"
                            aria-label="Available placeholders"
                            title="Available placeholders"
                            icon="mdi-help-circle-outline"
                            size="small"
                            variant="text"
                          />
                        </template>
                        <v-list density="compact" min-width="300">
                          <v-list-subheader>Available placeholders</v-list-subheader>
                          <v-list-item-subtitle class="px-4 pb-2 text-wrap">
                            Select a placeholder to insert it into this setting.
                          </v-list-item-subtitle>
                          <template v-if="referenceOptions(service.id).length">
                            <v-list-item
                              v-for="reference in referenceOptions(service.id)"
                              :key="reference.value"
                              :title="reference.title"
                              :subtitle="reference.value"
                              @click="selectReference(service.id, field.key, reference.value)"
                            />
                          </template>
                          <v-list-item
                            v-else
                            title="No placeholders available"
                            subtitle="Add another service to reference its connection details."
                          />
                        </v-list>
                      </v-menu>
                    </template>
                  </v-text-field>
                </v-col>
              </v-row>
            </v-expansion-panel-text>
          </v-expansion-panel>
        </v-expansion-panels>
      </template>

      <v-alert v-if="!filteredServices.length" variant="tonal" class="mb-8">
        No services match this filter.
      </v-alert>
    </template>

    <v-card-actions class="px-0 mb-8">
      <v-btn variant="tonal" prepend-icon="mdi-arrow-left" to="/get-started/deployment/integration"
        >Back</v-btn
      >
      <v-spacer />
      <v-btn
        variant="tonal"
        color="primary"
        append-icon="mdi-arrow-right"
        :disabled="!isConfigurationComplete"
        @click="goNext"
        >Next</v-btn
      >
    </v-card-actions>
  </v-container>
</template>

<script setup lang="ts">
import type { ComposeService } from '@/utils/optionalServices';
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { type ThirdPartyServiceSelection, useAppStore } from '@/stores/app';
import { type ClientArchitecture, detectClientArchitecture } from '@/utils/clientArchitecture';
import { findComposePortConflicts } from '@/utils/composePorts';
import {
  buildThirdPartyServiceCompose,
  defaultThirdPartyValues,
  initializeThirdPartyValues,
  loadThirdPartyServiceCatalog,
  resolveThirdPartyServiceReferences,
  thirdPartyFieldError,
  thirdPartyManagedServiceIds,
  type ThirdPartyService,
  type ThirdPartyServiceField,
  thirdPartyValuesForArchitecture,
} from '@/utils/thirdPartyServices';

defineOptions({ name: 'AdditionalServices' });
useSeoMeta({
  title: 'Additional Services | Eclipse BaSyx™',
  ogTitle: 'Additional Services | Eclipse BaSyx™',
});

type FieldValues = Record<string, string | number | boolean | undefined>;
type ReferenceOption = { title: string; value: string };

const SENSITIVE_CONFIGURATION_KEY = /password|token|secret|salt|private.?key|connectionstrings?/i;

const appStore = useAppStore();
const services = ref<ThirdPartyService[]>([]);
const architecture = ref<'amd64' | 'arm64'>(appStore.thirdPartyArchitecture || 'amd64');
const detectedArchitecture = ref<ClientArchitecture>('unknown');
const selected = ref<Record<string, FieldValues>>({});
const expanded = ref<string[]>([]);
const referenceMenus = ref<Record<string, boolean>>({});
const search = ref('');
const loadError = ref('');
const breadcrumbs = [
  { title: 'Home', to: '/' },
  { title: 'Get Started', to: '/get-started/introduction' },
  { title: 'Additional Services', to: '/get-started/deployment/additional-services' },
];

const filteredServices = computed(() => {
  const query = search.value.trim().toLowerCase();
  if (!query) return services.value;
  return services.value.filter(service =>
    [service.name, service.description, ...service.tags].join(' ').toLowerCase().includes(query)
  );
});

const configuredServices = computed(() =>
  selectedServices().filter(service => service.configuration.some(field => !field.generate))
);

const referenceResolution = computed(() =>
  resolveThirdPartyServiceReferences(selectedServices(), selected.value, baseComposeServices())
);

const isConfigurationComplete = computed(
  () =>
    selectedServices().every(service =>
      service.configuration.every(field => !fieldError(service.id, field))
    ) &&
    referenceResolution.value.errors.length === 0 &&
    portConflicts.value.length === 0
);

const missingRequiredFields = computed(() =>
  selectedServices().flatMap(service =>
    service.configuration
      .filter(field => Boolean(fieldError(service.id, field)))
      .map(field => ({ service, field }))
  )
);

const portConflicts = computed(() => {
  const compose = appStore.getDockerComposeConfig?.value as
    { services?: Record<string, ComposeService> } | undefined;
  return findComposePortConflicts(compose?.services || {});
});

function valuesFor(serviceId: string): FieldValues {
  return (selected.value[serviceId] ||= {});
}

function numberValueFor(serviceId: string, key: string): number | undefined {
  const value = valuesFor(serviceId)[key];
  return typeof value === 'number' ? value : undefined;
}

function fieldError(serviceId: string, field: ThirdPartyServiceField): string | undefined {
  return thirdPartyFieldError(
    field,
    referenceResolution.value.values[serviceId]?.[field.key] ?? valuesFor(serviceId)[field.key]
  );
}

function configurationFieldId(serviceId: string, fieldKey: string): string {
  return `service-${serviceId}-${fieldKey}`;
}

function setValue(serviceId: string, key: string, value: unknown): void {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    valuesFor(serviceId)[key] = value;
  }
}

function portsFor(service: unknown): string[] {
  if (!service || typeof service !== 'object' || !('ports' in service)) return [];
  const ports = service.ports;
  return Array.isArray(ports) ? ports.filter(port => typeof port === 'string') : [];
}

function isSelected(serviceId: string): boolean {
  return serviceId in selected.value;
}

function setArchitecture(value: unknown): void {
  if (value !== 'amd64' && value !== 'arm64') return;
  architecture.value = value;
  appStore.thirdPartyArchitecture = value;
  selectedServices().forEach(service => {
    selected.value[service.id] = thirdPartyValuesForArchitecture(
      service,
      valuesFor(service.id),
      value
    );
  });
  applySettings();
}

function addService(service: ThirdPartyService): void {
  try {
    selected.value[service.id] = initializeThirdPartyValues(service, {}, architecture.value);
  } catch (error) {
    loadError.value =
      error instanceof Error ? error.message : 'Could not generate service credentials.';
    return;
  }
  if (service.configuration.length && !expanded.value.includes(service.id)) {
    expanded.value.push(service.id);
  }
  applySettings();
  const firstRequiredField = service.configuration.find(field => field.required && !field.generate);
  if (firstRequiredField) {
    void nextTick(() => {
      document.getElementById(configurationFieldId(service.id, firstRequiredField.key))?.focus();
    });
  }
}

function removeService(serviceId: string): void {
  Reflect.deleteProperty(selected.value, serviceId);
  expanded.value = expanded.value.filter(id => id !== serviceId);
  applySettings();
}

function selectedServices(): ThirdPartyService[] {
  return services.value.filter(service => isSelected(service.id));
}

function referenceOptions(sourceServiceId: string): ReferenceOption[] {
  const coreOptions = Object.entries(baseComposeServices()).flatMap(([serviceId, service]) => [
    ...metadataReferenceOptions(serviceId, serviceId, service),
    ...configurationReferenceOptions(serviceId, serviceId, service),
  ]);
  const thirdPartyOptions = selectedServices().flatMap(service => {
    if (service.id === sourceServiceId) return [];
    const [composeService] = Object.values(service.compose);
    return [
      ...metadataReferenceOptions(service.id, service.name, composeService),
      ...service.configuration
        .filter(field => field.type !== 'password')
        .map(field => ({
          title: `${service.name}: ${field.label}`,
          value: `{{ services.${service.id}.config.${field.key} }}`,
        })),
    ];
  });
  return [...coreOptions, ...thirdPartyOptions];
}

function metadataReferenceOptions(
  serviceId: string,
  serviceName: string,
  service: ComposeService | undefined
): ReferenceOption[] {
  const prefix = `services.${serviceId}`;
  const ports = portsFor(service);
  const port = ports[0]?.split(':').at(-1);
  const externalPort = ports[0]?.split(':').at(-2);
  return [
    { title: `${serviceName}: host`, value: `{{ ${prefix}.host }}` },
    ...(port ? [{ title: `${serviceName}: internal port`, value: `{{ ${prefix}.port }}` }] : []),
    ...(externalPort
      ? [{ title: `${serviceName}: external port`, value: `{{ ${prefix}.externalPort }}` }]
      : []),
    ...(typeof service?.container_name === 'string'
      ? [{ title: `${serviceName}: container name`, value: `{{ ${prefix}.containerName }}` }]
      : []),
    ...(typeof service?.image === 'string'
      ? [{ title: `${serviceName}: image`, value: `{{ ${prefix}.image }}` }]
      : []),
  ];
}

function configurationReferenceOptions(
  serviceId: string,
  serviceName: string,
  service: ComposeService | undefined
): ReferenceOption[] {
  const environment = service?.environment;
  const entries = Array.isArray(environment)
    ? environment.flatMap(entry => {
        if (typeof entry !== 'string') return [];
        const separator = entry.indexOf('=');
        return separator > 0 ? [[entry.slice(0, separator), entry.slice(separator + 1)]] : [];
      })
    : environment && typeof environment === 'object'
      ? Object.entries(environment)
      : [];

  return entries
    .filter(
      ([key, value]) =>
        typeof key === 'string' &&
        typeof value === 'string' &&
        !SENSITIVE_CONFIGURATION_KEY.test(key)
    )
    .map(([key]) => ({
      title: `${serviceName}: ${key}`,
      value: `{{ services.${serviceId}.config.${key} }}`,
    }));
}

function referenceMenuKey(serviceId: string, fieldKey: string): string {
  return `${serviceId}.${fieldKey}`;
}

function selectReference(serviceId: string, fieldKey: string, reference: string): void {
  valuesFor(serviceId)[fieldKey] = reference;
  referenceMenus.value[referenceMenuKey(serviceId, fieldKey)] = false;
}

function baseComposeServices(): Record<string, Record<string, unknown>> {
  const compose = appStore.getDockerComposeConfig?.value;
  if (!compose || typeof compose !== 'object' || !('services' in compose)) return {};
  const managedIds = new Set(thirdPartyManagedServiceIds(services.value));
  const selectedIds = new Set(selectedServices().flatMap(service => Object.keys(service.compose)));
  return Object.fromEntries(
    Object.entries(compose.services as Record<string, Record<string, unknown>>).filter(
      ([serviceId]) => !managedIds.has(serviceId) || selectedIds.has(serviceId)
    )
  );
}

function applySettings(): void {
  const enabled = selectedServices();
  const selections: ThirdPartyServiceSelection[] = enabled.map(service => ({
    id: service.id,
    values: Object.fromEntries(
      Object.entries(valuesFor(service.id)).filter(([, value]) => value !== undefined)
    ) as Record<string, string | number | boolean>,
  }));
  if (referenceResolution.value.errors.length) {
    appStore.thirdPartyServices = selections;
    return;
  }
  const additions = Object.assign(
    {},
    ...enabled.map(service =>
      buildThirdPartyServiceCompose(
        service,
        referenceResolution.value.values[service.id] || valuesFor(service.id)
      )
    )
  );
  const managedIds = thirdPartyManagedServiceIds(services.value);
  appStore.setThirdPartyServices(selections, additions, managedIds);
}

function goNext(): void {
  if (isConfigurationComplete.value) navigateTo('/get-started/deployment/container-config');
}

watch(
  selected,
  () => {
    applySettings();
  },
  { deep: true }
);

onMounted(async () => {
  try {
    const [catalog, detected] = await Promise.all([
      loadThirdPartyServiceCatalog(),
      detectClientArchitecture(),
    ]);
    detectedArchitecture.value = detected;
    const savedArchitecture = appStore.thirdPartyArchitecture;
    architecture.value = savedArchitecture || (detected === 'arm64' ? 'arm64' : 'amd64');
    appStore.thirdPartyArchitecture = architecture.value;
    services.value = catalog;
    const restored = new Map(
      appStore.getThirdPartyServices.map(selection => [selection.id, selection.values])
    );
    services.value.forEach(service => {
      const previous = restored.get(service.id);
      if (previous) {
        const values = savedArchitecture
          ? { ...defaultThirdPartyValues(service, architecture.value), ...previous }
          : thirdPartyValuesForArchitecture(service, previous, architecture.value);
        selected.value[service.id] = initializeThirdPartyValues(
          service,
          values,
          architecture.value
        );
      }
    });
  } catch (error) {
    loadError.value =
      error instanceof Error
        ? `Could not load additional services: ${error.message}`
        : 'Could not load additional services.';
  }
});
</script>

<style scoped>
.service-catalogue-item :deep(.v-list-item__append) {
  align-self: center;
}
</style>
