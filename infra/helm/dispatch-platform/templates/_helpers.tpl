{{- define "dispatch.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "dispatch.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "dispatch.componentName" -}}
{{- printf "%s-%s" (include "dispatch.fullname" .root) .name | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "dispatch.selectorLabels" -}}
app.kubernetes.io/name: {{ .name }}
app.kubernetes.io/instance: {{ .root.Release.Name }}
{{- end -}}

{{- define "dispatch.commonLabels" -}}
{{ include "dispatch.selectorLabels" . }}
app.kubernetes.io/part-of: dispatch-platform
app.kubernetes.io/component: {{ .component }}
app.kubernetes.io/managed-by: {{ .root.Release.Service }}
{{- end -}}

{{/* Hardened non-root container security context. Call with (dict "uid" <id>). */}}
{{- define "dispatch.containerSecurity" -}}
runAsNonRoot: true
runAsUser: {{ .uid }}
runAsGroup: {{ .uid }}
allowPrivilegeEscalation: false
capabilities:
  drop:
    - ALL
{{- end -}}
