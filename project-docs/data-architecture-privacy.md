# Kubilitics Data Architecture & Privacy — Enterprise Data Governance Document

**Document Version:** 1.0
**Last Updated:** February 2026
**Classification:** Internal — Data Sensitive
**Audience:** Data architects, compliance officers, product leaders, platform engineers

---

## Executive Summary

Kubilitics handles multiple categories of sensitive data: Kubernetes cluster state, user credentials, AI investigation artifacts, and operational metrics. This document establishes the comprehensive data architecture and privacy governance framework that protects user data while enabling powerful cluster management and AI-driven operations.

The data governance model is built on three foundational principles:
1. **Data Minimization** — Only collect and process data necessary for stated purposes
2. **Privacy by Design** — Privacy and security controls are embedded in architecture
3. **User Control** — Users have visibility and control over their data

This document addresses data flows across all Kubilitics components (desktop, in-cluster, mobile), defines data classification and retention policies, maps GDPR and privacy compliance requirements, and establishes governance procedures for data handling.

---

## 1. Data Architecture Overview

Kubilitics processes data across multiple components and deployment models. Understanding these data flows is essential for security and privacy.

### 1.1 Component Architecture & Data Flows

**Desktop Deployment:**

```
User's Machine (macOS/Windows/Linux)
  ├─ Frontend (React)
  │   ├─ User Input: Queries, Commands, Configuration
  │   ├─ State: Cluster view, UI state, cached investigation results
  │   └─ Storage: Ephemeral (in-memory), Zustand stores
  │
  ├─ Backend (Go) — localhost:8080
  │   ├─ Input: REST API requests from Frontend
  │   ├─ Processing: Kubernetes API calls, User RBAC evaluation
  │   ├─ Output: Cluster state, investigation metadata
  │   └─ Storage: SQLite Database (encrypted at rest)
  │
  └─ AI Service (Go) — localhost:8081
      ├─ Input: Investigation requests from Backend
      ├─ Processing: Cluster state analysis, LLM API calls
      ├─ Output: Recommendations, investigation results
      └─ Storage: SQLite Database (encrypted, investigations)

External Communication:
  ├─ Kubernetes API: User's cluster (kubeconfig authentication)
  ├─ LLM Provider: OpenAI/Anthropic (API key authentication)
  └─ Update Service: kubilitics.io (version check, optional)
```

**In-Cluster Deployment:**

```
Kubernetes Cluster
  ├─ Kubilitics Namespace (dedicated)
  │   ├─ Frontend Pod (React)
  │   ├─ Backend Pod (Go) — port 8080
  │   │   ├─ RBAC: ServiceAccount with read access to cluster
  │   │   ├─ Storage: PostgreSQL (external database)
  │   │   └─ Secrets: kubeconfig, LLM API keys (Kubernetes Secrets)
  │   │
  │   └─ AI Service Pod (Go) — port 8081
  │       ├─ RBAC: Limited read-only access
  │       ├─ Storage: PostgreSQL (shared with Backend)
  │       └─ Communication: mTLS with Backend
  │
  ├─ Ingress Controller (Entry Point)
  │   └─ Routes HTTP/HTTPS to Frontend
  │
  └─ External Access
      ├─ Users: OIDC authentication (enterprise IdP)
      ├─ LLM Provider: External API calls (OpenAI, Anthropic)
      └─ Database: PostgreSQL (managed service or external)

Multi-Team Scenario:
  ├─ Team A: Access to namespaces "team-a-*" (RBAC-enforced)
  ├─ Team B: Access to namespaces "team-b-*" (RBAC-enforced)
  └─ Admin: Access to all namespaces (RBAC + Kubilitics Admin)
```

**Mobile Deployment:**

```
User's iOS/Android Device (Tauri Mobile)
  ├─ Frontend (React Native)
  │   ├─ User Input: Cluster queries, read-only operations
  │   ├─ Authentication: Biometric + Kubeconfig (encrypted)
  │   └─ Storage: Secure Enclave (iOS) / KeyStore (Android)
  │
  └─ Communication
      ├─ Backend: HTTPS + TLS Pinning (to user's Kubilitics instance)
      └─ Kubeconfig: User's cluster (via Backend proxy)

No Local Backend on Mobile:
  ├─ Mobile Connects to User's Desktop Backend
  ├─ Or: User's Kubilitics In-Cluster Instance
  ├─ Or: Hosted Kubilitics Service (Future)
  └─ Data: Never Cached Locally (Security Constraint)
```

### 1.2 Data Flow Diagram (Simplified)

```
┌─────────────────────────────────────────────────────────────┐
│                    User's Kubernetes Cluster                 │
│  ┌──────────────────────────────────────────────────────┐    │
│  │ Cluster Resources: Pods, Deployments, Services, etc. │    │
│  └──────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
            ↑                                       │
            │ (Cluster State)                      │ (kubeconfig auth)
            │                                       │
        ┌───┴────────────────────────────────────────┐
        │                                            │
    ┌───▼──────────────────────────────────────────┐ │
    │      Kubilitics Backend (localhost:8080)    │ │
    │  ┌────────────────────────────────────────┐ │ │
    │  │ 1. Fetch Cluster State (K8s API)       │ │ │
    │  │ 2. Build World Model (In-Memory Cache) │ │ │
    │  │ 3. Respond to Frontend Queries         │ │ │
    │  │ 4. Log Mutations to Audit Trail        │ │ │
    │  │ 5. Delegate to AI (if Investigation)   │ │ │
    │  └────────────────────────────────────────┘ │ │
    │             ↓ (gRPC mTLS)                    │ │
    │  ┌────────────────────────────────────────┐ │ │
    │  │  Kubilitics AI (localhost:8081)        │ │ │
    │  │ 1. Receive Investigation Request       │ │ │
    │  │ 2. Retrieve Cluster Context (redacted) │ │ │
    │  │ 3. Call LLM Provider                   │ │ │
    │  │ 4. Validate & Sanitize Response        │ │ │
    │  │ 5. Store Investigation Result          │ │ │
    │  │ 6. Return to Backend                   │ │ │
    │  └────────────────────────────────────────┘ │ │
    └────────────────────────────────────────────┘ │
        ↑                                           │
        │ (REST API)                                │
        │                                           │
    ┌───┴─────────────────┐                        │
    │  Frontend (React)   │                        │
    │  - User Queries    │                        │
    │  - Display Results │                        │
    │  - No Data Stored  │                        │
    └────────────────────┘                        │
                                                   │ (RBAC auth)
            ┌──────────────────────────────────────┘
            │
    ┌───────▼────────────────────────┐
    │  Kubernetes API Server         │
    │  (Authenticates kubeconfig)    │
    └────────────────────────────────┘
```

### 1.3 Data Categories

Kubilitics processes four primary data categories:

| Category | Description | Sensitivity | Examples |
|----------|-------------|-------------|----------|
| **Cluster State** | Real-time Kubernetes resource state | Medium | Pod names, Deployment status, Node conditions |
| **User Configuration** | User preferences and saved views | Low | UI settings, favorite clusters, display options |
| **AI Investigation Data** | Investigation queries, responses, results | High | User questions, LLM responses, recommendations |
| **Audit & Metrics** | Activity logs, performance metrics | Medium | Who did what when, token usage, API latency |

**Data Sensitivity Factors:**

- **Cluster Names & Topology:** Medium (reconnaissance risk)
- **Pod/Deployment Names:** Medium (information disclosure)
- **Resource Labels & Annotations:** Medium-High (may contain metadata)
- **Kubernetes Secrets:** Critical (never exposed)
- **LLM API Keys:** Critical (cost and access control)
- **User Kubeconfigs:** Critical (cluster access)
- **Investigation Queries:** High (may reveal security concerns)
- **AI Responses:** High (recommendations, sensitive analysis)

---

## 2. Data Classification

Data is classified by sensitivity level to determine handling requirements.

### 2.1 Classification Schema

**Public Data:**

Data that poses no confidentiality risk if disclosed.

| Data Type | Examples | Disclosure Risk | Retention |
|-----------|----------|-----------------|-----------|
| Documentation | README, API docs, blog posts | None | Permanent |
| Public Schema | API specification, data model | None | Permanent |
| Kubilitics Logo/Branding | Images, logos used in UI | None | Permanent |

**Internal Data:**

Data intended for internal use only; requires authentication to access.

| Data Type | Examples | Disclosure Risk | Retention |
|-----------|----------|-----------------|-----------|
| Cluster Topology | Pod names, deployments, services | Reconnaissance | Real-time only |
| Resource Metrics | CPU usage, memory usage, latency | Performance planning | 90 days |
| Event Logs | Pod restart, deployment update | Operational insights | 30 days |
| Deployment History | Previous versions, rollouts | Operational history | 1 year |

**Confidential Data:**

Sensitive business or technical information; requires additional controls.

| Data Type | Examples | Disclosure Risk | Retention |
|-----------|----------|-----------------|-----------|
| Kubernetes Secrets | Database passwords, API keys | Full system compromise | N/A (never stored) |
| Kubeconfig | User credentials, cluster endpoint | Cluster access | User controls |
| AI Investigation Data | User queries, LLM responses | Reveals security posture | 90 days (default) |
| Audit Logs | User actions, timestamps, IP | Accountability | 1 year (legal minimum) |

**Restricted Data:**

Data with highest sensitivity; must be encrypted and access-controlled.

| Data Type | Examples | Disclosure Risk | Retention |
|-----------|----------|-----------------|-----------|
| LLM API Keys | OpenAI, Anthropic keys | Cost overrun, MITM attacks | User controls |
| Master Encryption Keys | Database encryption keys | Complete data compromise | Secure key store only |
| User Passwords | Authentication credentials | Account compromise | Hash only (PBKDF2, Argon2) |
| Investigation Prompts | Detailed security queries | Reveals vulnerabilities | 90 days with encryption |

### 2.2 Default Access Control by Classification

| Classification | Authentication Required | RBAC Required | Encryption Required |
|---|---|---|---|
| **Public** | No | No | No |
| **Internal** | Yes | Yes (Kubernetes RBAC) | In-transit only |
| **Confidential** | Yes | Yes (App-level) | In-transit + At-rest |
| **Restricted** | Yes | Yes (Granular) | In-transit + At-rest (AES-256) |

---

## 3. Data Storage Architecture

Kubilitics uses different storage backends for different data types and deployment models.

### 3.1 Storage Systems

**Desktop Deployment:**

```
Component: kubilitics-backend

Storage: SQLite (Encrypted)
  ├─ Location: ~/.kubilitics/data/kubilitics.db
  ├─ Encryption: AES-256-GCM (SQLCipher)
  ├─ Key: Derived from User Password + Device UUID
  ├─ File Permissions: 0600 (Owner Read/Write Only)
  └─ Backup: User can export (JSON format)

Tables:
  ├─ clusters (User's Cluster Configurations)
  ├─ investigations (AI Investigation History)
  ├─ audit_log (Immutable Action Log)
  ├─ settings (User Preferences)
  └─ cache (Temporary Data, TTL-based)

Component: kubilitics-ai

Storage: SQLite (Encrypted)
  ├─ Location: ~/.kubilitics/data/ai.db
  ├─ Encryption: AES-256-GCM (SQLCipher)
  ├─ Key: Same as Backend Database
  └─ Size: ~100MB typical (per user)

Tables:
  ├─ investigations (Investigation Details)
  ├─ ai_responses (LLM Responses)
  ├─ investigation_metrics (Token usage, cost)
  └─ investigation_cache (Temporary)

In-Memory Cache: World Model
  ├─ Data: Complete Cluster State (Pods, Deployments, Services)
  ├─ Lifetime: From Backend startup until refresh
  ├─ Refresh: Every 30 seconds (or event-driven)
  ├─ Encryption: None (Volatile Memory)
  ├─ Purpose: Low-latency access to cluster state
  └─ Size: Typically 10-100MB (depends on cluster size)
```

**In-Cluster Deployment:**

```
Component: kubilitics-backend

Storage: PostgreSQL (External Database)
  ├─ Connection: Kubernetes Service (postgres-service.default.svc)
  ├─ Authentication: PostgreSQL username/password (from K8s Secret)
  ├─ Encryption:
  │   ├─ In-Transit: TLS (sslmode=require)
  │   ├─ At-Rest: Transparent Data Encryption (TDE) enabled
  │   └─ Key: Stored in Key Management Service (AWS KMS, etc.)
  ├─ Backup: Daily snapshots, replicated to external storage
  └─ Retention: Configurable per environment

Tables: (Same as Desktop, Multi-Tenant)
  ├─ clusters (Organization's Clusters)
  ├─ investigations (Team-Scoped)
  ├─ audit_log (Organization-Wide)
  ├─ settings (Organization + User-Level)
  ├─ teams (Multi-Tenancy Support)
  ├─ users (User Accounts)
  └─ rbac_policies (Custom Permissions)

Data Isolation: Team-Based
  ├─ Every Query Filters by team_id
  ├─ Database-Level Foreign Keys Enforce Isolation
  ├─ API-Level Checks Prevent Cross-Team Access
  └─ Audit Logs Include Team Context

Component: kubilitics-ai

Storage: PostgreSQL (Shared with Backend)
  ├─ Same Encryption and Backup as Backend
  ├─ Tables:
  │   ├─ investigations (Investigation Metadata)
  │   ├─ ai_recommendations (Audit Trail of Recommendations)
  │   ├─ ai_metrics (Token usage, cost, latency)
  │   └─ ai_audit (All AI Activities)
  └─ Data Isolation: Team-Based (same as Backend)

In-Memory Cache: World Model
  ├─ Per-Pod Instance (Not Shared Across Pods)
  ├─ Data: Cluster State (Pods, Deployments, etc.)
  ├─ Size: Scaled with Cluster Size
  ├─ Lifetime: 30 seconds refresh cycle
  └─ Multi-Pod Consistency: Each Pod has Independent Cache
```

**Optional Components:**

```
Vector Store: ChromaDB (Optional, AI Feature)
  ├─ Purpose: Store Investigation Embeddings for Semantic Search
  ├─ Storage:
  │   ├─ Desktop: Embedded ChromaDB (local file)
  │   ├─ In-Cluster: Standalone ChromaDB Pod (optional)
  │   └─ Encryption: At-rest (files on disk)
  ├─ Data Retention: Tied to Investigation Retention (90 days default)
  └─ Privacy: Embeddings are not human-readable (but can be reverse-engineered)

Time-Series Metrics: InfluxDB (Optional, Analytics)
  ├─ Purpose: Store Historical Performance Metrics
  ├─ Data: Downsampled Cluster Metrics
  │   ├─ Full Resolution: 7 days (1-minute buckets)
  │   ├─ Hourly: 90 days
  │   └─ Daily: 2 years
  ├─ Encryption: At-rest (per storage backend)
  └─ Retention: Configurable by deployment
```

### 3.2 Frontend Storage (Client-Side)

The frontend minimizes local storage to protect sensitive data.

```
Zustand State Store (In-Memory Only)
  ├─ User Session: Current User Identity, Token
  ├─ UI State: Selected Cluster, Active Namespace, View Preferences
  ├─ Cluster Cache: Recently Viewed Clusters (No Secrets!)
  └─ Lifetime: Session Duration (Cleared on App Close)

Local Storage (Persisted Across Sessions)
  ├─ Allowed Items:
  │   ├─ UI Preferences (Dark Mode, Font Size, etc.)
  │   ├─ Recently Used Clusters (Names Only)
  │   └─ Saved Queries (User-Defined)
  │
  ├─ Forbidden Items:
  │   ├─ Credentials (Tokens, Passwords)
  │   ├─ Secrets (API Keys, Kubernetes Secrets)
  │   ├─ Investigation Results (Sensitive AI Analysis)
  │   └─ Personal Data (User Email, Full Name)
  │
  └─ Storage: browser localStorage or React Query
      ├─ No Encryption (Browser Can See)
      └─ Assume Browser Is Compromised (Don't Store Secrets)

Session Cookie
  ├─ HTTP-Only: JavaScript Cannot Access
  ├─ Secure: Only Transmitted Over HTTPS
  ├─ SameSite: Strict (CSRF Protection)
  ├─ Expiry: 1 Hour (enforced server-side)
  └─ Domain: Specific to Backend Host (no leakage to other domains)

IndexedDB (Not Used)
  ├─ Kubilitics Does NOT Use IndexedDB
  ├─ Reason: Persistence Risk (data survives browser cache clear)
  └─ Alternative: Frontend Queries Backend for Cached Data
```

---

## 4. Data Flows

Understanding how data moves through Kubilitics is essential for security and privacy.

### 4.1 Cluster Data Ingestion Flow

Real-time cluster state flows from Kubernetes API into Kubilitics.

```
Kubernetes Cluster
  ├─ Resources: Pods, Deployments, Services, Nodes, Events
  └─ Change Stream: Events API (watch)

kubilitics-backend (Kubernetes API Client)
  ├─ Step 1: List Initial State
  │   ├─ Call: GET /api/v1/pods?watch=false
  │   ├─ Response: All Current Pods (Paginated)
  │   └─ Processing: Deserialize into Go Structs
  │
  ├─ Step 2: Watch for Changes (Long-Lived Connection)
  │   ├─ Call: GET /api/v1/pods?watch=true
  │   ├─ Response: Stream of Change Events
  │   │   ├─ ADDED, MODIFIED, DELETED events
  │   │   └─ Real-time as cluster changes
  │   └─ Processing: Update In-Memory Cache
  │
  └─ Step 3: Build World Model (In-Memory)
      ├─ Data Structure: Graph of Resources
      ├─ Relationships: Pod→Service, Deployment→Pod, etc.
      ├─ Caching: Indexed for Fast Queries
      ├─ Lifetime: Until Process Exit (or full refresh)
      └─ Size: 10-100MB typical

Frontend WebSocket (Real-Time Updates)
  ├─ Connection: WebSocket /ws/cluster-state
  ├─ Data Pushed from Backend: Cluster State Snapshots
  ├─ Frequency: Event-driven (real-time)
  ├─ Filtering: User Only Sees Permitted Namespaces
  ├─ Format: JSON
  └─ Transport: WSS (Secure WebSocket over TLS)

Frontend Rendering
  ├─ React Components Display Cluster State
  ├─ Data Filtered by RBAC (Backend-Side Enforcement)
  ├─ Secrets Redacted (Never Displayed)
  ├─ No Persistence (Zustand In-Memory Only)
  └─ Data Cleared on App Close

Audit Logging
  ├─ API Access to Cluster Data is Logged
  ├─ Log Entry: User, Query, Timestamp, Result
  └─ Storage: Append-Only Log (SQLite/PostgreSQL)
```

### 4.2 AI Investigation Flow

User initiates an AI investigation, which flows through multiple services.

```
User Interaction (Frontend)
  ├─ User Enters Query: "Why is my deployment crashing?"
  ├─ User Clicks "Investigate"
  ├─ Frontend Sends REST Request:
  │   POST /api/v1/investigations
  │   {
  │     "query": "Why is my deployment crashing?",
  │     "deployment": "api-server",
  │     "namespace": "production"
  │   }
  └─ Frontend: Awaiting Response (User Sees "Analyzing...")

kubilitics-backend Receives Request
  ├─ Step 1: Validate User
  │   ├─ Extract User from JWT Token
  │   ├─ Verify User Has Access to Deployment
  │   ├─ Check Token Not Expired
  │   └─ Proceed if Valid, Return 403 if Invalid
  │
  ├─ Step 2: Construct Investigation Context
  │   ├─ Query World Model for Deployment
  │   ├─ Retrieve: Deployment Spec, Replica Status, Events
  │   ├─ Retrieve: Associated Pods, Container Logs (last 100 lines)
  │   ├─ Retrieve: Recent Metrics (CPU, Memory, Network)
  │   ├─ REDACT: All Kubernetes Secret Values
  │   ├─ REDACT: API Keys, Passwords, TLS Certs
  │   └─ Result: Investigation Context (Structured Data)
  │
  ├─ Step 3: Prepare Token Budget Check
  │   ├─ Estimate Tokens for Investigation
  │   ├─ Current Hour Token Usage: 3,500 / 10,000
  │   ├─ Estimated Investigation: 2,000 tokens
  │   ├─ Total After: 5,500 / 10,000 (OK)
  │   └─ Proceed if Under Budget, Return 429 if Over
  │
  ├─ Step 4: Call kubilitics-ai Service (gRPC)
  │   ├─ Service: localhost:8081 (or kubernetes service DNS)
  │   ├─ TLS: mTLS Certificate Validation
  │   ├─ Request Payload:
  │   │   ├─ User Identity (for audit)
  │   │   ├─ Investigation Type (root cause, debug, etc.)
  │   │   ├─ User Query (sanitized)
  │   │   ├─ Cluster Context (redacted)
  │   │   └─ Constraints (approved operations only)
  │   └─ Connection: Long-Lived gRPC Stream (HTTP/2)
  │
  └─ Backend Awaits Response (Streaming)

kubilitics-ai Service Processes Investigation
  ├─ Step 1: Receive Request
  │   ├─ Verify Backend Identity (mTLS Certificate)
  │   ├─ Verify User Authorization (gRPC Metadata)
  │   └─ Log Investigation Start
  │
  ├─ Step 2: Construct LLM Prompt
  │   ├─ System Prompt: "You are a Kubernetes troubleshooting expert..."
  │   ├─ Context: Investigation Context (Cluster State, Logs, Metrics)
  │   ├─ User Query: "Why is my deployment crashing?"
  │   ├─ Constraints: "Never output secret values"
  │   └─ Final Prompt: ~2,000 tokens (including context)
  │
  ├─ Step 3: Call External LLM Provider (OpenAI/Anthropic)
  │   ├─ HTTPS Request to LLM Provider
  │   ├─ Authentication: Bearer Token (API Key)
  │   ├─ Payload: Prompt + Parameters (model, temperature, max_tokens)
  │   ├─ Response: Streamed Text (LLM completion)
  │   ├─ Tokens Used: ~1,500 completion tokens
  │   └─ Cost: Deducted from User's Token Budget
  │
  ├─ Step 4: Validate & Sanitize Response
  │   ├─ Post-Processing: Detect Secret Patterns
  │   │   ├─ Regex Check for API Keys
  │   │   ├─ Regex Check for Passwords
  │   │   └─ If Found: Alert + Redact
  │   ├─ Hallucination Check: Verify Claims Against Cluster
  │   │   ├─ Example: "Pod is running" → Query: Is Pod Actually Running?
  │   │   ├─ Mismatch → Flag as Unverified (Add Disclaimer)
  │   │   └─ User Must Confirm Before Acting
  │   └─ Response Validity: Total tokens = 3,500
  │
  ├─ Step 5: Store Investigation Result
  │   ├─ Create Investigation Record:
  │   │   ├─ ID: Unique UUID
  │   │   ├─ User: alice@company.com
  │   │   ├─ Query: "Why is my deployment crashing?"
  │   │   ├─ Context Hash: SHA-256 of cluster state
  │   │   ├─ Response Hash: SHA-256 of LLM response
  │   │   ├─ Tokens Used: 3,500
  │   │   ├─ Cost: $0.105 (estimate)
  │   │   └─ Timestamp: 2026-02-10T14:30:00Z
  │   ├─ Store in PostgreSQL (In-Cluster) / SQLite (Desktop)
  │   ├─ Encrypt Sensitive Fields (Response)
  │   └─ Add to Audit Log
  │
  └─ Step 6: Stream Response Back to Backend
      ├─ Response Format: gRPC Stream (Chunked)
      ├─ Chunk 1: Investigation ID + Metadata
      ├─ Chunk 2-N: Response Text (Streamed)
      └─ Final Chunk: Investigation Complete + Summary

kubilitics-backend Receives Investigation Response
  ├─ Step 1: Collect Streamed Chunks
  │   ├─ Build Complete Response in Memory
  │   └─ Forward Chunks to Frontend (WebSocket)
  │
  ├─ Step 2: Log Investigation Completion
  │   ├─ Audit Entry: User alice completed investigation
  │   ├─ Tokens Consumed: 3,500
  │   ├─ Duration: 15 seconds
  │   └─ Status: Success
  │
  └─ Step 3: Send Response to Frontend

Frontend Receives Investigation Response
  ├─ Step 1: Display Streaming Response
  │   ├─ Real-Time Rendering (Chunks as They Arrive)
  │   ├─ User Sees AI Response Appearing Gradually
  │   └─ Allows Early Read (Don't Wait for Complete Response)
  │
  ├─ Step 2: Display Recommendations
  │   ├─ AI Recommends: "Scale deployment to 5 replicas"
  │   ├─ Button: "Apply" (Requires User Approval)
  │   ├─ Button: "Dry-Run" (Preview Changes)
  │   └─ Button: "Dismiss" (Ignore Recommendation)
  │
  ├─ Step 3: Store Investigation Locally (Optional)
  │   ├─ NOT Stored in Browser LocalStorage
  │   ├─ NOT Stored in Browser IndexedDB
  │   ├─ User CAN Export as JSON (Manual Action)
  │   └─ Query Backend for History (If Needed Later)
  │
  └─ Step 4: Cleanup
      ├─ Investigation Stored on Backend (Persistent)
      ├─ Frontend Memory Cleared After View
      └─ Investigation Accessible via History

User Takes Action (Optional)
  ├─ User Clicks "Apply" on AI Recommendation
  ├─ Frontend Sends: POST /api/v1/deployments/api-server/scale
  │   └─ Payload: { replicas: 5 }
  ├─ Backend Validates:
  │   ├─ User RBAC: Can User Scale Deployments?
  │   ├─ Safety Check: Is This Within Safe Limits?
  │   └─ Audit: Log Action with Investigation Context
  ├─ Backend Calls Kubernetes API: PATCH Deployment
  └─ User Sees Success/Error Message

Investigation Lifecycle Ends:
  ├─ Investigation Stored for 90 Days (Default)
  ├─ After 90 Days: Auto-Deleted
  ├─ User Can Request Earlier Deletion
  ├─ Audit Trail Remains (Legal Minimum 1 Year)
  └─ All Sensitive Data Encrypted at Rest
```

### 4.3 AI Streaming Flow (Real-Time)

WebSocket streaming enables real-time investigation results.

```
Frontend WebSocket Connection
  ├─ Connects: ws://localhost:8080/api/v1/investigations/stream
  ├─ Authentication: Included in WebSocket Upgrade Request
  ├─ Headers:
  │   ├─ Authorization: Bearer <token>
  │   ├─ Origin: http://localhost:3000
  │   └─ X-Investigation-ID: <uuid>
  └─ Server Accepts & Upgrades to WebSocket

Investigation Streaming
  ├─ Frame 1 (Metadata):
  │   {
  │     "type": "investigation_start",
  │     "investigation_id": "abc-123",
  │     "timestamp": "2026-02-10T14:30:00Z"
  │   }
  │
  ├─ Frame 2-N (Response Chunks):
  │   {
  │     "type": "response_chunk",
  │     "chunk": "The deployment is crashing because...",
  │     "total_tokens": 250
  │   }
  │
  ├─ Frame N+1 (Metadata):
  │   {
  │     "type": "response_chunk",
  │     "chunk": "Recommended actions: 1. Check logs...",
  │     "total_tokens": 500
  │   }
  │
  ├─ Frame N+2 (Recommendations):
  │   {
  │     "type": "recommendations",
  │     "items": [
  │       {
  │         "id": "rec-1",
  │         "action": "Scale deployment to 5 replicas",
  │         "priority": "high",
  │         "requires_approval": true
  │       }
  │     ]
  │   }
  │
  └─ Frame N+3 (Completion):
      {
        "type": "investigation_complete",
        "total_tokens": 3500,
        "duration_seconds": 15,
        "cost_usd": 0.105
      }

Frontend Processing:
  ├─ Renders Each Chunk Immediately (No Buffering)
  ├─ Updates Token Counter in Real-Time
  ├─ Displays Recommendations as They Arrive
  ├─ Allows User to Interrupt (Close WebSocket)
  └─ Data Not Persisted (Only in Memory During Stream)

WebSocket Close (Investigation Ends)
  ├─ Reason: Investigation Complete (Normal)
  ├─ Data: Investigation Stored on Backend
  ├─ Cleanup: Frontend Clears Memory
  └─ User Can View History Later (Via REST API)
```

### 4.4 Audit Data Flow (Immutable Log)

Every mutation is logged to an immutable audit trail.

```
User Action (Mutation)
  ├─ Example: User Deletes Pod "api-server-xyz"
  ├─ Command: DELETE /api/v1/namespaces/production/pods/api-server-xyz
  ├─ Authentication: Bearer Token
  └─ Authorization: User Must Have Delete Permission

kubilitics-backend Authorization Check
  ├─ Verify User Identity: alice@company.com
  ├─ Check RBAC: Can User Delete Pods in Production?
  │   ├─ Call Kubernetes SubjectAccessReview
  │   ├─ Response: Allowed = true
  │   └─ Proceed
  └─ Execute Action Against Kubernetes API

Audit Log Entry Created (Before Action Executes)
  ├─ Entry:
  │   {
  │     "id": "audit-999",
  │     "timestamp": "2026-02-10T14:35:00Z",
  │     "user": "alice@company.com",
  │     "action": "delete",
  │     "resource_kind": "Pod",
  │     "resource_name": "api-server-xyz",
  │     "namespace": "production",
  │     "rbac_allowed": true,
  │     "execution_status": "pending",
  │     "ip_address": "192.168.1.100",
  │     "user_agent": "Mozilla/5.0...",
  │     "session_id": "sess-abc-123"
  │   }
  │
  ├─ Sign Entry: HMAC-SHA256(Entry, SigningKey)
  │   ├─ Signature Prevents Tampering
  │   ├─ Signature Covers All Fields
  │   └─ Include in Audit Log
  │
  ├─ Store in Database: audit_log Table
  │   ├─ Append-Only (No Updates/Deletes Allowed)
  │   ├─ Indexed by Timestamp (for queries)
  │   ├─ Indexed by User (for user-specific queries)
  │   └─ Encryption: AES-256-GCM at rest
  │
  └─ Log Level: Immediate (Don't Wait for Execution)

Action Execution
  ├─ Call Kubernetes API: DELETE Pod
  ├─ Response: Success (200 OK) or Error (4xx/5xx)
  └─ Status: execution_status = "success" or "failed"

Audit Log Entry Updated (After Action Executes)
  ├─ Update Record: execution_status = "success"
  ├─ Update: execution_error = (if failed)
  ├─ Update: execution_duration_ms = 250
  ├─ Re-sign Entry: New HMAC-SHA256
  │   ├─ Signature Changes (Different Content)
  │   ├─ Timestamp of Update Recorded
  │   └─ Previous Signature Invalidated (Detected as Change)
  │
  └─ Store Updated Entry: Append New Record (Not Update)
      ├─ Audit Log Strategy: Append-Only (Always Add, Never Modify)
      ├─ Previous Entry: Kept for History
      ├─ New Entry: Records the Update
      └─ Results in "Event Chain" (Transparency)

Audit Log Integrity Verification
  ├─ Every Access:
  │   ├─ Load Entry from Database
  │   ├─ Verify Signature Against Stored Signature
  │   ├─ Mismatch → Flag as Tampering Detected
  │   └─ Log Integrity Alert
  │
  └─ Periodic Verification:
      ├─ Background Job (Every Hour)
      ├─ Sample Entries from Audit Log
      ├─ Verify All Signatures
      ├─ Alert if Any Tampering Detected
      └─ Send Report to Security Team

Audit Log Query (User Perspective)
  ├─ Admin Can View Full Audit Log
  ├─ Regular User Can View Own Actions
  ├─ Time Range Query: Last 30 days
  ├─ Filter by User, Action, Resource
  ├─ Export: CSV, JSON Format
  └─ Signatures Included in Export (Verification Proof)

Audit Log Retention
  ├─ Minimum: 1 Year (Legal Requirement)
  ├─ Default: 2 Years
  ├─ Maximum: 7 Years (Configurable)
  ├─ Deletion: Automatic After Retention Expires
  ├─ Immutable: Can't Delete Individual Entries (Legal Hold Exception)
  └─ Backup: Replicated to External Storage (ELK, Splunk)
```

### 4.5 Metrics Flow (Time-Series)

Performance metrics are collected and stored for analysis.

```
Kubernetes Metrics Source
  ├─ Pod Metrics (via Metrics Server)
  │   ├─ CPU Usage
  │   ├─ Memory Usage
  │   └─ Network I/O
  │
  ├─ Node Metrics
  │   ├─ CPU, Memory, Disk
  │   └─ Network I/O
  │
  └─ Custom Metrics (Optional)
      ├─ Application-Specific Metrics
      ├─ Business Metrics
      └─ Cost Metrics

kubilitics-backend Collection
  ├─ Step 1: Query Metrics Server
  │   ├─ Interval: Every 30 Seconds
  │   ├─ Endpoints: /metrics/pods, /metrics/nodes
  │   └─ Aggregation: Sum per Namespace
  │
  ├─ Step 2: Enrich Metrics
  │   ├─ Add Metadata: Pod Name, Deployment, Namespace
  │   ├─ Add Context: Replica Count, Resource Limits
  │   ├─ Calculate: Usage as % of Requested
  │   └─ Detect Anomalies: Sudden Spikes?
  │
  ├─ Step 3: Store Metrics
  │   ├─ Full Resolution (1-minute buckets): 7 days
  │   ├─ Downsampled (Hourly): 90 days
  │   ├─ Downsampled (Daily): 2 years
  │   ├─ Storage: InfluxDB or Time-Series Table
  │   └─ Encryption: At-rest (backend-specific)
  │
  └─ Step 4: Make Available to AI
      ├─ AI Queries Metrics for Investigations
      ├─ Example: "Show Memory Usage Last 1 Hour"
      ├─ AI Analyzes Trends (Sudden Increase?)
      ├─ AI Provides Insights (Memory Leak Detected)
      └─ Metrics Included in Investigation Storage

Metrics Privacy Considerations
  ├─ NOT Sensitive: Metrics Don't Contain Secrets
  ├─ SEMI-SENSITIVE: Pod Names Reveal Topology
  ├─ RESTRICTED: Cost Metrics (Business Sensitive)
  ├─ Retention: Shorter Than Investigation (7 days full resolution)
  └─ Redaction: None (Metrics Are Inherently Non-Secret)
```

---

## 5. Data Retention Policies

Data retention balances compliance requirements with privacy and cost.

### 5.1 Retention by Data Category

| Data Category | Retention Period | Rationale | Deletion Method |
|---|---|---|---|
| **Cluster State** | Real-time only | No persistence needed | Not stored (ephemeral) |
| **AI Investigations** | 90 days (default, configurable 30-2,555) | Compliance + user control | Auto-delete after expiry |
| **AI Metrics/Analytics** | 7 days full / 90 days hourly / 2 years daily | Cost optimization + historical analysis | Auto-delete per tier |
| **Audit Logs** | 1 year (minimum, configurable up to 7 years) | Legal compliance + forensics | Auto-delete after expiry |
| **User Configuration** | Until Explicitly Deleted | User control | Manual deletion or account closure |
| **Cache Data** | TTL-based (1 hour typical) | Performance optimization | Auto-purge after TTL |
| **LLM API Keys** | User-Controlled (Delete on Logout) | Security (prevent leakage) | User-initiated or on logout |

### 5.2 Retention Configuration (In-Cluster)

```yaml
kubilitics:
  data_retention:
    # AI Investigation Data
    investigations:
      default_ttl_days: 90
      min_ttl_days: 30
      max_ttl_days: 2555  # 7 years
      deletion_policy: "auto_delete"  # or "archive"

    # Time-Series Metrics
    metrics:
      full_resolution:
        retention_days: 7
        interval_seconds: 60
      hourly:
        retention_days: 90
        interval_seconds: 3600
      daily:
        retention_days: 730  # 2 years
        interval_seconds: 86400

    # Audit Logs
    audit_logs:
      min_retention_days: 365
      default_retention_days: 730
      max_retention_days: 2555
      deletion_policy: "auto_delete"
      legal_hold: false  # Set to true to prevent deletion

    # User Configuration (Indefinite)
    user_settings:
      retention_days: null  # Never auto-delete
      deletion_policy: "manual"  # User must manually delete

    # Cache Data
    cache:
      ttl_seconds: 3600  # 1 hour
      cleanup_interval_seconds: 300  # Check every 5 minutes
```

### 5.3 Data Deletion Procedures

**Automatic Deletion (Time-Based):**

```
Background Job: DataRetentionCleaner
  ├─ Frequency: Daily at 2:00 AM UTC
  ├─ Process:
  │   ├─ Query: Find All Expired Investigations
  │   │   └─ WHERE created_at < (NOW - retention_days)
  │   │
  │   ├─ Backup (Optional):
  │   │   ├─ Create Backup of Deleted Records
  │   │   ├─ Store in Cold Storage (S3 Glacier)
  │   │   └─ Retention: 30 days (for recovery)
  │   │
  │   ├─ Delete:
  │   │   ├─ DELETE FROM investigations WHERE ...
  │   │   ├─ DELETE FROM ai_responses WHERE ...
  │   │   ├─ Verify: Count Deleted Records
  │   │   └─ Log: Number of Records Deleted
  │   │
  │   └─ Verify:
  │       ├─ Query: Confirm Records Are Gone
  │       ├─ Alert: If Deletion Failed
  │       └─ Report: Daily Summary
  │
  └─ Monitoring:
      ├─ Dashboard: Show Deletion Rate
      ├─ Alerting: If Deletion Falls Behind
      └─ Compliance: Proof of Deletion (Audit Trail)
```

**Manual Deletion (User-Initiated):**

```
User Requests Investigation Deletion

Frontend:
  ├─ User Views Investigation History
  ├─ User Clicks "Delete" on Investigation
  ├─ Confirmation Dialog: "Permanently Delete Investigation?"
  ├─ User Confirms

Backend Process:
  ├─ Verify User Owns Investigation
  ├─ Check Authorization: User Can Delete Own Investigations
  ├─ Create Deletion Audit Entry:
  │   {
  │     "action": "delete",
  │     "resource": "investigation-xyz",
  │     "reason": "user_requested",
  │     "timestamp": "...",
  │     "user": "alice@company.com"
  │   }
  ├─ Delete Investigation Data:
  │   ├─ DELETE FROM investigations WHERE id = 'xyz'
  │   ├─ DELETE FROM ai_responses WHERE investigation_id = 'xyz'
  │   ├─ DELETE FROM ai_audit WHERE investigation_id = 'xyz'
  │   └─ Verify Deletion
  │
  ├─ Audit Trail:
  │   ├─ Create Record: Investigation Deleted
  │   ├─ Reference: Original Investigation ID
  │   ├─ User: Who Deleted
  │   ├─ Timestamp: When Deleted
  │   └─ Reason: Why Deleted (user_requested)
  │
  └─ Notification:
      ├─ Confirm to User: "Investigation Deleted"
      └─ Note: "Audit Trail Retained (1 Year)"

GDPR Right to Erasure:
  ├─ User Can Request: "Delete All My Data"
  ├─ Scope: Investigation Data, Audit Records (Optional)
  ├─ Scope Limits:
  │   ├─ Audit Logs Cannot Be Deleted (Legal Requirement)
  │   ├─ Investigation Content Can Be Deleted
  │   └─ User Metadata Minimal (Email Only)
  │
  ├─ Process:
  │   ├─ Verify User Identity (Extra Verification)
  │   ├─ Export User Data (Backup)
  │   ├─ Delete All Investigation Data
  │   ├─ Anonymize Audit Entries (Replace Email with UUID)
  │   └─ Confirm Completion
  │
  └─ Timeline: 30 Days (GDPR Requirement)
```

---

## 6. Privacy Architecture

Privacy is embedded in Kubilitics' design and operations.

### 6.1 Privacy Principles

**No Telemetry by Default:**

- Kubilitics does NOT collect telemetry, usage analytics, or user behavior data
- No tracking pixels, no Google Analytics, no Mixpanel
- Users can opt-in to anonymous metrics (OPTIONAL):
  - Button Usage (for UX research)
  - Feature Adoption (no sensitive data)
  - Performance Metrics (latency, error rates)
- Opt-in is explicit; defaults to off
- No third-party analytics tools embedded in frontend

**No PII Collection:**

- Kubilitics does NOT collect personal information
- User Identity is provided by Kubeconfig or OIDC (not collected by Kubilitics)
- No email addresses stored (except in Audit Logs for accountability)
- No IP addresses stored (except in Audit Logs)
- No device fingerprinting
- No browser history, cookies, or tracking

**Data Stays Local:**

**Desktop Mode:**
- All Data Stored Locally: SQLite on User's Machine
- No Data Transmitted to Kubilitics Servers
- No Cloud Sync
- User Controls All Data (Can Delete Anytime)

**In-Cluster Mode:**
- All Data Stored in Cluster: PostgreSQL within Kubernetes
- Data Stays Behind Cluster's Network Boundary
- No Data Leaves the Cluster (except LLM calls)
- Cluster Admin Controls Data Retention

**LLM Provider Integration:**

- Data Sent to LLM Provider: Only Investigation Context (Redacted)
- Data NOT Sent:
  - Kubernetes Secret Values
  - User Credentials
  - User Personal Information
  - Audit Logs
  - Sensitive Metadata (annotations, labels)
- LLM Provider Data Policies:
  - OpenAI: Data Retention 30 Days (can be configured to 0 days)
  - Anthropic: No Data Retention (default)
  - Ollama: Zero Data (runs locally)
- User Can Choose Local LLM (Ollama) to Avoid Sending Data

**Data Minimization:**

- Only Necessary Data is Collected
- Investigation Queries Ask Only What's Needed
- Cluster Context Filtered to Permitted Namespaces
- Secrets Excluded from Context
- Metrics Limited to Relevant Timeframe
- Recommendations Scoped to Permitted Operations

### 6.2 GDPR Compliance (Privacy by Design)

Kubilitics implements GDPR requirements as architectural features.

**Right to Access (Article 15):**

```
User Request: "Provide All Data You Have About Me"

Kubilitics Process:
  ├─ Verify User Identity (Extra Confirmation)
  ├─ Collect User Data:
  │   ├─ User Account Information (Minimal: Email, Created Date)
  │   ├─ Investigation History (All Investigations)
  │   ├─ Configuration Settings (Preferences, Saved Views)
  │   ├─ Audit Entries (Actions User Performed)
  │   └─ API Token List (Not Token Values)
  │
  ├─ Format for Export: JSON or CSV
  ├─ Include Metadata: Timestamps, Structure
  ├─ Encrypt Export: Before Transmission
  ├─ Deliver: Secure Link (Expires in 24 Hours)
  └─ Confirm Completion

Response Time: 30 Days (GDPR Requirement)
```

**Right to Erasure (Article 17) — "Right to Be Forgotten":**

```
User Request: "Delete All Data About Me"

Limitations:
  ├─ Audit Logs: Cannot Be Deleted (Legal Requirement)
  │   └─ GDPR Exception: Legal Obligation to Retain
  │
  ├─ Investigation Data: Can Be Deleted
  │   ├─ All AI Investigations Deleted
  │   ├─ Associated Responses Deleted
  │   └─ Timestamps Retained (For Audit Trail Integrity)
  │
  └─ Configuration: Minimal Data
      └─ User Account Deleted (Or Anonymized)

Process:
  ├─ Verify User Identity
  ├─ Confirm: Understand Permanent Deletion
  ├─ Export Data (For User's Records)
  ├─ Delete Data:
  │   ├─ DELETE FROM investigations WHERE user_id = 'user-123'
  │   ├─ DELETE FROM user_settings WHERE user_id = 'user-123'
  │   ├─ Anonymize Audit Entries: Replace User with 'DELETED_USER'
  │   └─ Verify Deletion
  │
  └─ Confirm Completion

Response Time: 30 Days
Note: After Deletion, User Cannot Access Kubilitics (Account Closed)
```

**Data Portability (Article 20):**

```
User Request: "Export My Data in Portable Format"

Data Included:
  ├─ User Metadata: Account Info
  ├─ Investigations: Full History, Responses, Timestamps
  ├─ Configuration: Settings, Preferences
  ├─ API Tokens: Metadata (Not Actual Token Values)
  └─ Audit Trail: User's Own Actions

Format Options:
  ├─ JSON (Machine Readable, Portable)
  ├─ CSV (Spreadsheet Friendly)
  ├─ SQL Dump (Database Format)
  └─ PDF (Human Readable Report)

Features:
  ├─ All Data Included (No Omissions)
  ├─ Standardized Format (Can Import to Another Service)
  ├─ Metadata Preserved (Timestamps, Relationships)
  ├─ Encrypted Transmission (HTTPS, Link Expires)
  └─ Verifiable Authenticity (Cryptographic Signature)

Response Time: 30 Days
```

**Lawful Basis (Article 6):**

| Activity | Lawful Basis | Justification |
|----------|-------------|-------------|
| **Cluster State Access** | Consent (Implied) | User Authenticates → Implicit Consent to Use Service |
| **Audit Logging** | Legal Obligation | Accountability for Infrastructure Changes |
| **AI Features** | Explicit Consent | Requires User to Configure LLM API Key |
| **Cluster Monitoring** | Legitimate Interest | Essential for Service Operation |

**Privacy Impact Assessment (DPIA):**

Kubilitics includes a DPIA template for deployments in regulated industries:

```markdown
# Data Protection Impact Assessment (DPIA) for Kubilitics

## Purpose:
Determine privacy risks of using Kubilitics for Kubernetes cluster management

## Scope:
- Cluster State: Pod names, Deployment specs, Events
- AI Investigation Data: Queries and LLM responses
- User Actions: Audit logs of cluster modifications
- Metrics: CPU, Memory, Network usage

## Processing:
1. Kubilitics Backend collects cluster state from Kubernetes API
2. AI Service analyzes state and sends context to LLM provider
3. User can review AI recommendations and execute cluster changes
4. All actions are logged to audit trail

## Privacy Risks:
- Risk 1: LLM Provider Sees Cluster Data (Mitigation: Redact secrets)
- Risk 2: AI Response Stored in Investigation Database (Mitigation: Encryption, auto-delete)
- Risk 3: Audit Logs Retained for Legal Compliance (Mitigation: Access control)

## Mitigation Measures:
1. End-to-End Encryption for Sensitive Data
2. Secret Redaction Before LLM Submission
3. Data Minimization (Only Necessary Context)
4. User Control (Data Retention, Deletion)
5. Transparency (What Data Is Collected)

## Residual Risks:
- Medium: LLM Provider May Retain Data (Depends on Provider Policy)
- Low: Audit Trail Tampering (Cryptographic Protection)

## Approval:
Data Protection Officer: [Signature]
Date: [Date]
```

---

## 7. GDPR Compliance Details

### 7.1 Technical Measures

Kubilitics implements the following technical measures for GDPR compliance:

| Requirement | Technical Implementation |
|---|---|
| **Confidentiality** | AES-256-GCM encryption at rest, TLS 1.3 in transit |
| **Integrity** | Cryptographic MACs, Digital Signatures, Audit Logs |
| **Availability** | Database Replication, Backups, Disaster Recovery |
| **Accountability** | Immutable Audit Logs, Access Logs, Retention Tracking |
| **Resilience** | Encryption Key Management, Secure Backup, Recovery Procedures |

### 7.2 Organizational Measures

| Requirement | Implementation |
|---|---|
| **Data Protection Officer (DPO)** | Appointed for Kubilitics Project |
| **Privacy Training** | All Engineers Complete Privacy Course |
| **Vendor Assessment** | LLM Providers Assessed for GDPR Compliance |
| **Data Processing Agreements (DPA)** | Provided to Customers (Standard Template) |
| **Incident Response** | 72-Hour Notification to Authorities (if breach) |
| **Records of Processing** | Maintained in Processing Register |

### 7.3 GDPR Compliance Checklist

- [ ] Privacy Notice: Published (Explains Data Collection & Use)
- [ ] Consent Management: Explicit Opt-In for AI Features
- [ ] Data Export: User Can Export Own Data (JSON Format)
- [ ] Data Deletion: User Can Delete Investigations (Right to Erasure)
- [ ] Breach Response: 72-Hour Notification Procedure Defined
- [ ] DPA Template: Provided to Customers
- [ ] DPIA Template: Available for Risk Assessments
- [ ] Encryption: End-to-End Encryption Implemented
- [ ] Data Minimization: Only Necessary Data Collected
- [ ] Access Control: RBAC Prevents Unauthorized Access

---

## 8. Data Security Controls

### 8.1 Encryption at Rest

```
SQLite (Desktop)
  ├─ Library: SQLCipher (AES-256-GCM)
  ├─ Key Derivation: PBKDF2(password, salt, 100k iterations)
  ├─ Page Size: 4KB (Each Page Encrypted)
  └─ Overhead: ~13% (Due to Encryption Metadata)

PostgreSQL (In-Cluster)
  ├─ Feature: Transparent Data Encryption (TDE)
  ├─ Algorithm: AES-256 (FIPS 140-2 Compliant)
  ├─ Key Management: External KMS (AWS KMS, HashiCorp Vault)
  ├─ Key Rotation: Automatic (Without Downtime)
  └─ Backup Encryption: Enabled by Default

Kubernetes Secrets (API Keys, Credentials)
  ├─ At-Rest: Encrypted with AES-256-GCM
  ├─ Key Storage: Kubernetes etcd Encryption (KMS Plugin)
  ├─ Access: RBAC Controls Who Can Read
  └─ Audit: All Secret Access Logged

Backups:
  ├─ Encrypted Before Storage
  ├─ Encrypted in Transit (TLS)
  ├─ Encrypted at Backup Destination (S3, Cloud Storage)
  └─ Key Rotated Quarterly
```

### 8.2 Encryption in Transit

```
All Network Communication: TLS 1.3
  ├─ Frontend ↔ Backend: HTTPS + TLS 1.3
  ├─ Backend ↔ Kubernetes API: mTLS (Mutual TLS)
  ├─ Backend ↔ AI Service: gRPC + mTLS
  ├─ Backend ↔ LLM Provider: HTTPS + TLS 1.3
  ├─ Mobile ↔ Backend: HTTPS + TLS Pinning
  └─ Desktop ↔ Backend: Localhost (Implicit Security)

Certificate Pinning (Mobile):
  ├─ Expected Certificate: Pinned in Mobile App Binary
  ├─ Verification: Every TLS Handshake Verifies Certificate
  ├─ MITM Protection: Rogue Certificate Rejected
  └─ Update: Certificate Update Requires App Release
```

### 8.3 Access Control

```
Database Access:
  ├─ PostgreSQL Users: Separate Per Service
  │   ├─ kubilitics_backend: SELECT, INSERT, UPDATE, DELETE
  │   ├─ kubilitics_ai: SELECT, INSERT (limited tables)
  │   └─ kubilitics_admin: Full Permissions
  │
  ├─ Row-Level Security (RLS):
  │   ├─ Policy: User Can Only Access Own Data
  │   ├─ Policy: Team Can Only Access Own Namespaces
  │   └─ Enforcement: Automatic (Database Layer)
  │
  └─ Connection Security:
      ├─ TLS Required (sslmode=require)
      ├─ Password Authentication (Strong, Rotated)
      └─ IP Whitelist (Backend IPs Only)

Kubernetes Secrets:
  ├─ RBAC: Only kubilitics Service Accounts Can Read
  ├─ Audit: All Read/Write Logged
  └─ Encryption: At-Rest in etcd
```

### 8.4 Secret Redaction

```
Automatic Redaction (Before Storage/Display):
  ├─ Kubernetes Secrets: Detected by Key Name (secret-*)
  ├─ API Keys: Detected by Pattern (openapi_key, api_key, etc.)
  ├─ Passwords: Detected by Pattern (password, passwd, pwd)
  ├─ Certificates: Detected by Content (BEGIN CERTIFICATE)
  ├─ Tokens: Detected by Length & Format (Base64, JWT)
  └─ Action: Replace with [REDACTED] (or [SENSITIVE])

Logging Redaction:
  ├─ Sensitive Fields: Automatically Excluded from Logs
  ├─ Log Scrubbing: Regex Patterns Detect Secrets
  ├─ Policy: Never Log Secrets (Configuration Enforced)
  └─ Verification: Log Parser Checks for Secrets in Output

Log Sanitization Examples:
  ├─ Before: 2026-02-10 14:30:00 User=alice Token=sk_live_abc123xyz
  ├─ After: 2026-02-10 14:30:00 User=alice Token=[REDACTED]
  │
  ├─ Before: Error: KubernetesAPI failed with credentials: user=admin password=MyP@ssw0rd
  ├─ After: Error: KubernetesAPI failed with credentials: user=admin password=[REDACTED]
  │
  └─ Verification: grep "password=" logs | grep -v "\[REDACTED\]" → Should Return Nothing
```

---

## 9. LLM Data Governance

Kubilitics sends investigation context to external LLM providers. This governance ensures user data is protected.

### 9.1 Data Sent to LLM Providers

**Data SENT (Necessary for Analysis):**

```
Cluster Context:
  ├─ Pod Names: "api-server-xyz", "database-pod-123" (Required for Context)
  ├─ Deployment Names: "api-server", "database" (Required)
  ├─ Service Names: "api-service", "db-service" (Required)
  ├─ Namespace: "production", "staging" (Required)
  ├─ Pod Status: "Running", "Pending", "Failed" (Required)
  ├─ Container Status: Ready/Not Ready, Restart Count (Required)
  ├─ Events: "Pod Created", "Image Pull Failure" (Required)
  ├─ Logs: Last 100 Lines of Container Logs (Required)
  ├─ Metrics: CPU/Memory Usage, Request/Error Rates (Required)
  └─ Error Messages: Stack Traces, Warnings (Required)

User Query:
  ├─ Question: "Why is my deployment crashing?" (Required)
  ├─ Deployment Name: "api-server" (Context)
  └─ Timeframe: Last 1 Hour (Optional)
```

**Data NOT SENT (Explicitly Excluded):**

```
Kubernetes Secrets:
  ├─ Database Passwords: [REDACTED]
  ├─ API Keys: [REDACTED]
  ├─ TLS Certificates: [REDACTED]
  └─ All Secret Values: Removed Before Sending to LLM

Sensitive Annotations/Labels:
  ├─ Cost Allocation Tags: Removed
  ├─ Security Policy Tags: Removed
  ├─ Billing Information: Removed
  └─ Custom Sensitive Labels: Removed

User Credentials:
  ├─ Kubeconfig: Never Sent
  ├─ API Tokens: Never Sent
  ├─ Service Account Tokens: Never Sent
  └─ User Email/Identity: Never Sent

Audit Trail:
  ├─ Who Did What: Not Sent to LLM
  └─ Access Logs: Not Sent to LLM

Metric Details:
  ├─ Raw Event Stream: Too Large, Summarized Instead
  ├─ Individual Request Details: Aggregated Instead
  └─ User Activity: Not Sent
```

### 9.2 Data Anonymization Before LLM Submission

```
Original Cluster Data:
  ├─ Pod Name: "database-prod-xyz-abc123"
  ├─ Deployment: "database-production"
  ├─ Namespace: "production"
  ├─ Label: app=customer-data
  ├─ Log: "Database connection from 192.168.1.100"
  └─ Error: "TLS handshake failed"

Anonymization Rules:
  ├─ Pod Names: RETAINED (needed for context)
  │   └─ Example: "database-prod-xyz-abc123"
  │
  ├─ Deployment Names: RETAINED (needed for context)
  │   └─ Example: "database-production"
  │
  ├─ Namespace: RETAINED (needed for RBAC context)
  │   └─ Example: "production"
  │
  ├─ Labels/Annotations: FILTERED
  │   ├─ app=customer-data → [REMOVED] (Business Sensitive)
  │   ├─ cost-center=12345 → [REMOVED] (Business Sensitive)
  │   └─ env=production → RETAINED (Needed)
  │
  ├─ IP Addresses: ANONYMIZED
  │   ├─ Original: 192.168.1.100
  │   ├─ Anonymized: 192.168.x.x
  │   └─ Context: Still Identifies Possible Internal/External
  │
  ├─ Domain Names: ANONYMIZED
  │   ├─ Original: database.company-internal.local
  │   ├─ Anonymized: database.internal.local
  │   └─ Context: Preserves Structure, Hides Company Name
  │
  └─ Secrets: REDACTED
      ├─ Original: TLS cert SHA256=abc123
      ├─ Redacted: TLS cert [REDACTED]
      └─ Context: Still Indicates Certificate Present

Anonymized Cluster Data (Sent to LLM):
  ├─ Pod Name: "database-prod-xyz-abc123"
  ├─ Deployment: "database-production"
  ├─ Namespace: "production"
  ├─ Label: app=production (Anonymized)
  ├─ Log: "Database connection from 192.168.x.x"
  └─ Error: "TLS handshake failed"
```

### 9.3 LLM Provider Data Retention Policies

**OpenAI:**
- Default: 30-Day Retention (API calls logged for 30 days)
- Option: Disable Data Retention (Request via Privacy Form)
- Configuration: Kubilitics Can Request 0-Day Retention
- Action: Send Data Retention Preference in API Request Header

**Anthropic:**
- Default: No Retention (Data Not Stored)
- Policy: API Calls Not Logged
- Configuration: No User Configuration Needed
- Action: Kubilitics Uses Anthropic by Default for Privacy

**Ollama (Local LLM):**
- Default: No Transmission (Data Stays Local)
- Policy: Completely Local Processing
- Configuration: User Runs Ollama on Own Infrastructure
- Action: Kubilitics Prioritizes Local LLM (If Available)

### 9.4 User Control Over LLM Usage

```
Kubilitics Settings: LLM Configuration

Option 1: Disable AI Features Entirely
  ├─ Setting: "AI Features: OFF"
  ├─ Result: No LLM Calls Made
  ├─ Recommendation: Unavailable
  └─ Use Case: Organizations That Don't Want External LLM Calls

Option 2: Use Local LLM Only (Ollama)
  ├─ Setting: "LLM Provider: Local (Ollama)"
  ├─ Configuration: Ollama Endpoint (e.g., localhost:11434)
  ├─ Result: All Queries Processed Locally
  ├─ Data Leak Risk: None
  └─ Use Case: Privacy-Critical Organizations

Option 3: Use Commercial LLM (With Data Retention Control)
  ├─ Setting: "LLM Provider: OpenAI"
  ├─ Configuration: API Key + Data Retention (0 days)
  ├─ Result: Queries Sent to OpenAI, Not Logged
  ├─ Data Leak Risk: Low (0-day Retention)
  └─ Use Case: Most Organizations

Option 4: Use Commercial LLM (Cost Optimization)
  ├─ Setting: "LLM Provider: Anthropic"
  ├─ Configuration: API Key
  ├─ Result: Queries Sent to Anthropic, Never Logged
  ├─ Data Leak Risk: Very Low
  └─ Use Case: Privacy-Conscious + Budget-Conscious

Admin Control:
  ├─ Setting: "Force Local LLM Only" (Deploy-Wide Policy)
  ├─ Effect: All Users Must Use Ollama
  ├─ Use Case: Government/Healthcare Deployments
  └─ Enforcement: API Rejects Requests to External LLM Providers
```

---

## 10. Backup & Recovery

### 10.1 Backup Strategy

```
Desktop Deployment

Source Data:
  ├─ SQLite Database: ~/.kubilitics/data/kubilitics.db
  ├─ AI Database: ~/.kubilitics/data/ai.db
  ├─ Configuration: ~/.kubilitics/config/settings.json
  └─ Size: Typically 100-500MB

Backup Method:
  ├─ Manual Backup (User-Initiated)
  │   ├─ UI Button: "Export Data" → ZIP File Download
  │   ├─ Contents: Encrypted Databases + Configuration
  │   ├─ Format: .kubilitics-backup (ZIP Archive)
  │   └─ Encryption: AES-256 (User Can Enter Password)
  │
  ├─ Automatic Backup (Optional)
  │   ├─ Frequency: Daily
  │   ├─ Destination: Cloud (Google Drive, Dropbox, iCloud)
  │   ├─ Encryption: Before Upload (User's Encryption Key)
  │   └─ Retention: Last 30 Backups
  │
  └─ Restore Process:
      ├─ User Provides Backup File
      ├─ Kubilitics Restores Databases
      ├─ Verification: Databases Integrity Check
      └─ Notification: "Data Restored Successfully"

In-Cluster Deployment

Source Data:
  ├─ PostgreSQL Database: Cloud Storage (AWS RDS, Google Cloud SQL)
  ├─ Configuration: Kubernetes ConfigMaps/Secrets
  ├─ Persistent Volumes: Investigation Data (if applicable)
  └─ Size: Depends on Cluster Size + History

Backup Method:
  ├─ Automated Backup (Cloud Service)
  │   ├─ Tool: Cloud Provider Native Backup (AWS Backup, etc.)
  │   ├─ Frequency: Daily (Configurable)
  │   ├─ Retention: 30 Days Rolling Window
  │   ├─ Encryption: Cloud Provider's KMS
  │   └─ Recovery: Point-in-Time Recovery Supported
  │
  ├─ Manual Backup (Administrator)
  │   ├─ Command: kubectl exec ... pg_dump > backup.sql
  │   ├─ Compression: gzip Compression
  │   ├─ Encryption: Before Storage (GPG or OpenSSL)
  │   └─ Storage: Secure Repository (Not in Git)
  │
  └─ Restore Process:
      ├─ Create New Database Instance
      ├─ Restore from Backup: pg_restore backup.sql
      ├─ Verification: Data Integrity Check
      ├─ Smoke Tests: Kubilitics Connects to Restored DB
      └─ Notification: "Recovery Complete"

Backup Encryption:
  ├─ Key: Encryption Key Stored Separately from Backup
  ├─ Location: Secure Key Store (HashiCorp Vault, AWS KMS)
  ├─ Rotation: Annual Key Rotation
  └─ Recovery: Key Must Be Available to Decrypt Backup
```

### 10.2 Disaster Recovery (DR)

| Parameter | Desktop | In-Cluster |
|---|---|---|
| **RTO (Recovery Time Objective)** | 1 Hour (Restore from Backup) | 4 Hours (Recreate Infrastructure) |
| **RPO (Recovery Point Objective)** | 1 Day (Daily Backups) | 1 Hour (Hourly Backups) |
| **Backup Location** | Cloud (Off-Device) | Cloud (Off-Cluster) |
| **Backup Frequency** | Daily | Hourly |
| **Retention** | 30 Days | 30 Days |
| **Encryption** | Yes (User's Key) | Yes (KMS) |
| **Testing** | Manual (User's Responsibility) | Quarterly DR Drill |

**Recovery Procedures:**

```
Desktop Recovery (Data Loss Scenario)

Trigger: User Accidentally Deletes Data
  ├─ Symptom: Investigations Missing from History
  ├─ User Action: Restore from Backup

Steps:
  1. Quit Kubilitics App
  2. Download Latest Backup
  3. Decrypt Backup (Enter Password if Encrypted)
  4. Replace ~/.kubilitics/data/kubilitics.db with Backup
  5. Restart Kubilitics App
  6. Verify: Investigations Restored

Result: Data Restored to Backup Point (1 Day Old)

In-Cluster Recovery (Database Failure)

Trigger: PostgreSQL Instance Becomes Unavailable
  ├─ Symptom: Kubilitics API Returns 503 Service Unavailable
  ├─ Error: "Cannot Connect to Database"

Steps:
  1. Declare Incident (P1 Critical)
  2. Identify Cause: Is Database Down? Check Cloud Console
  3. If Database Instance Crashed:
     a. Restore from Snapshot (Most Recent)
     b. Create New Instance from Snapshot
     c. Update Kubilitics Connection String
     d. Verify Connectivity: Test Query
  4. If Data Corruption:
     a. Restore to Point-in-Time (Before Corruption)
     b. Create New Database Instance
     c. Verify Data Integrity (Audit Logs OK?)
     d. Accept 1-Hour Data Loss (Most Recent Transactions Lost)
  5. Restart Kubilitics Pods

Result: Service Restored within 4 Hours
Loss: Investigations Created in Last Hour Are Lost
```

---

## 11. Data Governance Procedures

### 11.1 Data Classification Review (Quarterly)

```
Process: Data Classification is reviewed quarterly to ensure accuracy

Steps:
  1. Audit Team: Review all data stores
  2. Identify: Any new data types? Any reclassification needed?
  3. Classification: Assign or confirm classification level
  4. Controls: Verify appropriate security controls are in place
  5. Report: Document findings and remediation
  6. Approval: Security Team Approves
```

### 11.2 Access Control Review (Quarterly)

```
Process: Database access and permissions are audited quarterly

Steps:
  1. DBA: List all Database User Accounts
  2. Verify: Is Each User Still Active? Still Needed?
  3. Permissions: Do Permissions Match Current Role?
  4. Audit: Query Logs for Suspicious Activity
  5. Report: Document findings (Access Creep? Unused Accounts?)
  6. Remediation: Revoke Unnecessary Access
  7. Documentation: Update Access Control Matrix
```

### 11.3 Data Retention Audit (Annually)

```
Process: Annual audit of data retention practices

Steps:
  1. Query: Identify Data Older Than Retention Period
  2. Verify: Are These Records Supposed to Be Deleted?
  3. Baseline: Set Retention Periods by Data Category
  4. Test: Verify Auto-Deletion Works Correctly
  5. Gaps: Identify Any Data Not Scheduled for Deletion
  6. Remediation: Fix Retention Issues
  7. Report: Document Compliance Status
```

### 11.4 Privacy Impact Assessment (For Major Changes)

```
Process: DPIA conducted before deploying major features

Trigger: Any of the following
  ├─ New Data Category Collected
  ├─ New External Service Integration (Third-Party)
  ├─ New LLM Provider Integration
  ├─ New User Population (Different Geography/Regulation)
  └─ Significant Data Retention Change

DPIA Steps:
  1. Describe Processing: What Data? How Used? How Long Retained?
  2. Identify Risks: What Could Go Wrong?
  3. Assess Impact: How Many Users Affected? Severity?
  4. Mitigations: How to Reduce Risk?
  5. Residual Risk: Acceptable? Or Escalate?
  6. Approval: DPO (Data Protection Officer) Approves
  7. Documentation: Record Decision & Justification

Example: Integrating New LLM Provider (Claude)
  1. Describe: Send Investigation Context to Anthropic API
  2. Risks:
     - Data Sent to Third Party (Mitigated: Redaction)
     - Network Exposure (Mitigated: TLS)
     - Anthropic Data Retention (Mitigated: No Retention Policy)
  3. Impact: All Users Affected If Enabled
  4. Mitigations: Redact Secrets, Enforce TLS, Make Optional
  5. Residual Risk: Low (Anthropic Is Trusted Provider)
  6. Decision: Approved
  7. Implementation: Add Claude as Option in Settings
```

---

## Conclusion

Kubilitics' data architecture and privacy framework ensures that user data is protected at every stage: collection, storage, processing, and deletion. The system is designed with privacy as a first-class citizen, not an afterthought.

Key architectural decisions:
1. **Minimal Data Collection:** Only Data Necessary for Cluster Management
2. **Local-First Storage:** Data Stays with User (Desktop) or Cluster (In-Cluster)
3. **Encryption Everywhere:** In Transit (TLS), at Rest (AES-256)
4. **User Control:** Explicit Consent, Easy Deletion, Data Export
5. **Transparency:** Clear Documentation of Data Handling

This architecture enables Kubilitics to serve enterprise deployments with confidence that their sensitive cluster data is protected and compliant with regulations (GDPR, HIPAA, FedRAMP).

---

**Data Privacy Contact:** privacy@kubilitics.io
**Data Protection Officer:** dpo@kubilitics.io
**Incident Reporting:** security@kubilitics.io (Confidential)
