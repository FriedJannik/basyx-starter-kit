<template>
  <v-container class="py-0 px-4 px-sm-8 px-md-12" fluid>
    <v-breadcrumbs class="px-0 pb-0 text-body-2 mb-3" divider="›" :items="breadcrumbs" />
    <h1 class="mb-8 text-header">AAS Integration</h1>
    <p class="text-normalText mt-8 mb-5 text-subtitle-1">
      During this step, you are able to provide your own Asset Administration Shell files. They will
      be included automatically when you start BaSyx after you finished this setup process.
      Supported AAS file formats are <v-kbd>AASX</v-kbd>, <v-kbd>XML</v-kbd> and
      <v-kbd>JSON</v-kbd>.
    </p>
    <ClientOnly>
      <!-- AAS File Input -->
      <v-file-input
        v-model="aasFilesInput"
        variant="solo-filled"
        prepend-inner-icon="$file"
        prepend-icon=""
        label="AAS File Upload"
        density="compact"
        multiple
        :accept="['.aasx', '.xml', '.json']"
        @update:model-value="uploadAasFiles()"
      >
        <template #append-inner>
          <v-btn
            size="small"
            variant="tonal"
            color="primary"
            style="right: -4px"
            @click.stop="uploadAasFiles()"
            >Upload</v-btn
          >
        </template>
      </v-file-input>
      <!-- Uploaded AAS Files -->
      <v-table v-if="uploadedAasFiles.length > 0" style="border-radius: 4px">
        <thead>
          <tr class="bg-tableOdd">
            <th class="text-subtitle-1">Name</th>
            <th class="text-subtitle-1">Format</th>
            <th style="text-align: right" class="text-subtitle-1">Size</th>
            <th style="text-align: right" />
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(aasFile, index) in uploadedAasFiles"
            :key="aasFile.name"
            :class="index % 2 === 0 ? 'tableEven' : 'bg-tableOdd'"
          >
            <td>{{ aasFile?.name.split('.').slice(0, -1).join('.') }}</td>
            <td>
              {{
                aasFile?.name && aasFile.name.includes('.')
                  ? aasFile.name.split('.').pop()?.toUpperCase()
                  : ''
              }}
            </td>
            <td style="text-align: right">{{ Math.round(aasFile.size / 1024) }} KB</td>
            <td style="text-align: right">
              <v-btn icon variant="plain" size="small" @click="uploadedAasFiles.splice(index, 1)">
                <v-icon>mdi-delete</v-icon>
              </v-btn>
            </td>
          </tr>
        </tbody>
      </v-table>
      <template #fallback>
        <v-alert color="primary" variant="outlined" class="bg-alertCard mt-8 mb-8">
          Loading AAS upload settings...
        </v-alert>
      </template>
    </ClientOnly>
    <v-divider class="mt-12 mb-8" />
    <!-- BaSyx Component Integrations -->
    <h2 class="text-header">BaSyx Component Integrations</h2>
    <p class="text-normalText mt-8 mb-8 text-subtitle-1">
      One advantage of BaSyx is the integration of components with each other. This includes but is
      not limited to the automatic registration of Digital Twins after they are added to the
      environment.
    </p>
    <!-- Alert for Integrations -->
    <v-alert color="alertCard" class="mb-8">
      <v-row align="center">
        <v-col cols="auto" class="pr-0">
          <v-icon color="subheader">mdi-alert-circle-outline</v-icon>
        </v-col>
        <v-col>
          <div class="font-weight-medium text-header">Important note</div>
        </v-col>
      </v-row>
      <p class="text-subheader font-weight-medium ms-0 ms-sm-12 mt-2">
        Registry and discovery integrations are configured in the Application step and are enabled
        by default (opt-out). This page focuses on preloading your AAS files.
      </p>
    </v-alert>
    <!-- Navigation to previous and next page -->
    <v-card-actions class="px-0 mb-8">
      <v-btn
        variant="tonal"
        prepend-icon="mdi-arrow-left"
        to="/get-started/visualization/corporate-design"
        >Back</v-btn
      >
      <v-spacer />
      <v-btn
        variant="tonal"
        color="primary"
        append-icon="mdi-arrow-right"
        to="/get-started/deployment/additional-services"
        >Next</v-btn
      >
    </v-card-actions>
  </v-container>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useAppStore } from '@/stores/app';

defineOptions({
  name: 'Integration',
});

useSeoMeta({
  title: 'AAS Integration | Eclipse BaSyx™',
  ogTitle: 'AAS Integration | Eclipse BaSyx™',
});

const appStore = useAppStore();

const breadcrumbs = ref([
  { title: 'Home', to: '/' },
  { title: 'Get Started', to: '/get-started/introduction' },
  { title: 'AAS Integration', to: '/get-started/deployment/integration' },
]);

const aasFilesInput = ref<File[] | undefined>(undefined);
const uploadedAasFiles = ref<File[]>([]);

const aasFilesStore = computed(() => appStore.getAasFiles);

function areFilesEqual(left: File, right: File): boolean {
  return (
    left.name === right.name &&
    left.size === right.size &&
    left.type === right.type &&
    left.lastModified === right.lastModified
  );
}

function areFileListsEqual(left: File[] | undefined, right: File[] | undefined): boolean {
  if (!left && !right) {
    return true;
  }
  const leftFiles = left || [];
  const rightFiles = right || [];

  if (leftFiles.length !== rightFiles.length) {
    return false;
  }

  return leftFiles.every((file, index) => {
    const rightFile = rightFiles[index];
    return rightFile ? areFilesEqual(file, rightFile) : false;
  });
}

watch(
  uploadedAasFiles,
  newVal => {
    const nextStoreFiles = newVal.length > 0 ? [...newVal] : undefined;
    if (!areFileListsEqual(aasFilesStore.value, nextStoreFiles)) {
      appStore.setAasFiles(nextStoreFiles);
    }
  },
  { deep: true }
);

watch(
  aasFilesStore,
  files => {
    const nextLocalFiles = files ? [...files] : [];
    if (!areFileListsEqual(uploadedAasFiles.value, nextLocalFiles)) {
      uploadedAasFiles.value = nextLocalFiles;
    }
  },
  { immediate: true }
);

function uploadAasFiles() {
  if (aasFilesInput.value) {
    uploadedAasFiles.value.push(...aasFilesInput.value);
    aasFilesInput.value = undefined;
  }
}
</script>
