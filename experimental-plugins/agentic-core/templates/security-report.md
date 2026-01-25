# Security Analysis Report

**Target:** {{ target }}
**Date:** {{ date }}
**Analysts:** {{ analysts | join(', ') }}

## Executive Summary

{{ summary }}

## Threat Model

### Attack Surface

{{ attack_surface }}

### Threat Vectors

{{ threat_vectors }}

## Vulnerabilities

{% for vuln in vulnerabilities %}

### {{ vuln.id }}: {{ vuln.title }}

**Severity:** {{ vuln.severity }}
**CWE:** {{ vuln.cwe }}

{{ vuln.description }}

**Location:** {{ vuln.location }}

**Remediation:**
{{ vuln.remediation }}

{% endfor %}

## Recommendations

{{ recommendations }}

## Action Items

{% for action in action_items %}

- [ ] {{ action }}
      {% endfor %}
