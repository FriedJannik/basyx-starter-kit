<template>
  <v-container class="py-0 px-4 px-sm-8 px-md-12" fluid>
    <v-breadcrumbs class="px-0 pb-0 text-body-2 mb-3" divider="›" :items="breadcrumbs" />
    <h1 class="mb-8 text-header">Custom Configuration</h1>
    <p class="text-normalText mt-8 mb-5 text-subtitle-1">
      Set custom image tags, ports, container names, and context paths for generated services.
    </p>
    <v-alert color="alertCard">
      <v-row align="center">
        <v-col cols="auto" class="pr-0">
          <v-icon color="subheader">mdi-alert-circle-outline</v-icon>
        </v-col>
        <v-col>
          <div class="font-weight-medium text-header">Note</div>
        </v-col>
      </v-row>
      <p class="text-subheader font-weight-medium ms-0 ms-sm-12 mt-2">
        Ensure your port mappings and container names are unique.
      </p>
    </v-alert>

    <ClientOnly>
      <v-expansion-panels class="setup-config-panels mt-8 mb-8">
        <v-expansion-panel v-for="service in servicesForConfig" :key="service.id">
          <v-expansion-panel-title>
            <span>{{ service.title }}</span>
            <v-chip
              class="ml-3"
              size="small"
              :color="service.kind === 'third-party' ? 'secondary' : 'primary'"
              variant="tonal"
            >
              {{ service.kind === 'third-party' ? '3rd party' : 'Core service' }}
            </v-chip>
          </v-expansion-panel-title>
          <v-expansion-panel-text>
            <DockerConfig :service-name="service.id" />
          </v-expansion-panel-text>
        </v-expansion-panel>
      </v-expansion-panels>
      <template #fallback>
        <v-alert color="primary" variant="outlined" class="bg-alertCard mt-8 mb-8">
          Loading container settings...
        </v-alert>
      </template>
    </ClientOnly>

    <v-card-actions class="px-0 mb-8">
      <v-btn
        variant="tonal"
        prepend-icon="mdi-arrow-left"
        to="/get-started/deployment/additional-services"
        >Back</v-btn
      >
      <v-spacer />
      <v-btn
        variant="tonal"
        color="primary"
        append-icon="mdi-arrow-right"
        to="/get-started/deployment/observability"
        >Next</v-btn
      >
    </v-card-actions>
  </v-container>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useAppStore } from '@/stores/app';

defineOptions({
  name: 'ContainerConfig',
});

useSeoMeta({
  title: 'Container Config | Eclipse BaSyx™',
  ogTitle: 'Container Config | Eclipse BaSyx™',
});

const appStore = useAppStore();

const breadcrumbs = ref([
  { title: 'Home', to: '/' },
  { title: 'Get Started', to: '/get-started/introduction' },
  { title: 'Container Config', to: '/get-started/deployment/container-config' },
]);

const dockerCompose = computed(() => appStore.getDockerComposeConfig?.value);

const serviceLabelMap: Record<string, string> = {
  'aas-environment': 'AAS Environment',
  db: 'PostgreSQL',
  basyx_configuration: 'BaSyx Configuration Service',
  'aas-ui': 'AAS UI',
  influxdb: 'InfluxDB',
  telegraf: 'Telegraf',
  keycloak: 'Keycloak',
  mqtt: 'MQTT Broker',
  kafka: 'Kafka',
  'kafka-init': 'Kafka Initialization',
  rabbitmq: 'RabbitMQ',
  'otel-collector': 'OpenTelemetry Collector',
  prometheus: 'Prometheus',
  tempo: 'Tempo',
  loki: 'Loki',
  alloy: 'Alloy',
  grafana: 'Grafana',
};

const serviceOrder = [
  'aas-environment',
  'db',
  'basyx_configuration',
  'aas-ui',
  'influxdb',
  'telegraf',
];

interface ServiceForConfig {
  id: string;
  title: string;
  kind: 'core' | 'third-party';
}

const servicesForConfig = computed(() => {
  const config = dockerCompose.value;
  if (!config || typeof config === 'string' || !('services' in config)) {
    return [] as ServiceForConfig[];
  }

  const services = config.services as Record<string, unknown>;
  const knownServices = serviceOrder
    .filter(id => Boolean(services[id]))
    .map(id => ({
      id,
      title: serviceLabelMap[id] || id,
      kind: 'core' as const,
    }));
  const additionalServices = Object.keys(services)
    .filter(id => !serviceOrder.includes(id))
    .map(id => ({
      id,
      title: serviceLabelMap[id] || id,
      kind: Object.hasOwn(serviceLabelMap, id) ? ('core' as const) : ('third-party' as const),
    }));
  return [...knownServices, ...additionalServices];
});
</script>
