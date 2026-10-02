{{/*
Expand the name of the chart.
*/}}
{{- define "kubilitics.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "kubilitics.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- printf "%s" $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "kubilitics.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "kubilitics.labels" -}}
helm.sh/chart: {{ include "kubilitics.chart" . }}
app.kubernetes.io/name: {{ include "kubilitics.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "kubilitics.selectorLabels" -}}
app.kubernetes.io/name: {{ include "kubilitics.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Returns "true" when the data volume should fall back to a non-persistent
emptyDir instead of a PersistentVolumeClaim: persistence is enabled, no
storageClass was explicitly chosen, and no default StorageClass exists on
the cluster. The PVC would otherwise never bind (pod stuck Pending forever
with "unbound immediate PersistentVolumeClaims").

CAVEAT: this relies on Helm's `lookup` function, which only queries the live
API server during a real `helm install`/`helm upgrade`. It returns an empty
result during `helm template`, `helm install --dry-run`, `helm lint`, and
most GitOps tools that render charts without lookups enabled (e.g. ArgoCD's
default Helm rendering) — those will always see "no default StorageClass"
and render the emptyDir branch, which can differ from what an actual `helm
install` against the same cluster would do. If you manage this chart via a
GitOps tool with lookups disabled, set persistence.storageClass explicitly
to get a deterministic, lookup-independent render.
*/}}
{{- define "kubilitics.persistence.useEmptyDir" -}}
{{- $fallback := false -}}
{{- if and .Values.persistence.enabled (not .Values.persistence.storageClass) -}}
{{- $hasDefault := false -}}
{{- range (lookup "storage.k8s.io/v1" "StorageClass" "" "").items -}}
{{- $ann := default dict .metadata.annotations -}}
{{- if or (eq (get $ann "storageclass.kubernetes.io/is-default-class") "true") (eq (get $ann "storageclass.beta.kubernetes.io/is-default-class") "true") -}}
{{- $hasDefault = true -}}
{{- end -}}
{{- end -}}
{{- if not $hasDefault -}}
{{- $fallback = true -}}
{{- end -}}
{{- end -}}
{{- $fallback -}}
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "kubilitics.serviceAccountName" -}}
{{- if .Values.serviceAccount.name }}
{{- .Values.serviceAccount.name }}
{{- else }}
{{- include "kubilitics.fullname" . }}
{{- end }}
{{- end }}

{{/*
Create the name of the ConfigMap
*/}}
{{- define "kubilitics.configMapName" -}}
{{- if .Values.configMap.name }}
{{- .Values.configMap.name }}
{{- else }}
{{- include "kubilitics.fullname" . }}-config
{{- end }}
{{- end }}

{{/*
Create the name of the Secret
*/}}
{{- define "kubilitics.secretName" -}}
{{- if .Values.secret.name }}
{{- .Values.secret.name }}
{{- else }}
{{- include "kubilitics.fullname" . }}-secret
{{- end }}
{{- end }}

{{/*
Create image pull secrets if specified
*/}}
{{- define "kubilitics.imagePullSecrets" -}}
{{- if .Values.imagePullSecrets }}
imagePullSecrets:
{{- range .Values.imagePullSecrets }}
  - name: {{ . }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create security context for pod
*/}}
{{- define "kubilitics.podSecurityContext" -}}
{{- if .Values.podSecurityContext }}
{{- toYaml .Values.podSecurityContext }}
{{- else }}
runAsNonRoot: true
runAsUser: 1000
fsGroup: 1000
{{- end }}
{{- end }}

{{/*
Create security context for container
*/}}
{{- define "kubilitics.containerSecurityContext" -}}
{{- if .Values.containerSecurityContext }}
{{- toYaml .Values.containerSecurityContext }}
{{- else }}
allowPrivilegeEscalation: false
capabilities:
  drop:
    - ALL
readOnlyRootFilesystem: false
{{- end }}
{{- end }}

{{/*
Create the name of the AI Secret
*/}}
{{- define "kubilitics.aiSecretName" -}}
{{- if .Values.ai.secret.name }}
{{- .Values.ai.secret.name }}
{{- else }}
{{- include "kubilitics.fullname" . }}-ai-secret
{{- end }}
{{- end }}

{{/*
Create the name of the Frontend ConfigMap
*/}}
{{- define "kubilitics.frontendConfigMapName" -}}
{{- if .Values.frontend.configMap.name }}
{{- .Values.frontend.configMap.name }}
{{- else }}
{{- include "kubilitics.fullname" . }}-frontend-config
{{- end }}
{{- end }}

{{/*
Create the name of the PostgreSQL Secret
*/}}
{{- define "kubilitics.postgresqlSecretName" -}}
{{- if .Values.database.postgresql.secretName }}
{{- .Values.database.postgresql.secretName }}
{{- else }}
{{- include "kubilitics.fullname" . }}-postgresql
{{- end }}
{{- end }}
