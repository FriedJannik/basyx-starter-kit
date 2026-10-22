<template>
  <v-container class="py-0 px-4 px-sm-8 px-md-12" fluid>
    <v-breadcrumbs class="px-0 pb-0 text-body-2 mb-3" divider="›" :items="breadcrumbs" />
    <h1 class="mb-8 text-header">Download Your BaSyx Setup</h1>

    <ContactUs />

    <p class="text-normalText mt-8 mb-5 text-subtitle-1">
      Your BaSyx setup is now complete. Click on <code class="text-subheader">Download</code> and
      extract the zip file to your device.
    </p>
    <p class="text-normalText mt-3 mb-2 text-subtitle-1">
      Run the following command in a terminal to start the BaSyx Containers:
    </p>
    <v-alert color="primary" variant="outlined" class="bg-alertCard mt-8 mb-8 pr-1 py-1">
      <v-row align="center">
        <v-col>
          <code class="text-subheader font-weight-medium">docker compose up -d</code>
        </v-col>
        <v-spacer />
        <v-fade-transition>
          <v-col v-if="copyIcon === 'mdi-clipboard-check-outline'" cols="auto" class="pr-0">
            <span class="text-subheader">copied</span>
          </v-col>
        </v-fade-transition>
        <v-col cols="auto">
          <v-btn variant="plain" :icon="copyIcon" color="normalText" @click="copyToClipboard()" />
        </v-col>
      </v-row>
    </v-alert>

    <v-btn
      class="mb-8"
      variant="tonal"
      block
      append-icon="mdi-download"
      color="success"
      @click="downloadAsZip()"
      >Download BaSyx Setup</v-btn
    >

    <v-alert v-if="downloadError" class="mb-8" type="error" variant="tonal">
      {{ downloadError }}
    </v-alert>

    <v-divider class="mb-8" />
    <h2 class="text-header">Share Current Configuration</h2>
    <p class="text-normalText mt-8 mb-5 text-subtitle-1">
      Copy the current configuration link to reproduce setups, report issues, or share your
      configuration with teammates.
    </p>
    <v-text-field
      v-model="shareConfigLink"
      class="mb-3"
      variant="solo-filled"
      readonly
      label="Current configuration URL"
      hide-details
    >
      <template #append-inner>
        <v-btn
          variant="plain"
          :icon="copyConfigLinkIcon"
          color="normalText"
          @click.stop="copyConfigLinkToClipboard()"
        />
      </template>
    </v-text-field>

    <v-card-actions class="px-0 mb-8">
      <v-btn
        variant="tonal"
        prepend-icon="mdi-arrow-left"
        to="/get-started/deployment/access-control"
        >Back</v-btn
      >
    </v-card-actions>
  </v-container>
</template>

<script setup lang="ts">
import JSZip from 'jszip';
import { computed, onMounted, ref, watch } from 'vue';
import { useAppStore } from '@/stores/app';
import { addAasSuiteAssets } from '@/utils/aasSuiteAssets';
import { readServiceEnvironment } from '@/utils/dockerEnvironment';
import { getComposeServices } from '@/utils/optionalServices';
import { createPgAdminServersJson } from '@/utils/pgAdminServers';
import { generateRsaPrivateKeyPem } from '@/utils/rsaKey';
import { addOptionalSetupAssets } from '@/utils/setupAssets';
import { createSetupReadme } from '@/utils/setupReadme';
import { buildShareConfigUrl } from '@/utils/shareConfig';

defineOptions({
  name: 'Download',
});

useSeoMeta({
  title: 'Download | Eclipse BaSyx™',
  ogTitle: 'Download | Eclipse BaSyx™',
});

const appStore = useAppStore();

const breadcrumbs = ref([
  { title: 'Home', to: '/' },
  { title: 'Get Started', to: '/get-started/introduction' },
  { title: 'Download BaSyx', to: '/get-started/download' },
]);

const readmeFile = ref('');
const copyIcon = ref('mdi-clipboard-outline');
const shareConfigLink = ref('');
const copyConfigLinkIcon = ref('mdi-link-variant');
const downloadError = ref('');

const isTimeSeriesDataEnabled = computed(() => appStore.getTimeSeriesData);
const logoLightStore = computed(() => appStore.getLogoLight);
const logoDarkStore = computed(() => appStore.getLogoDark);
const iconStore = computed(() => appStore.getAppIcon);
const telegrafConfigStore = computed(() => appStore.getTelegrafConf);
const aasFilesStore = computed(() => appStore.getAasFiles);
const route = useRoute();

function updateShareConfigLink(): void {
  if (!import.meta.client) {
    return;
  }
  const pathWithQuery = route.fullPath.split('#')[0] || route.path;
  shareConfigLink.value = buildShareConfigUrl(
    window.location.origin,
    pathWithQuery,
    appStore.createSerializableSnapshot()
  );
}

function createReadme(): void {
  const thirdPartyServices = appStore.getThirdPartyServices;
  const additionalServicesNote = thirdPartyServices.length
    ? `\n## Additional services\n\nThis setup also starts: ${thirdPartyServices
        .map(service => `\`${service.id}\``)
        .join(
          ', '
        )}. Review their configuration in \`docker-compose.yml\` before starting the stack.\n`
    : '';
  readmeFile.value =
    createSetupReadme({
      externalBaseUrl: appStore.getExternalBaseUrl,
      aasEnvironmentExternalPort: appStore.getContainerPort('aas-environment'),
      aasEnvironmentContextPath: appStore.getContextPath('aas-environment'),
      aasUiExternalPort: appStore.getContainerPort('aas-ui'),
      aasUiBasePath: appStore.getContextPath('aas-ui'),
    }) + additionalServicesNote;
}

async function downloadAsZip(): Promise<void> {
  downloadError.value = '';
  const composeServices = getComposeServices() || {};
  const composeEnvironment = readServiceEnvironment(appStore.getDockerComposeConfig?.value);
  if (!composeServices.db && !composeEnvironment.POSTGRES_PASSWORD?.trim()) {
    downloadError.value =
      'Enter the external PostgreSQL password on the Persistence Backend page before downloading.';
    return;
  }
  if (
    composeEnvironment.BASYX_EVENTING_SINKS?.split(',').includes('amqp') &&
    !composeServices.rabbitmq &&
    composeEnvironment.BASYX_EVENTING_AMQP_USERNAME?.trim() &&
    !composeEnvironment.BASYX_EVENTING_AMQP_PASSWORD
  ) {
    downloadError.value =
      'Enter the external AMQP password on the Eventing page before downloading, or clear the username for anonymous access.';
    return;
  }
  if (composeServices.telegraf && !telegrafConfigStore.value) {
    downloadError.value =
      'Configure a valid Telegraf TOML file on the Time Series Data page before downloading.';
    return;
  }
  if (isTimeSeriesDataEnabled.value && !composeServices.influxdb) {
    const { url, token } = appStore.getExternalInfluxSettings;
    if (!url.trim() || !token.trim()) {
      downloadError.value =
        'Enter the external InfluxDB URL and API token on the Time Series Data page before downloading.';
      return;
    }
  }

  try {
    const privateKeyPem = await generateRsaPrivateKeyPem();
    const zip = new JSZip();

    const aasFolder = zip.folder('aas');
    if (aasFilesStore.value && aasFilesStore.value.length > 0) {
      aasFilesStore.value.forEach((file: File) => {
        aasFolder?.file(file.name, file);
      });
    }

    const basyxFolder = zip.folder('basyx');
    basyxFolder?.file('rsa-key.pem', privateKeyPem);
    const services = getComposeServices() || {};
    const environment = readServiceEnvironment(appStore.getDockerComposeConfig?.value);
    const infraValue = appStore.getBasyxInfraConfig?.value as
      { infrastructures?: Record<string, unknown> } | undefined;
    const infrastructures = infraValue?.infrastructures;
    const selectedInfra = infrastructures?.[String(infrastructures.default)] as
      { security?: { config?: { clientId?: string } } } | undefined;
    const passwordBytes =
      services.keycloak && environment.ABAC_ENABLED === 'true'
        ? crypto.getRandomValues(new Uint8Array(18))
        : undefined;
    const adminPassword = passwordBytes
      ? Array.from(passwordBytes, byte => byte.toString(16).padStart(2, '0')).join('')
      : undefined;
    const aasSuiteReadme = addAasSuiteAssets(zip, services);
    const supplementalReadme =
      aasSuiteReadme +
      addOptionalSetupAssets(zip, {
        services,
        environment,
        policyJson: appStore.accessPolicyJson,
        trustListJson: appStore.trustListJson,
        uiUrl: appStore.getAasWebUiExternalUrl,
        uiClientId: selectedInfra?.security?.config?.clientId || 'basyx-ui',
        adminPassword,
      });

    if (services.telegraf) {
      const telegrafFolder = zip.folder('telegraf');
      if (telegrafConfigStore.value) {
        telegrafFolder?.file('telegraf.conf', telegrafConfigStore.value);
      }
    }

    if (services.pgadmin) {
      const pgAdminFolder = zip.folder('pgadmin');
      pgAdminFolder?.file(
        'servers.json',
        createPgAdminServersJson(
          services.db
            ? readServiceEnvironment(appStore.getDockerComposeConfig?.value, 'db')
            : undefined
        )
      );
    }

    if (logoLightStore.value || logoDarkStore.value || iconStore.value) {
      const logoFolder = zip.folder('logo');
      if (logoLightStore.value) {
        logoFolder?.file(logoLightStore.value.name, logoLightStore.value);
      }
      if (logoDarkStore.value) {
        logoFolder?.file(logoDarkStore.value.name, logoDarkStore.value);
      }
      if (iconStore.value) {
        logoFolder?.file(iconStore.value.name, iconStore.value);
      }
    }

    const dockerComposeConfig = appStore.getDockerComposeConfigAsString.value;
    if (dockerComposeConfig && typeof dockerComposeConfig === 'string') {
      zip.file('docker-compose.yml', dockerComposeConfig);
    }

    const basyxInfraConfig = appStore.getBasyxInfraConfigAsString.value;
    if (basyxInfraConfig && typeof basyxInfraConfig === 'string') {
      zip.file('basyx-infra.yml', basyxInfraConfig);
    }

    zip.file('README.md', readmeFile.value + supplementalReadme);

    const content = await zip.generateAsync({ type: 'blob' });
    const a = document.createElement('a');
    const url = URL.createObjectURL(content);
    a.href = url;
    a.download = 'basyx-setup.zip';
    a.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error('Could not generate setup archive', error);
    downloadError.value =
      'Could not generate a unique signing key. Download the setup from a modern browser over HTTPS or localhost.';
  }
}

function copyToClipboard(): void {
  navigator.clipboard.writeText('docker compose up -d');
  copyIcon.value = 'mdi-clipboard-check-outline';
  setTimeout(() => {
    copyIcon.value = 'mdi-clipboard-outline';
  }, 2000);
}

function copyConfigLinkToClipboard(): void {
  if (!shareConfigLink.value) {
    return;
  }
  navigator.clipboard.writeText(shareConfigLink.value);
  copyConfigLinkIcon.value = 'mdi-check';
  setTimeout(() => {
    copyConfigLinkIcon.value = 'mdi-link-variant';
  }, 2000);
}

onMounted(() => {
  createReadme();
  updateShareConfigLink();
});

watch(
  () => route.fullPath,
  () => {
    updateShareConfigLink();
  }
);

watch(
  () => appStore.createSerializableSnapshot(),
  () => {
    createReadme();
    updateShareConfigLink();
  }
);
</script>
