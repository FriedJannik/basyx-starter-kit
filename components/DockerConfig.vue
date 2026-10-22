<template>
  <v-slide-y-transition>
    <div>
      <h2 class="text-header">Container Image Tag</h2>
      <p class="text-normalText mt-8 mb-5 text-subtitle-1">
        Select a Docker image tag. You can also type a custom tag manually.
        <span v-if="isBasyxGoService">
          The AAS Environment and Configuration Service use the same tag; changing either updates
          both.
        </span>
      </p>
      <v-combobox
        :model-value="imageTag"
        variant="solo-filled"
        :items="availableTagItems"
        item-title="title"
        item-value="value"
        :return-object="false"
        :loading="loadingTags"
        :label="managedRepository ? `${managedRepository} tag` : 'Image tag'"
        hide-details="auto"
        hint="Defaults to latest, then newest non-SNAPSHOT if latest is unavailable."
        persistent-hint
        @update:model-value="updateImageTag"
      >
        <template #item="{ props: itemProps, item }">
          <v-list-item v-bind="itemProps">
            <template #append>
              <v-chip
                size="x-small"
                :color="tagCategoryColor(getItemCategory(item))"
                variant="tonal"
                class="text-caption"
              >
                {{ tagCategoryLabel(getItemCategory(item)) }}
              </v-chip>
            </template>
          </v-list-item>
        </template>
      </v-combobox>
      <p v-if="tagLoadError" class="text-caption text-error mt-1">{{ tagLoadError }}</p>
      <v-divider class="mt-6 mb-8" />

      <template v-if="hasPorts">
        <h2 class="text-header">Docker External Port</h2>
        <p class="text-normalText mt-8 mb-5 text-subtitle-1">
          The port that makes the container accessible from the outside.
        </p>
        <v-number-input
          v-model="externalPort"
          variant="solo-filled"
          hide-details
          @update:model-value="updateDockerPort"
        />
        <v-divider class="mt-6 mb-8" />
      </template>

      <h2 class="text-header">Docker Container Name</h2>
      <p class="text-normalText mt-8 mb-5 text-subtitle-1">The name of the Docker container.</p>
      <v-text-field
        v-model="containerName"
        variant="solo-filled"
        hide-details
        @update:model-value="updateContainerName"
      />

      <template v-if="showContextPath">
        <v-divider class="mt-6 mb-8" />
        <h2 class="text-header">{{ contextPathLabel }}</h2>
        <p class="text-normalText mt-8 mb-5 text-subtitle-1">
          {{ contextPathDescription }}
        </p>
        <v-text-field
          :model-value="contextPathInput"
          variant="solo-filled"
          :label="contextPathEnvKey"
          clearable
          hide-details
          @update:model-value="updateContextPath"
        />
      </template>
    </div>
  </v-slide-y-transition>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useAppStore } from '@/stores/app';
import { publishedPort, replacePublishedPort } from '@/utils/composePorts';
import {
  chooseDefaultTag,
  classifyTag,
  normalizeTagList,
  type TagCategory,
  type TagItem,
  toTagItems,
} from '@/utils/dockerTags';
import { normalizeContextPath } from '@/utils/externalUrls';

defineOptions({
  name: 'DockerConfig',
});

interface DockerComposeService {
  image?: string;
  ports?: string[];
  container_name?: string;
  environment?: Record<string, string> | string[];
}

const MANAGED_REPOSITORIES: Record<string, string> = {
  'aas-environment': 'eclipsebasyx/aasenvironment-go',
  'aas-ui': 'eclipsebasyx/aas-gui',
  basyx_configuration: 'eclipsebasyx/basyxconfigurationservice-go',
};

const props = defineProps<{ serviceName: string }>();

const appStore = useAppStore();

const externalPort = ref<number | undefined>(undefined);
const containerName = ref<string | undefined>(undefined);
const contextPath = ref<string | undefined>(undefined);
const imageTag = ref('');
const availableTagItems = ref<TagItem[]>([]);
const loadingTags = ref(false);
const tagLoadError = ref('');

const dockerComposeConfigObject = computed(() => appStore.getDockerComposeConfig);
const composeService = computed(() => {
  const compose = dockerComposeConfigObject.value?.value;
  if (!compose || typeof compose !== 'object' || !('services' in compose)) {
    return undefined;
  }
  return (compose.services as Record<string, DockerComposeService>)[props.serviceName];
});
const servicePort = computed(
  () => appStore.getContainerPort(props.serviceName) ?? readExternalPort(composeService.value)
);
const serviceContainerName = computed(
  () =>
    appStore.getContainerName(props.serviceName) ??
    composeService.value?.container_name ??
    props.serviceName
);
const managedRepository = computed(() => MANAGED_REPOSITORIES[props.serviceName] || '');
const isBasyxGoService = computed(
  () => props.serviceName === 'aas-environment' || props.serviceName === 'basyx_configuration'
);
const shouldForceLatestOption = computed(() => managedRepository.value === 'eclipsebasyx/aas-gui');
const showContextPath = computed(
  () => props.serviceName === 'aas-ui' || props.serviceName === 'aas-environment'
);
const contextPathEnvKey = computed(() =>
  props.serviceName === 'aas-environment' ? 'SERVER_CONTEXTPATH' : 'BASE_PATH'
);
const contextPathLabel = computed(() =>
  props.serviceName === 'aas-environment' ? 'AAS Environment Context Path' : 'UI Base Path'
);
const contextPathDescription = computed(() =>
  props.serviceName === 'aas-environment'
    ? 'Configure SERVER_CONTEXTPATH for the AAS Environment (for example /api/aas).'
    : 'Configure BASE_PATH for the AAS Web UI (for example /basyx-ui).'
);
const contextPathInput = computed(() => contextPath.value || '');

const hasPorts = computed(() => {
  const compose = dockerComposeConfigObject.value?.value;
  if (!compose || typeof compose !== 'object' || !('services' in compose)) {
    return false;
  }
  const services = compose.services as Record<string, DockerComposeService>;
  const service = services[props.serviceName];
  return Boolean(service?.ports && service.ports.length > 0);
});

function parseImageTag(image: string | undefined): string {
  if (!image) {
    return '';
  }
  const parts = image.split(':');
  if (parts.length < 2) {
    return '';
  }
  return parts[parts.length - 1] || '';
}

function readExternalPort(service: DockerComposeService | undefined): number | undefined {
  const portMapping = service?.ports?.[0];
  if (!portMapping) {
    return undefined;
  }
  const port = publishedPort(portMapping);
  return port !== undefined && Number.isInteger(port) && port > 0 ? port : undefined;
}

function resolveTagInput(tagInput: unknown): string {
  if (typeof tagInput === 'string') {
    return tagInput.trim();
  }
  if (!tagInput || typeof tagInput !== 'object') {
    return '';
  }

  if ('value' in tagInput && typeof tagInput.value === 'string') {
    return tagInput.value.trim();
  }
  if ('title' in tagInput && typeof tagInput.title === 'string') {
    return tagInput.title.trim();
  }
  if (
    'raw' in tagInput &&
    tagInput.raw &&
    typeof tagInput.raw === 'object' &&
    'value' in tagInput.raw &&
    typeof tagInput.raw.value === 'string'
  ) {
    return tagInput.raw.value.trim();
  }

  return '';
}

function getItemCategory(item: { raw?: unknown; value?: unknown }): TagCategory {
  if (
    item.raw &&
    typeof item.raw === 'object' &&
    'category' in item.raw &&
    typeof item.raw.category === 'string'
  ) {
    const category = item.raw.category;
    if (category === 'snapshot' || category === 'release' || category === 'other') {
      return category;
    }
  }
  if (typeof item.value === 'string') {
    return classifyTag(item.value, managedRepository.value);
  }
  return 'other';
}

function tagCategoryLabel(category: TagCategory): string {
  if (category === 'snapshot') {
    return 'Snapshot';
  }
  if (category === 'release') {
    return 'Release';
  }
  return 'Other';
}

function tagCategoryColor(category: TagCategory): string {
  if (category === 'snapshot') {
    return 'warning';
  }
  if (category === 'release') {
    return 'success';
  }
  return 'secondary';
}

function updateImageInService(
  service: DockerComposeService,
  tag: string,
  fallbackRepository = managedRepository.value
): void {
  const repository = fallbackRepository || (service.image ? service.image.split(':')[0] : '');
  if (!repository || !tag) {
    return;
  }
  service.image = `${repository}:${tag}`;
}

function setOrReplaceEnvVar(env: string[], key: string, value: string): void {
  const prefix = `${key}=`;
  const index = env.findIndex(item => item.startsWith(prefix));
  if (index >= 0) {
    env[index] = `${key}=${value}`;
  } else {
    env.push(`${key}=${value}`);
  }
}

function getEnvVar(env: string[], key: string): string | undefined {
  const prefix = `${key}=`;
  const entry = env.find(item => item.startsWith(prefix));
  if (!entry) {
    return undefined;
  }
  return entry.slice(prefix.length);
}

function normalizeContextPathInput(value: unknown): string | undefined {
  const normalizedPath = normalizeContextPath(String(value ?? '').replace(/\s+/g, ''));
  return normalizedPath || undefined;
}

function getNormalizedTagList(tags: string[]): string[] {
  return normalizeTagList(tags, {
    includeLatest: shouldForceLatestOption.value,
    includeSnapshot: true,
  });
}

async function ensureTagOptions(): Promise<void> {
  if (!managedRepository.value) {
    availableTagItems.value = imageTag.value
      ? toTagItems([imageTag.value], managedRepository.value)
      : [];
    return;
  }

  loadingTags.value = true;
  tagLoadError.value = '';
  try {
    const response = await fetch(
      `/api/docker-tags?repo=${encodeURIComponent(managedRepository.value)}`
    );
    if (!response.ok) {
      throw new Error(`Tag request failed: ${response.status}`);
    }
    const payload = (await response.json()) as { tags?: string[] };
    availableTagItems.value = toTagItems(
      getNormalizedTagList(payload.tags || []),
      managedRepository.value
    );
  } catch {
    tagLoadError.value = 'Could not load Docker Hub tags. You can still type a custom tag.';
    availableTagItems.value = toTagItems(getNormalizedTagList([]), managedRepository.value);
  } finally {
    loadingTags.value = false;
  }

  const availableTags = availableTagItems.value.map(item => item.value);
  if (!imageTag.value) {
    imageTag.value = chooseDefaultTag(availableTags, managedRepository.value);
    updateImageTag(imageTag.value);
    return;
  }

  if (imageTag.value === 'latest' && !availableTags.includes('latest')) {
    const fallbackTag = chooseDefaultTag(availableTags, managedRepository.value);
    imageTag.value = fallbackTag;
    updateImageTag(fallbackTag);
  }
}

watch(
  servicePort,
  newVal => {
    if (newVal) {
      externalPort.value = newVal;
    }
  },
  { immediate: true }
);

watch(
  serviceContainerName,
  newVal => {
    if (newVal) {
      containerName.value = newVal;
    }
  },
  { immediate: true }
);

watch(
  () => dockerComposeConfigObject.value?.value,
  async val => {
    if (!val || typeof val !== 'object' || !('services' in val)) {
      return;
    }

    const services = val.services as Record<string, DockerComposeService>;
    const service = services[props.serviceName];
    if (!service) {
      return;
    }

    const tagFromService = parseImageTag(service.image);
    imageTag.value = tagFromService;

    if (showContextPath.value) {
      if (
        props.serviceName === 'aas-ui' &&
        service.environment &&
        !Array.isArray(service.environment)
      ) {
        contextPath.value = normalizeContextPathInput(service.environment.BASE_PATH);
      }
      if (
        props.serviceName === 'aas-environment' &&
        service.environment &&
        Array.isArray(service.environment)
      ) {
        contextPath.value = normalizeContextPathInput(
          getEnvVar(service.environment, 'SERVER_CONTEXTPATH')
        );
      }
    }

    await ensureTagOptions();
  },
  { immediate: true }
);

function updateDockerPort(): void {
  if (
    !dockerComposeConfigObject.value?.value ||
    typeof dockerComposeConfigObject.value.value !== 'object' ||
    !externalPort.value
  ) {
    return;
  }

  const localDockerComposeConfig = { ...dockerComposeConfigObject.value };
  const dockerConfig = localDockerComposeConfig.value as {
    services: Record<string, DockerComposeService>;
  };
  const service = dockerConfig.services?.[props.serviceName];

  if (!service?.ports || !Array.isArray(service.ports) || service.ports.length === 0) {
    return;
  }

  if (props.serviceName === 'aas-environment') {
    service.ports[0] = `${externalPort.value}:${externalPort.value}`;
    if (service.environment && Array.isArray(service.environment)) {
      setOrReplaceEnvVar(service.environment, 'SERVER_PORT', String(externalPort.value));
    }
  } else {
    const currentMapping = service.ports[0];
    if (!currentMapping) {
      return;
    }
    service.ports[0] = replacePublishedPort(currentMapping, externalPort.value);
  }

  appStore.setDockerComposeConfig(localDockerComposeConfig);
  appStore.setContainerPort(props.serviceName, externalPort.value);
}

function updateContainerName(): void {
  if (
    !dockerComposeConfigObject.value?.value ||
    typeof dockerComposeConfigObject.value.value !== 'object'
  ) {
    return;
  }

  const localDockerComposeConfig = { ...dockerComposeConfigObject.value };
  const dockerConfig = localDockerComposeConfig.value as {
    services: Record<string, DockerComposeService>;
  };
  const service = dockerConfig.services?.[props.serviceName];
  if (service) {
    service.container_name = containerName.value;
  }

  appStore.setDockerComposeConfig(localDockerComposeConfig);
  appStore.setContainerName(props.serviceName, containerName.value);
}

function updateContextPath(value: unknown): void {
  const normalizedContextPath = normalizeContextPathInput(value);
  contextPath.value = normalizedContextPath;

  if (
    !dockerComposeConfigObject.value?.value ||
    typeof dockerComposeConfigObject.value.value !== 'object'
  ) {
    return;
  }

  const localDockerComposeConfig = { ...dockerComposeConfigObject.value };
  const dockerConfig = localDockerComposeConfig.value as {
    services: Record<string, DockerComposeService>;
  };
  const service = dockerConfig.services?.[props.serviceName];
  if (!service) {
    return;
  }

  if (props.serviceName === 'aas-ui') {
    if (!service.environment || Array.isArray(service.environment)) {
      service.environment = {};
    }
    if (normalizedContextPath) {
      (service.environment as Record<string, string>).BASE_PATH = normalizedContextPath;
    } else {
      delete (service.environment as Record<string, string>).BASE_PATH;
    }
  }

  if (props.serviceName === 'aas-environment') {
    if (!service.environment || !Array.isArray(service.environment)) {
      service.environment = [];
    }
    if (normalizedContextPath) {
      setOrReplaceEnvVar(service.environment, 'SERVER_CONTEXTPATH', normalizedContextPath);
    } else {
      service.environment = service.environment.filter(
        entry => !entry.startsWith('SERVER_CONTEXTPATH=')
      );
    }
  }

  appStore.setDockerComposeConfig(localDockerComposeConfig);
  appStore.setContextPath(props.serviceName, normalizedContextPath);
}

function updateImageTag(tagInput: unknown): void {
  const tag = resolveTagInput(tagInput);
  if (!tag) {
    return;
  }

  if (
    !dockerComposeConfigObject.value?.value ||
    typeof dockerComposeConfigObject.value.value !== 'object'
  ) {
    return;
  }

  const localDockerComposeConfig = { ...dockerComposeConfigObject.value };
  const dockerConfig = localDockerComposeConfig.value as {
    services: Record<string, DockerComposeService>;
  };
  const service = dockerConfig.services?.[props.serviceName];
  if (!service) {
    return;
  }

  if (props.serviceName === 'aas-environment' || props.serviceName === 'basyx_configuration') {
    appStore.setBasyxGoImageTag(props.serviceName, tag);
  } else {
    updateImageInService(service, tag);
    appStore.setDockerComposeConfig(localDockerComposeConfig);
  }
  imageTag.value = tag;
  if (!availableTagItems.value.some(item => item.value === tag)) {
    availableTagItems.value = [
      { title: tag, value: tag, category: classifyTag(tag, managedRepository.value) },
      ...availableTagItems.value,
    ];
  }
}
</script>
