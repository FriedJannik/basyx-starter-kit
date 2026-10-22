<template>
  <v-container :class="props.compact ? 'pt-4 px-2' : 'pt-12'">
    <div>
      <v-list nav slim density="compact" :lines="false" class="bg-background pb-0">
        <v-list-subheader class="text-high-emphasis font-weight-black text-uppercase"
          >Components</v-list-subheader
        >
      </v-list>
      <v-treeview
        v-model:activated="active"
        :items="items"
        item-value="id"
        activatable
        open-all
        :opened="openItems"
        density="compact"
        class="bg-background"
        rounded
        expand-icon="mdi-chevron-down"
        collapse-icon="mdi-chevron-up"
        :lines="false"
        slim
        variant="plain"
      >
        <template #prepend="{ item }">
          <v-icon :size="item.type ? 'small' : undefined">{{ getTreeIcon(item) }}</v-icon>
        </template>
        <template #title="{ item }">
          <v-list-item-title v-if="!item.type" class="text-header">
            {{ item.title }}
          </v-list-item-title>
          <v-list-item-title v-else class="text-subheader">
            {{ item.title }}
          </v-list-item-title>
        </template>
      </v-treeview>
    </div>

    <v-dialog
      v-model="outputDialog"
      :width="props.compact ? '95vw' : '1000px'"
      @update:model-value="active = undefined"
    >
      <v-card rounded="lg" border>
        <v-card-title class="py-4 bg-cardHeader">
          <v-row align="center">
            <v-col>
              <div class="text-h6">{{ dialogTitle }}</div>
              <div class="text-caption text-medium-emphasis mt-1">{{ dialogSubtitle }}</div>
            </v-col>
            <v-spacer />
            <v-col cols="auto">
              <v-btn
                icon="mdi-close"
                variant="plain"
                @click="
                  outputDialog = false;
                  active = undefined;
                "
              />
            </v-col>
          </v-row>
        </v-card-title>
        <v-divider />
        <v-card-text :style="{ height: dialogContentHeight, overflowY: 'auto' }" class="px-4 py-5">
          <template v-if="selectedItem?.type === 'config'">
            <v-alert variant="tonal" color="primary" density="comfortable" class="mb-4">
              Raw configuration excerpt for this selected node.
            </v-alert>
            <v-textarea
              v-if="selectedRawConfig?.value"
              style="font-family: monospace"
              spellcheck="false"
              variant="outlined"
              :label="selectedRawConfig.name || 'Config'"
              :model-value="selectedRawConfig.value"
              readonly
              bg-color="background"
              auto-grow
            />
          </template>

          <template v-else>
            <v-alert
              variant="tonal"
              color="primary"
              density="comfortable"
              class="mb-5"
              :icon="summaryPayload?.icon || 'mdi-information-outline'"
            >
              {{ summaryPayload?.description || 'No summary is available for this item yet.' }}
            </v-alert>

            <v-row density="compact">
              <v-col
                v-for="section in summaryPayload?.sections || []"
                :key="section.id"
                cols="12"
                md="6"
              >
                <v-card border rounded="lg" class="h-100 bg-background">
                  <v-card-item class="pb-1 bg-cardHeader">
                    <v-card-title class="text-subtitle-2 d-flex align-center ga-2">
                      <v-icon :icon="section.icon" size="18" />
                      {{ section.title }}
                    </v-card-title>
                  </v-card-item>
                  <v-divider />
                  <v-card-text class="pt-4">
                    <div
                      v-for="entry in section.entries"
                      :key="`${section.id}-${entry.key}`"
                      class="d-flex align-center justify-space-between ga-3 mb-2"
                    >
                      <span class="text-caption text-medium-emphasis">{{ entry.key }}</span>
                      <v-chip
                        size="small"
                        density="comfortable"
                        :color="entry.color || 'primary'"
                        variant="tonal"
                      >
                        {{ entry.value }}
                      </v-chip>
                    </div>
                  </v-card-text>
                </v-card>
              </v-col>
            </v-row>
          </template>
        </v-card-text>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useAppStore } from '@/stores/app';

interface TreeItem {
  id: string;
  title: string;
  type?: string;
  children?: TreeItem[];
}

interface DockerService {
  image?: string;
  container_name?: string;
  ports?: string[];
  environment?: string[] | Record<string, string>;
  volumes?: string[];
  depends_on?: Record<string, { condition: string }> | string[];
  restart?: string;
}

interface SummaryEntry {
  key: string;
  value: string;
  color?: string;
}

interface SummarySection {
  id: string;
  title: string;
  icon: string;
  entries: SummaryEntry[];
}

interface SummaryPayload {
  icon: string;
  description: string;
  sections: SummarySection[];
}

defineOptions({
  name: 'OutputView',
});

const props = withDefaults(
  defineProps<{
    compact?: boolean;
  }>(),
  {
    compact: false,
  }
);

const appStore = useAppStore();

const items = ref<TreeItem[]>([]);
const openItems = ref<string[]>([]);
const outputDialog = ref(false);
const active = ref<string[] | undefined>(undefined);
const selectedItem = ref<TreeItem | undefined>(undefined);
const topLevelParent = ref<TreeItem | undefined>(undefined);

const basyxConfig = computed(() => appStore.getBasyxConfig);

const dialogTitle = computed(
  () => selectedItem.value?.title || topLevelParent.value?.title || 'Output'
);
const dialogSubtitle = computed(() => topLevelParent.value?.title || '');
const dialogContentHeight = computed(() => (props.compact ? '70vh' : '600px'));

const selectedRawConfig = computed(() => {
  const nodeId = selectedItem.value?.id;
  if (!nodeId) {
    return undefined;
  }
  switch (nodeId) {
    case 'cfg-aas-environment':
      return appStore.getDockerComposeConfigService('aas-environment');
    case 'cfg-postgres':
      return appStore.getDockerComposeConfigService('db');
    case 'cfg-basyx-configuration':
      return appStore.getDockerComposeConfigService('basyx_configuration');
    case 'cfg-aas-ui':
      return appStore.getDockerComposeConfigService('aas-ui');
    case 'cfg-influxdb':
      return appStore.getDockerComposeConfigService('influxdb');
    case 'cfg-telegraf':
      return appStore.getDockerComposeConfigService('telegraf');
    case 'cfg-basyx-infra':
      return appStore.getBasyxInfraConfigAsString;
    default:
      if (nodeId.startsWith('cfg-third-party-')) {
        return appStore.getDockerComposeConfigService(nodeId.slice('cfg-third-party-'.length));
      }
      return undefined;
  }
});

const summaryPayload = computed(() => {
  const nodeId = selectedItem.value?.id;
  const parentId = topLevelParent.value?.id;
  if (!nodeId || !parentId) {
    return undefined;
  }

  switch (parentId) {
    case 'comp-aas-environment':
      return buildAasEnvironmentSummary(nodeId);
    case 'comp-postgres':
      return buildPostgresSummary();
    case 'comp-basyx-configuration':
      return buildBasyxConfigurationSummary();
    case 'comp-aas-ui':
      return buildUiSummary(nodeId);
    case 'comp-influxdb':
      return buildInfluxdbSummary();
    case 'comp-telegraf':
      return buildTelegrafSummary();
    default:
      return undefined;
  }
});

function openOutputDialog(id: string): void {
  const result = findItem(items.value, id);
  if (result) {
    selectedItem.value = result.item;
    topLevelParent.value = result.parent || result.item;
    outputDialog.value = true;
  }
}

function findItem(
  searchItems: TreeItem[],
  id: string,
  parent: TreeItem | null = null
): { item: TreeItem; parent: TreeItem | null } | null {
  for (const item of searchItems) {
    if (item.id === id) {
      return { item, parent };
    }
    if (item.children && item.children.length) {
      const found = findItem(item.children, id, parent || item);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

function getTreeIcon(item: TreeItem): string {
  switch (item.id) {
    case 'comp-aas-environment':
      return 'mdi-server-outline';
    case 'comp-postgres':
      return 'mdi-database';
    case 'comp-basyx-configuration':
      return 'mdi-tune-variant';
    case 'comp-aas-ui':
      return 'mdi-monitor-dashboard';
    case 'comp-influxdb':
      return 'mdi-chart-line';
    case 'comp-telegraf':
      return 'mdi-radar';
    case 'ovw-aas-environment-summary':
      return 'mdi-server-network-outline';
    case 'ovw-aas-environment-integrations':
      return 'mdi-link-variant';
    case 'ovw-aas-environment-history':
      return 'mdi-history';
    case 'ovw-aas-environment-observability':
      return 'mdi-chart-timeline-variant-shimmer';
    case 'ovw-aas-environment-security':
      return 'mdi-shield-lock-outline';
    case 'ovw-postgres-summary':
      return 'mdi-database-cog-outline';
    case 'ovw-basyx-configuration-summary':
      return 'mdi-database-sync-outline';
    case 'ovw-aas-ui-summary':
      return 'mdi-monitor-eye';
    case 'ovw-aas-ui-behavior':
      return 'mdi-cog-outline';
    case 'ovw-aas-ui-branding':
      return 'mdi-palette-outline';
    case 'ovw-aas-ui-infra':
      return 'mdi-lan-connect';
    case 'ovw-influxdb-summary':
      return 'mdi-chart-timeline-variant';
    case 'ovw-telegraf-summary':
      return 'mdi-access-point-network';
    case 'cfg-aas-environment':
    case 'cfg-postgres':
    case 'cfg-basyx-configuration':
    case 'cfg-aas-ui':
    case 'cfg-influxdb':
    case 'cfg-telegraf':
      return 'mdi-docker';
    case 'cfg-basyx-infra':
      return 'mdi-file-tree-outline';
    default:
      if (item.type === 'overview') {
        return 'mdi-view-dashboard-outline';
      }
      if (item.type === 'config') {
        return 'mdi-file-cog-outline';
      }
      if (item.type === 'db') {
        return 'mdi-database';
      }
      if (item.type === 'integration') {
        return 'mdi-link-variant';
      }
      if (item.type === 'design') {
        return 'mdi-palette';
      }
      return 'mdi-cube-outline';
  }
}

function boolChip(value: string | undefined): SummaryEntry {
  const enabled = value === 'true';
  return {
    key: '',
    value: enabled ? 'Enabled' : 'Disabled',
    color: enabled ? 'success' : 'error',
  };
}

function readComposeServices(): Record<string, DockerService> {
  const compose = appStore.getDockerComposeConfig?.value;
  if (!compose || typeof compose !== 'object' || !('services' in compose)) {
    return {};
  }
  return (compose.services || {}) as Record<string, DockerService>;
}

function readServiceEnvironment(service?: DockerService): Record<string, string> {
  if (!service?.environment) {
    return {};
  }
  if (Array.isArray(service.environment)) {
    return service.environment.reduce(
      (acc, entry) => {
        const [key, ...rest] = entry.split('=');
        if (!key) {
          return acc;
        }
        acc[key] = rest.join('=');
        return acc;
      },
      {} as Record<string, string>
    );
  }
  return service.environment;
}

function readExternalPort(service?: DockerService): string {
  if (!service?.ports?.length) {
    return 'not exposed';
  }
  const mapping = service.ports[0];
  if (!mapping) {
    return 'not exposed';
  }
  const parts = mapping.split(':');
  return parts[0] || mapping;
}

function readInfraComponents(): Record<string, Record<string, unknown>> {
  const infra = appStore.getBasyxInfraConfig?.value;
  if (!infra || typeof infra !== 'object' || !('infrastructures' in infra)) {
    return {};
  }
  const infrastructures = infra.infrastructures as Record<string, unknown>;
  const defaultKey = infrastructures.default as string;
  const defaultInfra = infrastructures[defaultKey] as {
    components?: Record<string, Record<string, unknown>>;
  };
  return defaultInfra?.components || {};
}

function buildAasEnvironmentSummary(nodeId: string): SummaryPayload {
  const services = readComposeServices();
  const service = services['aas-environment'];
  const env = readServiceEnvironment(service);

  const runtimeSection: SummarySection = {
    id: 'aas-env-runtime',
    title: 'Runtime',
    icon: 'mdi-server-outline',
    entries: [
      { key: 'Container', value: service?.container_name || 'n/a' },
      { key: 'Image', value: service?.image || 'n/a' },
      { key: 'External Port', value: readExternalPort(service) },
      { key: 'External URL', value: env.GENERAL_EXTERNALURL || 'n/a' },
      { key: 'Preconfiguration', value: env.GENERAL_AAS_PRECONFIG_PATHS || 'n/a' },
    ],
  };

  const integrationSection: SummarySection = {
    id: 'aas-env-integrations',
    title: 'Integrations',
    icon: 'mdi-link-variant',
    entries: [
      {
        key: 'AAS Registry Integration',
        value: boolChip(env.GENERAL_AASREGISTRYINTEGRATION).value,
        color: boolChip(env.GENERAL_AASREGISTRYINTEGRATION).color,
      },
      {
        key: 'Submodel Registry Integration',
        value: boolChip(env.GENERAL_SUBMODELREGISTRYINTEGRATION).value,
        color: boolChip(env.GENERAL_SUBMODELREGISTRYINTEGRATION).color,
      },
      {
        key: 'Discovery Integration',
        value: boolChip(env.GENERAL_DISCOVERYINTEGRATION).value,
        color: boolChip(env.GENERAL_DISCOVERYINTEGRATION).color,
      },
    ],
  };

  const securitySection: SummarySection = {
    id: 'aas-env-security',
    title: 'Security & CORS',
    icon: 'mdi-shield-lock-outline',
    entries: [
      {
        key: 'ABAC',
        value: boolChip(env.ABAC_ENABLED).value,
        color: boolChip(env.ABAC_ENABLED).color,
      },
      {
        key: 'ReBAC',
        value: boolChip(env.REBAC_ENABLED).value,
        color: boolChip(env.REBAC_ENABLED).color,
      },
      { key: 'CORS Origins', value: env.CORS_ALLOWEDORIGINS || '*' },
      { key: 'CORS Methods', value: env.CORS_ALLOWEDMETHODS || 'n/a' },
    ],
  };

  const historySection: SummarySection = {
    id: 'aas-env-history',
    title: 'History & Audit',
    icon: 'mdi-history',
    entries: [
      { key: 'Mode', value: env.BASYX_HISTORY_MODE || 'off' },
      { key: 'Snapshots', value: env.BASYX_HISTORY_FULL_SNAPSHOT_INTERVAL || '1' },
      { key: 'Immutability', value: env.BASYX_HISTORY_IMMUTABILITY || 'none' },
      { key: 'Audit identity', value: env.BASYX_AUDIT_IDENTITY_MODE || 'none' },
      {
        key: 'WORM evidence',
        value: boolChip(env.BASYX_HISTORY_EVIDENCE_ENABLED).value,
        color: boolChip(env.BASYX_HISTORY_EVIDENCE_ENABLED).color,
      },
    ],
  };

  const observabilitySection: SummarySection = {
    id: 'aas-env-observability',
    title: 'Logging & OpenTelemetry',
    icon: 'mdi-chart-timeline-variant-shimmer',
    entries: [
      { key: 'Log format', value: env.LOGGING_FORMAT || 'text' },
      { key: 'Log level', value: env.LOGGING_LEVEL || 'info' },
      { key: 'Trace exporter', value: env.OTEL_TRACES_EXPORTER || 'none' },
      { key: 'Metrics exporter', value: env.OTEL_METRICS_EXPORTER || 'none' },
      { key: 'OTLP endpoint', value: env.OTEL_EXPORTER_OTLP_ENDPOINT || 'n/a' },
    ],
  };

  const sections =
    nodeId === 'ovw-aas-environment-integrations'
      ? [integrationSection]
      : nodeId === 'ovw-aas-environment-security'
        ? [securitySection]
        : nodeId === 'ovw-aas-environment-history'
          ? [historySection]
          : nodeId === 'ovw-aas-environment-observability'
            ? [observabilitySection]
            : nodeId === 'ovw-aas-environment-summary'
              ? [runtimeSection]
              : [
                  runtimeSection,
                  integrationSection,
                  securitySection,
                  historySection,
                  observabilitySection,
                ];

  return {
    icon: 'mdi-server-outline',
    description:
      'Quick operational overview of the AAS Environment including integration and security status.',
    sections,
  };
}

function buildPostgresSummary(): SummaryPayload {
  const services = readComposeServices();
  const service = services.db;
  const env = readServiceEnvironment(service);

  return {
    icon: 'mdi-database',
    description: 'PostgreSQL baseline for all BaSyx Go persistence in this starter.',
    sections: [
      {
        id: 'postgres-runtime',
        title: 'Database Settings',
        icon: 'mdi-database-cog-outline',
        entries: [
          { key: 'Container', value: service?.container_name || 'n/a' },
          { key: 'Image', value: service?.image || 'n/a' },
          { key: 'Database', value: env.POSTGRES_DB || 'basyxTestDB' },
          { key: 'User', value: env.POSTGRES_USER || 'admin' },
          { key: 'External Port', value: readExternalPort(service) },
        ],
      },
    ],
  };
}

function buildBasyxConfigurationSummary(): SummaryPayload {
  const services = readComposeServices();
  const service = services.basyx_configuration;
  const env = readServiceEnvironment(service);

  return {
    icon: 'mdi-tune-variant',
    description: 'Connection settings used by the BaSyx Configuration Service.',
    sections: [
      {
        id: 'basyx-config-service',
        title: 'Connection Settings',
        icon: 'mdi-database-sync-outline',
        entries: [
          { key: 'Container', value: service?.container_name || 'n/a' },
          { key: 'Image', value: service?.image || 'n/a' },
          { key: 'Postgres Host', value: env.POSTGRES_HOST || 'db' },
          { key: 'Postgres Port', value: env.POSTGRES_PORT || '5432' },
          { key: 'Database', value: env.POSTGRES_DBNAME || 'basyxTestDB' },
        ],
      },
    ],
  };
}

function buildUiSummary(nodeId: string): SummaryPayload {
  const services = readComposeServices();
  const service = services['aas-ui'];
  const env = readServiceEnvironment(service);
  const infraComponents = readInfraComponents();

  const summarySection: SummarySection = {
    id: 'aas-ui-runtime',
    title: 'Runtime & Access',
    icon: 'mdi-monitor-dashboard',
    entries: [
      { key: 'Container', value: service?.container_name || 'n/a' },
      { key: 'Image', value: service?.image || 'n/a' },
      { key: 'External Port', value: readExternalPort(service) },
      { key: 'BASE_PATH', value: env.BASE_PATH || '/' },
      {
        key: 'ENDPOINT_CONFIG_AVAILABLE',
        value: boolChip(env.ENDPOINT_CONFIG_AVAILABLE).value,
        color: boolChip(env.ENDPOINT_CONFIG_AVAILABLE).color,
      },
    ],
  };

  const behaviorSection: SummarySection = {
    id: 'aas-ui-behavior',
    title: 'Behavior',
    icon: 'mdi-cog-outline',
    entries: [
      {
        key: 'ALLOW_EDITING',
        value: boolChip(env.ALLOW_EDITING).value,
        color: boolChip(env.ALLOW_EDITING).color,
      },
      {
        key: 'ALLOW_UPLOADING',
        value: boolChip(env.ALLOW_UPLOADING).value,
        color: boolChip(env.ALLOW_UPLOADING).color,
      },
      {
        key: 'ALLOW_LOGOUT',
        value: boolChip(env.ALLOW_LOGOUT).value,
        color: boolChip(env.ALLOW_LOGOUT).color,
      },
      {
        key: 'SM_VIEWER_EDITOR',
        value: boolChip(env.SM_VIEWER_EDITOR).value,
        color: boolChip(env.SM_VIEWER_EDITOR).color,
      },
      { key: 'START_PAGE_ROUTE_NAME', value: env.START_PAGE_ROUTE_NAME || 'AASViewer' },
    ],
  };

  const brandingSection: SummarySection = {
    id: 'aas-ui-branding',
    title: 'Corporate Design',
    icon: 'mdi-palette-outline',
    entries: [
      { key: 'PRIMARY_LIGHT_COLOR', value: env.PRIMARY_LIGHT_COLOR || 'default' },
      { key: 'PRIMARY_DARK_COLOR', value: env.PRIMARY_DARK_COLOR || 'default' },
      { key: 'LOGO_LIGHT_PATH', value: env.LOGO_LIGHT_PATH || 'default' },
      { key: 'LOGO_DARK_PATH', value: env.LOGO_DARK_PATH || 'default' },
      {
        key: 'Custom Logo Volume',
        value: service?.volumes?.includes('./logo:/usr/src/app/dist/Logo')
          ? 'Mounted'
          : 'Not mounted',
        color: service?.volumes?.includes('./logo:/usr/src/app/dist/Logo') ? 'success' : 'default',
      },
    ],
  };

  const infraSection: SummarySection = {
    id: 'aas-ui-infra',
    title: 'Infrastructure (basyx-infra.yml)',
    icon: 'mdi-lan-connect',
    entries: [
      {
        key: 'AAS Discovery',
        value: String(infraComponents.aasDiscovery?.['baseUrl'] || 'n/a'),
      },
      {
        key: 'AAS Registry',
        value: String(infraComponents.aasRegistry?.['baseUrl'] || 'n/a'),
      },
      {
        key: 'Submodel Registry',
        value: String(infraComponents.submodelRegistry?.['baseUrl'] || 'n/a'),
      },
      {
        key: 'AAS Repository',
        value: String(infraComponents.aasRepository?.['baseUrl'] || 'n/a'),
      },
      {
        key: 'Submodel Repository',
        value: String(infraComponents.submodelRepository?.['baseUrl'] || 'n/a'),
      },
      {
        key: 'Registry Integration',
        value: String(infraComponents.aasRepository?.['hasRegistryIntegration'] ?? 'n/a'),
      },
      {
        key: 'Discovery Integration',
        value: String(infraComponents.aasRegistry?.['hasDiscoveryIntegration'] ?? 'n/a'),
      },
    ],
  };

  const sections =
    nodeId === 'ovw-aas-ui-behavior'
      ? [behaviorSection]
      : nodeId === 'ovw-aas-ui-branding'
        ? [brandingSection]
        : nodeId === 'ovw-aas-ui-infra'
          ? [infraSection]
          : nodeId === 'ovw-aas-ui-summary'
            ? [summarySection]
            : [summarySection, behaviorSection, brandingSection, infraSection];

  return {
    icon: 'mdi-monitor-dashboard',
    description:
      'Consolidated AAS Web UI overview with runtime, behavior, branding, and infrastructure links.',
    sections,
  };
}

function buildInfluxdbSummary(): SummaryPayload {
  const services = readComposeServices();
  const service = services.influxdb;
  const env = readServiceEnvironment(service);

  return {
    icon: 'mdi-chart-line',
    description: 'InfluxDB settings used for optional time-series storage.',
    sections: [
      {
        id: 'influxdb-summary',
        title: 'Runtime & Storage',
        icon: 'mdi-database-outline',
        entries: [
          { key: 'Container', value: service?.container_name || 'n/a' },
          { key: 'Image', value: service?.image || 'n/a' },
          { key: 'External Port', value: readExternalPort(service) },
          { key: 'Organization', value: env.DOCKER_INFLUXDB_INIT_ORG || 'n/a' },
          { key: 'Bucket', value: env.DOCKER_INFLUXDB_INIT_BUCKET || 'n/a' },
        ],
      },
    ],
  };
}

function buildTelegrafSummary(): SummaryPayload {
  const services = readComposeServices();
  const service = services.telegraf;

  return {
    icon: 'mdi-pulse',
    description: 'Telegraf collector setup for optional time-series ingestion.',
    sections: [
      {
        id: 'telegraf-summary',
        title: 'Collector Setup',
        icon: 'mdi-radar',
        entries: [
          { key: 'Container', value: service?.container_name || 'n/a' },
          { key: 'Image', value: service?.image || 'n/a' },
          {
            key: 'Config Mount',
            value: service?.volumes?.includes(
              './telegraf/telegraf.conf:/etc/telegraf/telegraf.conf:ro'
            )
              ? 'Configured'
              : 'Missing',
            color: service?.volumes?.includes(
              './telegraf/telegraf.conf:/etc/telegraf/telegraf.conf:ro'
            )
              ? 'success'
              : 'warning',
          },
          {
            key: 'Depends On',
            value: Array.isArray(service?.depends_on) ? service.depends_on.join(', ') : 'n/a',
          },
        ],
      },
    ],
  };
}

watch(
  () => basyxConfig.value,
  newConfig => {
    items.value = newConfig;
    openItems.value = newConfig.map((item: TreeItem) => item.id);
  },
  { immediate: true }
);

watch(
  () => active.value,
  newActive => {
    if (newActive && newActive.length > 0 && newActive[0]) {
      openOutputDialog(newActive[0]);
    }
  },
  { immediate: true }
);
</script>
