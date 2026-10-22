<template>
  <v-container :class="props.compact ? 'pt-4 px-2' : 'pt-8'">
    <v-list
      nav
      slim
      :width="props.compact ? undefined : 200"
      rounded
      color="primary"
      :lines="false"
      density="compact"
      class="bg-background"
    >
      <v-list-subheader class="text-high-emphasis font-weight-black text-uppercase"
        >Getting Started</v-list-subheader
      >
      <v-list-item
        title="Introduction"
        to="/get-started/introduction"
        :class="isActive('/get-started/introduction') ? 'text-primary' : 'text-subheader'"
      />
      <v-list-item
        title="Application"
        to="/get-started/application"
        :class="isActive('/get-started/application') ? 'text-primary' : 'text-subheader'"
      />

      <v-list-subheader class="text-high-emphasis font-weight-black text-uppercase mt-5"
        >Behaviour</v-list-subheader
      >
      <v-list-item
        title="BaSyx Runtime"
        to="/get-started/behaviour/runtime"
        :class="isActive('/get-started/behaviour/runtime') ? 'text-primary' : 'text-subheader'"
      />
      <v-list-item
        title="Persistence Backend"
        to="/get-started/behaviour/persistence"
        :class="isActive('/get-started/behaviour/persistence') ? 'text-primary' : 'text-subheader'"
      />
      <v-list-item
        title="History and Audit"
        to="/get-started/behaviour/history"
        :class="isActive('/get-started/behaviour/history') ? 'text-primary' : 'text-subheader'"
      />
      <v-list-item
        title="Eventing"
        to="/get-started/behaviour/eventing"
        :class="isActive('/get-started/behaviour/eventing') ? 'text-primary' : 'text-subheader'"
      />
      <v-list-item
        title="Time Series Data"
        to="/get-started/behaviour/time-series"
        :class="isActive('/get-started/behaviour/time-series') ? 'text-primary' : 'text-subheader'"
      />

      <v-list-subheader class="text-high-emphasis font-weight-black text-uppercase mt-5"
        >Visualisation</v-list-subheader
      >
      <v-list-item
        title="AAS User Interface"
        to="/get-started/visualization/ui"
        :class="isActive('/get-started/visualization/ui') ? 'text-primary' : 'text-subheader'"
      />
      <v-list-item
        title="Corporate Design"
        to="/get-started/visualization/corporate-design"
        :class="
          isActive('/get-started/visualization/corporate-design')
            ? 'text-primary'
            : 'text-subheader'
        "
      />

      <v-list-subheader class="text-high-emphasis font-weight-black text-uppercase mt-5"
        >Deployment</v-list-subheader
      >
      <v-list-item
        title="AAS Integration"
        to="/get-started/deployment/integration"
        :class="isActive('/get-started/deployment/integration') ? 'text-primary' : 'text-subheader'"
      />
      <v-list-item
        title="Additional Services"
        to="/get-started/deployment/additional-services"
        :class="
          isActive('/get-started/deployment/additional-services')
            ? 'text-primary'
            : 'text-subheader'
        "
      />
      <v-list-item
        title="Container Config"
        to="/get-started/deployment/container-config"
        :class="
          isActive('/get-started/deployment/container-config') ? 'text-primary' : 'text-subheader'
        "
      />
      <v-list-item
        title="Logging and Telemetry"
        to="/get-started/deployment/observability"
        :class="
          isActive('/get-started/deployment/observability') ? 'text-primary' : 'text-subheader'
        "
      />
      <v-list-item
        title="Access Control"
        to="/get-started/deployment/access-control"
        :class="
          isActive('/get-started/deployment/access-control') ? 'text-primary' : 'text-subheader'
        "
      />

      <v-list-subheader class="text-high-emphasis font-weight-black text-uppercase mt-5"
        >Download</v-list-subheader
      >
      <v-list-item
        title="Download BaSyx"
        to="/get-started/download"
        :class="isActive('/get-started/download') ? 'text-primary' : 'text-subheader'"
      />
    </v-list>
  </v-container>
</template>

<script setup lang="ts">
import { useRoute } from 'vue-router';

defineOptions({
  name: 'MenuList',
});

const props = withDefaults(
  defineProps<{
    compact?: boolean;
  }>(),
  {
    compact: false,
  }
);

const route = useRoute();

function isActive(path: string): boolean {
  return route.path === path;
}
</script>
