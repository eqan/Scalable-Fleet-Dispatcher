{{- define "arqh.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "arqh.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "arqh.componentName" -}}
{{- printf "%s-%s" (include "arqh.fullname" .root) .name | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "arqh.selectorLabels" -}}
app.kubernetes.io/name: {{ .name }}
app.kubernetes.io/instance: {{ .root.Release.Name }}
{{- end -}}

{{- define "arqh.commonLabels" -}}
{{ include "arqh.selectorLabels" . }}
app.kubernetes.io/part-of: arqh-platform
app.kubernetes.io/component: {{ .component }}
app.kubernetes.io/managed-by: {{ .root.Release.Service }}
{{- end -}}

{{/* Hardened non-root container security context. Call with (dict "uid" <id>). */}}
{{- define "arqh.containerSecurity" -}}
runAsNonRoot: true
runAsUser: {{ .uid }}
runAsGroup: {{ .uid }}
allowPrivilegeEscalation: false
capabilities:
  drop:
    - ALL
{{- end -}}
