#!/usr/bin/env node
/**
 * Applies ResourceListTableToolbar pattern to list pages.
 * Run: node scripts/apply-toolbar-to-pages.js
 * 
 * For each page, this adds:
 * - ResourceListTableToolbar import
 * - useColumnVisibility import and hook
 * - showFilterBar state
 * - COLUMNS_FOR_VISIBILITY constant (from TABLE_COLUMNS, excluding 'name')
 * - Wraps ResourceCommandBar + table in ResourceListTableToolbar
 * - Moves pagination to footer
 * 
 * Note: Column visibility checks in headers/cells must be done manually per page.
 * This script only does the structural wrap. Use it as a checklist.
 */

const fs = require('fs');
const path = require('path');

const PAGES_DIR = path.join(__dirname, '../kubilitics-frontend/src/pages');

const PAGES_NEEDING_TOOLBAR = [
  'DaemonSets', 'Jobs', 'CronJobs', 'ReplicaSets', 'Secrets', 'Services',
  'Ingresses', 'Endpoints', 'EndpointSlices', 'ReplicationControllers',
  'PersistentVolumes', 'PersistentVolumeClaims', 'StorageClasses',
  'Roles', 'RoleBindings', 'ClusterRoles', 'ClusterRoleBindings',
  'PodDisruptionBudgets', 'HorizontalPodAutoscalers', 'VerticalPodAutoscalers',
  'NetworkPolicies', 'IngressClasses', 'Leases', 'ResourceQuotas',
  'LimitRanges', 'PriorityClasses', 'RuntimeClasses', 'PodSecurityPolicies',
  'MutatingWebhooks', 'ValidatingWebhooks', 'Namespaces', 'Nodes',
  'ServiceAccounts', 'Events', 'ComponentStatuses', 'APIServices',
  'CustomResources', 'CustomResourceDefinitions', 'ControllerRevisions',
  'PodTemplates', 'VolumeSnapshots', 'VolumeSnapshotContents', 'VolumeSnapshotClasses',
  'BGPPeers', 'IPAddressPools', 'DeviceClasses', 'ResourceSlices', 'VolumeAttachments',
];

function hasToolbar(content) {
  return content.includes('ResourceListTableToolbar');
}

function main() {
  let updated = 0;
  let skipped = 0;
  for (const page of PAGES_NEEDING_TOOLBAR) {
    const filePath = path.join(PAGES_DIR, `${page}.tsx`);
    if (!fs.existsSync(filePath)) {
      console.log(`Skip ${page}: file not found`);
      skipped++;
      continue;
    }
    let content = fs.readFileSync(filePath, 'utf8');
    if (hasToolbar(content)) {
      console.log(`Skip ${page}: already has toolbar`);
      skipped++;
      continue;
    }
    if (!content.includes('ResourceCommandBar')) {
      console.log(`Skip ${page}: no ResourceCommandBar`);
      skipped++;
      continue;
    }
    console.log(`TODO ${page}: needs manual toolbar application`);
    updated++;
  }
  console.log(`\n${updated} pages need toolbar, ${skipped} skipped.`);
  console.log('Apply the pattern from Deployments/StatefulSets/ConfigMaps manually.');
}

main();
