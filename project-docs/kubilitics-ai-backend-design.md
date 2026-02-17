# Kubilitics AI Backend — Complete Engineering Design Document

## Executive Summary

This document specifies the complete architectural design for kubilitics-ai, a new artificial intelligence subsystem that extends the Kubilitics platform with autonomous cluster analysis, intelligent recommendations, and safe action execution capabilities. The kubilitics-ai service is engineered as a completely independent subsystem that enhances the existing kubilitics-backend without introducing any backward compatibility risks or mandatory dependencies.

The fundamental design principle underlying this entire architecture is unidirectional dependency: kubilitics-ai depends entirely on kubilitics-backend for cluster data, cluster access, and command execution, but kubilitics-backend has zero knowledge of and zero dependency on kubilitics-ai. If the AI service crashes, is not deployed, or is disabled, the entire kubilitics platform continues to function perfectly. This design ensures that the AI subsystem can be deployed, updated, and iterated independently without affecting the stability or availability of the core platform.

The kubilitics-ai service will run as a separate process on port 8081, communicating with kubilitics-backend via gRPC for cluster information and command execution. It exposes its own REST API on the same port for frontend integration, plus WebSocket and Server-Sent Events endpoints for streaming AI responses. The service is built in Go 1.24, matching the version and technology stack of the existing backend, ensuring consistency across the codebase and leveraging the same operational patterns.

This document provides the complete architectural specification for every component, system, and integration point, serving as the definitive engineering guide for the kubilitics-ai implementation.

---

## Section 1: kubilitics-ai Subsystem Architecture

### Overall Subsystem Design

The kubilitics-ai service represents a complete, self-contained subsystem within the Kubilitics ecosystem. Unlike microservices that are tightly integrated with the platform's core API, kubilitics-ai is deliberately designed to be isolatable and independently deployable. The entire subsystem is organized as a separate Go project with its own module, dependencies, build pipeline, and deployment configuration.

The directory structure reflects the layered architecture of the system, with clear separation between the entry point, API handlers, internal business logic, integration points, and shared types. This organization supports the principle of unidirectional dependency while providing clear boundaries for testing, maintenance, and future evolution.

### Directory Structure and Organization

The kubilitics-ai project uses the following directory structure at the root level of the repository:

**kubilitics-ai/** - The root directory of the entire AI subsystem project, existing as a top-level directory alongside kubilitics-backend and kubilitics-frontend.

**kubilitics-ai/cmd/server/** - The command line entry point for the kubilitics-ai service. This directory contains the main function that initializes the entire application, parsing configuration, setting up logging, creating database connections, initializing the gRPC client to kubilitics-backend, starting the HTTP server, and handling graceful shutdown. The entry point is minimal and delegates actual startup logic to internal packages. This directory contains only the main.go file and possibly a version.go file for build-time version injection.

**kubilitics-ai/internal/api/** - All HTTP REST API handlers exposed to the frontend. This package contains the handler functions for every REST endpoint that the frontend calls. It organizes handlers into logical groups: health endpoints, configuration endpoints, investigation endpoints, insight endpoints, action endpoints, analytics endpoints, and usage endpoints. Each logical group may be organized in its own file or subdirectory. The api package is responsible for HTTP request parsing, validation, and response serialization, delegating business logic to service packages.

**kubilitics-ai/internal/api/ws/** - WebSocket and Server-Sent Events handler implementations. This subpackage manages persistent connections for streaming AI responses back to the frontend. It handles connection lifecycle (upgrade, maintain, close), message framing, error handling, and backpressure from slow clients. The WebSocket implementation is used for bidirectional communication in the chat interface, while SSE is exposed as an alternative for environments where WebSocket is not available.

**kubilitics-ai/internal/mcp/** - The Model Context Protocol (MCP) server implementation. This package contains the entire MCP server that operates embedded within the kubilitics-ai process. The MCP server is the gateway through which the LLM interacts with Kubernetes resources. It implements the MCP protocol, manages tool registry, handles tool invocations, and coordinates with the tool implementations. This is the single point of LLM interaction with the cluster — no LLM has any direct API access to Kubernetes or kubilitics-backend.

**kubilitics-ai/internal/tools/** - Implementation of all MCP tools organized into Tier 1 (observation), Tier 2 (analysis), Tier 3 (recommendation), and Tier 4 (execution) tools. Each tool is independently implemented in its own file or subpackage. Tools handle their specific domain of functionality (resource listing, log retrieval, metrics analysis, etc.) and report results back to the MCP server. This package coordinates with the gRPC client for cluster data, the analytics engine for computed insights, and the safety engine for mutation gating.

**kubilitics-ai/internal/reasoning/** - The reasoning orchestrator that drives multi-step investigation flows. This package contains the investigation lifecycle manager that coordinates the entire process from trigger to conclusion. It manages context gathering (which data is relevant?), hypothesis generation (what are plausible explanations?), tool execution (what tools should we invoke?), validation (does the data support our hypothesis?), and conclusion (what is our final diagnosis?). The reasoning engine interacts with the LLM adapter, tool registry, safety engine, and memory system.

**kubilitics-ai/internal/llm/** - The LLM adapter layer providing a unified interface to all supported LLM providers. This package abstracts the differences between OpenAI, Anthropic, Ollama, and custom OpenAI-compatible endpoints. It manages connection pooling, streaming response handling, token counting, cost estimation, fallback logic, and provider-specific response parsing. The LLM package is designed to support adding new providers with minimal changes to the core reasoning engine.

**kubilitics-ai/internal/analytics/** - The analytics engine implementing all statistical analysis, anomaly detection, trend forecasting, and capacity planning features. This package contains no machine learning — only classical statistical methods. It operates on time-series data from cluster metrics, computing moving averages, standard deviations, linear trends, seasonal patterns, and anomalies. All computations are fast and local, with no external service calls required.

**kubilitics-ai/internal/safety/** - The safety and policy engine that enforces the five autonomy levels and immutable safety rules. This package evaluates every potential action against the configured autonomy level and policy definitions. It calculates blast radius, checks against immutable constraints, performs dry-run validation, tracks automatic rollback triggers, and coordinates human escalation. The safety engine is the final arbiter of what actions can execute.

**kubilitics-ai/internal/memory/** - Storage and retrieval of investigation histories, insights, audit logs, analytics data, learned patterns, and optional vector embeddings. This package provides both in-memory (World Model, hot cache) and persistent storage (SQLite/PostgreSQL). It manages database schema, migrations, retention policies, and data downsampling. The memory package abstracts storage details from the rest of the application.

**kubilitics-ai/internal/integration/** - The gRPC client for kubilitics-backend integration. This package handles the client connection to kubilitics-backend's gRPC server, maintains streaming subscriptions for cluster state changes, implements the synchronization protocol (initial full sync plus incremental updates), handles disconnection and reconnection, and provides a simple interface to other packages for querying cluster data and executing commands. This is the sole point of contact with the existing backend.

**kubilitics-ai/internal/config/** - Configuration management including loading from environment variables, configuration files, command line flags, and runtime updates. This package defines all configuration parameters (LLM provider, API keys, autonomy level, database connection strings, cache TTLs, etc.), provides type-safe access throughout the application, and handles configuration validation. Configuration changes trigger appropriate service updates without requiring restart.

**kubilitics-ai/internal/models/** - Data models and types shared throughout the internal packages. This includes Investigation, Insight, Action, Tool, MCP message types, analytics results, and other domain types. These types are purely internal to kubilitics-ai and are not exposed to external clients (external clients use the REST API representation).

**kubilitics-ai/internal/cache/** - Caching layer providing TTL-based caching for tool results, LLM responses, and computed analytics. This package implements cache eviction policies, manages memory usage, tracks cache hit/miss rates for observability, and integrates with the metrics system.

**kubilitics-ai/internal/audit/** - Structured audit logging of all consequential operations, particularly mutations. Every action, recommendation, tool invocation, and configuration change is logged in structured format with correlation IDs, timestamps, user information, and results. The audit log is immutable and forms the basis for observability and debugging.

**kubilitics-ai/pkg/types/** - Public types exported for external consumers. This package provides a minimal public API surface for any future integrations or client libraries. It includes types relevant to external consumers: investigation status, insight definitions, action proposals, and health status. This package is carefully curated to include only information meant to be external-facing.

**kubilitics-ai/api/proto/** - Protocol Buffer definitions for gRPC communication between kubilitics-ai and kubilitics-backend. These files define the gRPC service contracts, request/response message types, and streaming protocols. The compiled Go code from these protos is generated and included in internal/integration.

**kubilitics-ai/Makefile** - Build configuration separate from kubilitics-backend. The Makefile defines targets for building the kubilitics-ai binary, running tests, code generation (protobuf compilation), linting, and deployment. Build artifacts are produced in a separate output directory from the backend to avoid conflicts.

**kubilitics-ai/go.mod and go.mod.lock** - The Go module file is completely separate from kubilitics-backend's module. This allows kubilitics-ai to have its own dependency versions, supporting different versions of dependencies if needed. The separation also means that building and deploying kubilitics-ai has no impact on kubilitics-backend's dependency resolution.

### Module and Build Configuration

The kubilitics-ai project is a standalone Go module with its own go.mod file at kubilitics-ai/go.mod. The module path is typically github.com/kubilitics/kubilitics-ai (or similar, depending on the actual repository structure). This separation is intentional and important: it means that kubilitics-ai can have different versions of shared dependencies than kubilitics-backend if needed, and changes to kubilitics-ai dependencies do not affect building or deploying kubilitics-backend.

The go.mod file includes dependencies on:
- google.golang.org/grpc and google.golang.org/protobuf (for gRPC communication with kubilitics-backend)
- net/http standard library (for REST API and WebSocket)
- database/sql, github.com/lib/pq, modernc.org/sqlite (for database access)
- context, sync, log/slog (for standard runtime requirements)
- Any LLM provider SDKs: github.com/openai/openai-go, github.com/anthropics/anthropic-sdk-go, etc.
- Optional: github.com/qdrant/go-client (for Qdrant vector search), chromadb client (if using Chroma), etc.

The build output is a single binary, kubilitics-ai, which can be executed with configuration passed via environment variables or a config file. The binary has no external runtime dependencies beyond the host OS, making it highly portable and suitable for containerization.

### Dependency Management and Isolation

The architectural principle of complete isolation is reinforced through dependency management. kubilitics-ai depends on kubilitics-backend (via gRPC) but the backend has no reciprocal dependency. At the code level, kubilitics-ai imports no code from kubilitics-backend — it only communicates via gRPC APIs.

This isolation extends to shared infrastructure:
- Database: kubilitics-ai uses its own SQLite database (desktop) or PostgreSQL schema (in-cluster), completely separate from any kubilitics-backend database
- Cache: kubilitics-ai has its own in-memory cache and Redis connection (if configured), not shared with the backend
- Configuration: kubilitics-ai has its own configuration system, environment variables, and config files
- Logging: kubilitics-ai has its own logging setup (though it may send to the same log aggregation service)
- Metrics: kubilitics-ai exports its own Prometheus metrics on the /metrics endpoint

This isolation means that any failure, misconfiguration, or unintended behavior in kubilitics-ai cannot affect kubilitics-backend or kubilitics-frontend.

---

## Section 2: Integration Architecture with kubilitics-backend

### The Unidirectional Dependency Model

The integration between kubilitics-ai and kubilitics-backend is architected as a strict unidirectional dependency. kubilitics-ai depends entirely on kubilitics-backend for all cluster information, cluster access, and action execution. The backend, however, has no awareness of kubilitics-ai's existence and no code that references or depends on the AI subsystem.

This design has several critical implications:

First, kubilitics-backend can be deployed, updated, restarted, or removed without any impact to kubilitics-ai's build or deployment process. The backend does not require kubilitics-ai to be present in order to build or run. This means that teams can continue to develop and release kubilitics-backend on their own timeline, independent of AI subsystem development.

Second, kubilitics-ai is entirely optional. In deployments where AI capabilities are not needed, kubilitics-ai simply is not deployed. The platform works perfectly without it. There are no mandatory dependencies, no required configuration, no feature flags that must be enabled. The absence of kubilitics-ai is silently handled — investigations cannot be started, insights are not generated, but the core platform functions.

Third, if kubilitics-ai crashes, becomes unreachable, or is in an error state, kubilitics-backend and kubilitics-frontend continue to operate without degradation. Users may notice that AI features are unavailable, but they continue to manage their clusters via the traditional REST API and WebSocket interfaces.

This unidirectional dependency is achieved through gRPC communication. kubilitics-backend exposes a new gRPC server (new code, but additive and behind a feature flag). kubilitics-ai acts as a gRPC client to that server. The communication is initiated entirely from kubilitics-ai's side.

### gRPC Service Contract

kubilitics-backend exposes a new gRPC service called ClusterDataService (or similar name, to be determined during implementation). This service provides read-only access to cluster data and the ability to execute commands. The service is defined in Protocol Buffer files within the api/proto/ directory of kubilitics-backend.

The ClusterDataService exposes the following primary methods:

**StreamClusterState** - A server-streaming RPC that kubilitics-ai subscribes to on startup. This method continuously streams all cluster state changes: resource creation, updates, and deletion events; pod logs; metric updates; event creation; and health status changes. The stream is the primary means by which kubilitics-ai learns about cluster state. The backend maintains the stream until the client disconnects or a timeout occurs. If the stream disconnects, kubilitics-ai automatically reconnects with backoff.

**GetResource** - A unary RPC that retrieves the full definition of a single Kubernetes resource. kubilitics-ai calls this when it needs complete details about a specific resource, often to perform analysis or comparisons.

**ListResources** - A unary RPC that returns a list of resources matching a filter (resource type, namespace, labels, annotations). kubilitics-ai uses this for bulk resource discovery and filtering operations.

**ExecuteCommand** - A unary RPC that executes a Kubernetes command (patch, scale, delete, apply) on behalf of kubilitics-ai. The backend performs all authorization checks and returns the result. This is the sole mechanism through which kubilitics-ai can mutate cluster state.

**GetTopologyGraph** - A unary RPC that returns the dependency graph of Kubernetes resources (which resources depend on which others). kubilitics-ai uses this for calculating blast radius and understanding change impact.

**GetClusterHealth** - A unary RPC that returns the overall health status of the connected clusters and any errors or warnings.

The Protocol Buffer definitions for these services are stored in kubilitics-backend/api/proto/, compiled to Go code, and the Go gRPC client stubs are generated. kubilitics-ai includes these generated files in internal/integration/, allowing it to call the backend services.

### World Model: kubilitics-ai's View of Reality

kubilitics-ai does not directly query Kubernetes. Instead, it maintains an in-memory data structure called the World Model, which represents the current state of all connected clusters. This World Model is built and continuously updated by the StreamClusterState subscription from kubilitics-backend.

The World Model consists of:
- A complete inventory of all Kubernetes resources (pods, deployments, services, etc.) across all connected clusters
- Metadata associated with each resource: labels, annotations, ownership references
- Current status information: pod phase, replica counts, resource usage
- Recent events associated with resources
- Health and readiness status of all components
- Any computed relationships between resources (the topology graph)

The World Model is always in-memory for low-latency access. kubilitics-ai does not make HTTP requests to Kubernetes or kubilitics-backend for basic resource lookups — it queries its in-memory World Model. This design provides very fast response times for investigations and significantly reduces the load on kubilitics-backend.

The World Model is rebuilt on startup with a full sync from kubilitics-backend, then continuously updated by the StreamClusterState subscription. Every change event from the backend updates the corresponding entry in the World Model.

### Synchronization Protocol: Full Sync and Incremental Updates

On startup, kubilitics-ai initiates a synchronization sequence with kubilitics-backend:

The bootstrap phase begins when kubilitics-ai starts. It establishes a gRPC connection to kubilitics-backend and calls an initialization RPC that returns a full snapshot of the current cluster state. This snapshot includes all resources, their current status, recent events, and the topology graph. kubilitics-ai receives this full state in a single batch and populates the World Model. This initialization is necessary to ensure that kubilitics-ai does not miss any state that existed before it started.

After the full sync completes, kubilitics-ai subscribes to the StreamClusterState RPC. This is a long-lived streaming RPC that the backend maintains. Whenever any cluster state changes, the backend pushes a state change event to all subscribers. kubilitics-ai receives these events and updates the World Model incrementally. This ensures that kubilitics-ai's view of reality stays synchronized with the actual cluster state.

State change events include resource creation, modification, and deletion; pod log entries; metric updates; and event generation. Each event is timestamped and includes the resource involved, the change type, and the new state (if applicable).

If the StreamClusterState subscription is interrupted (client disconnect, server restart, network partition), kubilitics-ai detects the disconnection and automatically reconnects. It performs another full sync to ensure it did not miss any state changes during the disconnection, then resumes streaming updates. This mechanism ensures that kubilitics-ai never gets out of sync with the actual cluster state, even in the face of transient network issues.

### Failure Handling and Graceful Degradation

The gRPC connection to kubilitics-backend is not always available. Networks fail, services restart, version incompatibilities arise. kubilitics-ai is designed to handle these failures gracefully.

If kubilitics-backend becomes unreachable, kubilitics-ai cannot make new gRPC calls or receive updates. However, the system degrades gracefully rather than failing completely. kubilitics-ai continues to operate using its cached World Model. Investigations can still proceed using the cached cluster state. The system marks all insights and conclusions as "stale", indicating that they are based on potentially outdated information. The frontend is notified that the backend connection is degraded, and users understand that real-time data is not available.

When kubilitics-backend comes back online, kubilitics-ai automatically reconnects, performs a full sync to catch up on missed state changes, and clears the "stale" flags from insights. The system transparently recovers.

If kubilitics-backend is unreachable when kubilitics-ai starts, the AI service waits with exponential backoff to establish a connection. It will not consider itself fully operational until it has successfully synced with the backend at least once. The health check endpoint returns a "starting up" status until this initial connection succeeds.

For action execution, if the backend connection is down, kubilitics-ai cannot execute any mutations. Proposed actions are queued and marked as "pending backend availability". Once the backend connection is restored, queued actions are executed in order.

### Command Execution: kubilitics-ai as a Client of kubilitics-backend

When kubilitics-ai determines that an action should be executed (either automatically based on autonomy level, or after human approval), it calls the ExecuteCommand RPC on kubilitics-backend. It does not directly call Kubernetes APIs.

The ExecuteCommand RPC includes:
- The command type (patch, scale, delete, apply, etc.)
- The target resource (namespace, kind, name)
- The command parameters (new replica count for scaling, patch JSON for patching, etc.)
- A reason/audit string explaining why kubilitics-ai is requesting this action
- The autonomy level at which the action is being executed

kubilitics-backend receives the request and:
1. Verifies that the authenticated user (or the kubilitics-ai service account) has permission to perform this action in this namespace
2. Executes the command against the actual Kubernetes cluster
3. Returns the result (success or error)
4. Creates an audit log entry recording the action

kubilitics-ai receives the result and records it in its own action history. If the action succeeded, it updates the World Model immediately (though it will also be updated by the StreamClusterState subscription). If it failed, the failure reason is recorded and the user is notified.

This architecture means that all command execution goes through kubilitics-backend, which maintains complete visibility and audit trails of all actions. kubilitics-ai cannot directly modify the cluster; it must request modifications through the backend. This provides a centralized control point and ensures that the backend's RBAC and audit systems cover all AI-initiated changes.

### Backend Modifications: Minimal and Additive

The changes required to kubilitics-backend are minimal and entirely additive:

A new package internal/grpc/ is created in kubilitics-backend. This package contains the gRPC server implementation that exposes the ClusterDataService. The gRPC server listens on a configurable port (likely 8082 or 50051, to be determined). The server uses existing code from kubilitics-backend to query Kubernetes and build the cluster state. No existing REST API or WebSocket code is modified.

The gRPC server is started alongside the existing HTTP server in cmd/server/main.go. A simple flag (--enable-grpc, or controlled by an environment variable) controls whether the gRPC server starts. By default, the flag is off, so existing deployments are unaffected.

The existing kubilitics-backend code continues to work exactly as before. The REST API endpoints, WebSocket connections, and all existing features function identically. The gRPC server is purely additive.

kubilitics-backend's existing code for resource enumeration, event tracking, metrics retrieval, and topology building is reused by the gRPC server. No significant new business logic is required.

Backward compatibility is complete. Deployments without kubilitics-ai do not enable the gRPC server and are completely unaffected. Deployments that enable kubilitics-ai enable the gRPC server, but the existing REST API and WebSocket functionality remains unchanged.

---

## Section 3: REST API Design (kubilitics-ai to Frontend)

### Overview and Design Principles

kubilitics-ai exposes a comprehensive REST API to the frontend, providing all user-facing AI features. The REST API is designed around resource-oriented principles, with clear and consistent endpoint patterns. All endpoints use JSON for request and response bodies. All endpoints return standard HTTP status codes: 200 for success, 201 for creation, 204 for no content, 400 for client errors, 401 for authentication, 403 for authorization, 404 for not found, 500 for server errors.

The API is versioned at /api/v1/, allowing for future API evolution. Clients always specify the version explicitly in request URLs. All responses include appropriate Content-Type headers and use camelCase for JSON field names.

Authentication and authorization are inherited from the frontend's existing authentication system. The frontend calls kubilitics-ai endpoints on behalf of the authenticated user. kubilitics-ai verifies that the user is authenticated (via token passed by the frontend) and enforces any necessary authorization rules.

### Health and Configuration Endpoints

**GET /health** - Health check endpoint that returns immediately with a 200 status if kubilitics-ai is operational. The response is a JSON object with a single "status" field set to "healthy" (or "unhealthy" if degraded). This endpoint is used by orchestration systems (Docker, Kubernetes) to determine if the service is alive.

**GET /api/v1/ai/status** - Returns the current operational status of the AI subsystem. The response includes the overall status (operational, degraded, offline), the configured LLM provider (OpenAI, Anthropic, Ollama, etc.), the specific model (GPT-4, Claude 3.5 Sonnet, etc.), whether the model supports streaming, the current autonomy level, whether the backend connection is active, and any error messages if the status is degraded. This endpoint is called on frontend load to determine what AI features are available.

**GET /api/v1/ai/config** - Returns the current AI configuration. The response includes the provider, model, autonomy level, enabled features (chat, investigations, recommendations, actions), database backend (SQLite or PostgreSQL), vector memory provider (if configured), and user preferences. Sensitive data like API keys are never included in the response.

**PUT /api/v1/ai/config** - Updates AI configuration. The request body includes fields for provider, model, autonomy level, etc. Each field is optional; only provided fields are updated. The endpoint validates the configuration (e.g., checking that the provider is recognized, that the model is supported by that provider). After update, the configuration is persisted and kubilitics-ai may reinitialize relevant subsystems (e.g., if the LLM provider changes, reinitialize the LLM adapter).

**POST /api/v1/ai/config/test** - Tests the current AI configuration by attempting to connect to the configured LLM provider and querying it. The response indicates success or failure, including any error details. This endpoint is used by the frontend to allow users to validate their configuration before saving it.

### Investigation Endpoints

Investigations represent focused analysis work initiated by users or the system. An investigation has a unique ID, a query or trigger, status (running, completed, failed), and results including findings, recommendations, and proposed actions.

**POST /api/v1/ai/investigate** - Starts a new investigation. The request body includes a query string (the user's question or problem description) and optional metadata (resource type and name to focus on, investigation type: diagnostic, informational, predictive, remediation). The response includes the investigation ID, status, and a WebSocket URL for streaming investigation progress. The investigation runs asynchronously. Immediately after returning, the investigation begins executing in the background.

**GET /api/v1/ai/investigations** - Lists recent investigations. The response includes an array of investigation summaries, sorted by creation time descending. Each summary includes ID, query, status, creation time, completion time, and a one-line summary of findings. The endpoint supports pagination (limit and offset query parameters) and filtering by status.

**GET /api/v1/ai/investigations/{id}** - Retrieves the full details of a specific investigation. The response includes all metadata, the complete reasoning chain (how did the AI arrive at its conclusions?), tool invocations (what tools were called and in what order?), findings (what did the AI learn?), confidence score (how confident is the AI in its conclusions?), recommendations (what does the AI recommend?), and proposed actions (what specific cluster mutations does the AI suggest?).

**DELETE /api/v1/ai/investigations/{id}** - Deletes an investigation and all its associated data from the database. This is a hard delete and cannot be undone. Only completed or failed investigations can be deleted; running investigations must be cancelled first.

**POST /api/v1/ai/investigations/{id}/cancel** - Cancels a running investigation. The response indicates success. If the investigation is not running, the endpoint returns a 400 error.

### Insights Endpoints

Insights are conclusions that kubilitics-ai has reached about the cluster's state. An insight represents a specific finding: a problem detected, a best practice violation, a trend observed, a pattern recognized. Insights are generated as a result of investigations and can also be generated continuously as kubilitics-ai monitors the cluster.

**GET /api/v1/ai/insights** - Lists all current insights. The response includes an array of insight objects. Each insight includes a unique ID, the insight type (problem, opportunity, warning, info), severity level (critical, high, medium, low, info), the resource involved (resource type, namespace, name), a title, a detailed description, when it was discovered, whether it has been dismissed by the user, and the investigation that generated it. The endpoint supports filtering by severity, type, resource kind, and namespace. It also supports pagination.

**GET /api/v1/ai/insights/resource/{kind}/{namespace}/{name}** - Retrieves all insights related to a specific resource. The response is an array of insights filtered to only those involving the named resource. This endpoint is used when the user is viewing a specific resource in the UI and wants to see what AI has to say about it.

**POST /api/v1/ai/insights/{id}/dismiss** - Marks an insight as dismissed by the user. The insight is not deleted but is marked as acknowledged and is no longer displayed in the default insights list. The response confirms the action.

**POST /api/v1/ai/insights/{id}/investigate** - Starts a new investigation to dive deeper into a specific insight. The request body may include additional context or questions. The response includes the new investigation ID.

### Actions Endpoints

Actions are proposed or executed cluster mutations that kubilitics-ai has determined are necessary. Actions go through a lifecycle: proposed, approved (or rejected), executing, completed (or rolled back).

**GET /api/v1/ai/actions/pending** - Lists all pending action proposals awaiting human approval. The response includes an array of action proposal objects. Each includes an ID, the resource involved, the action type (scale, patch, restart, etc.), a description of what will change, the reason (why does kubilitics-ai propose this?), estimated impact, estimated risk, and confidence. This endpoint is used to show the user a list of awaiting-approval actions.

**POST /api/v1/ai/actions/{id}/approve** - Approves a pending action proposal, allowing kubilitics-ai to execute it. The request body may include optional notes from the user. The response indicates that the action is now scheduled for execution and returns the action ID.

**POST /api/v1/ai/actions/{id}/reject** - Rejects a pending action proposal, preventing kubilitics-ai from executing it. The request body should include a reason for rejection. The response confirms rejection and the action is discarded.

**GET /api/v1/ai/actions/history** - Retrieves the history of executed actions. The response includes an array of action execution records. Each record includes the action ID, resource, action type, when it was executed, who approved it, the result (success or failure), and any error messages. The endpoint supports filtering by status and resource, and pagination.

### Analytics Endpoints

Analytics provide insights into cluster usage, trends, and predictions without investigations. These are the continuous background analysis that kubilitics-ai performs.

**GET /api/v1/ai/analytics/summary** - Returns a high-level summary of cluster analytics across all clusters. The response includes total resource counts, average utilization (CPU, memory, network), top consumers, cost estimates, and detected trends or anomalies. This is displayed on the AI dashboard.

**GET /api/v1/ai/analytics/resource/{kind}/{namespace}/{name}** - Returns detailed analytics for a specific resource. The response includes historical CPU and memory usage, network I/O, cost, predicted future usage (capacity planning), anomalies detected, and comparisons to similar resources. This endpoint is called when the user views a specific resource in the UI.

**GET /api/v1/ai/analytics/predictions** - Returns predictive insights based on historical trends. The response includes capacity predictions (when will this namespace or cluster run out of resources?), cost projections (estimated monthly spend based on current trends), workload patterns (recurring spikes, seasonal patterns), and remediation suggestions (scale up now to avoid future constraints).

### Chat Endpoints

The chat interface allows users to have conversational interactions with the AI, more freeform than the structured investigation endpoints.

**WebSocket /api/v1/ai/chat** - Opens a WebSocket connection for bidirectional chat. The client sends message frames containing the user's query. kubilitics-ai streams back the response in message frames. The protocol is JSON: client sends {"query": "...", "context": {...}}, server responds with {"message": "...", "type": "analysis|recommendation|action_proposal|error", "confidence": 0.85, "tools_used": [...], "done": false/true}. Multiple message frames may be sent before "done": true.

**SSE /api/v1/ai/chat/stream** - Server-Sent Events alternative to WebSocket chat. The client sends a POST request with the query in the body. kubilitics-ai streams back the response as server-sent events, one JSON object per event. The client receives the same format as WebSocket but over HTTP. This is provided for compatibility with environments where WebSocket is not available.

### Usage Endpoints

Usage endpoints provide visibility into API usage, token consumption, and budget tracking.

**GET /api/v1/ai/usage** - Returns current usage statistics. The response includes the number of investigations run, total tokens consumed (broken down by provider), estimated costs, the current rate of usage (tokens/hour), and the timeframe for usage aggregation (current day, week, month).

**GET /api/v1/ai/usage/budget** - Returns budget status and limits if configured. The response includes the configured budget limit (tokens per month, or cost per month), the current consumption toward that limit, the remaining budget, and warning status (safe, warning, critical). If no budget is configured, the response indicates that budgets are not enabled.

### Error Responses

All endpoints return consistent error responses. A 4xx or 5xx response includes a JSON body with error details: {"error": "error code", "message": "human readable message", "details": {...}}. Error codes are standardized (invalid_request, not_found, permission_denied, internal_error, service_unavailable, etc.). This consistency allows frontends to handle errors predictably.

---

## Section 4: MCP Server Design (The AI's Tool Layer)

### MCP Server Architecture and Role

The Model Context Protocol (MCP) Server runs as an embedded component within the kubilitics-ai process. It is not a separate service; it runs in the same memory space as the reasoning engine, analytics engine, and all other kubilitics-ai components. The MCP Server is the exclusive interface through which the large language model interacts with Kubernetes and cluster data.

This design enforces a crucial architectural principle: the LLM never directly calls Kubernetes APIs, never directly calls kubilitics-backend APIs, and never directly accesses databases. All interaction is mediated through the MCP Server, which provides carefully designed tools. This mediation layer is critical for several reasons.

First, it enforces safety. The MCP Server implements all safety checks before allowing a tool to execute. Mutations are gated by the safety engine. Dangerous operations are prohibited or require additional approval. The LLM cannot bypass these controls.

Second, it enables observability. Every tool invocation is logged and tracked. kubilitics-ai maintains complete visibility into what the LLM is doing, what tools it's using, and what results it's getting. This is essential for debugging, auditing, and understanding the reasoning process.

Third, it enables caching and optimization. The MCP Server can cache tool results, avoiding redundant work. It can batch related operations. It can implement retry logic transparently.

Fourth, it enables cost control. Every tool invocation can be tracked and counted. kubilitics-ai can implement rate limiting and cost budgets.

The MCP Server implements the MCP protocol specification. It maintains a tool registry (the set of available tools), handles tool invocation requests from the LLM, executes the requested tool, and returns results back to the LLM. For streaming operations (like logs), it handles the streaming protocol appropriately.

### Tool Taxonomy and Organization

Tools are organized into four tiers based on their role and safety implications.

**Tier 1: Observation Tools** provide read-only access to cluster information. These tools never modify cluster state. They have minimal safety implications. These tools are:

- **list_resources**: Lists Kubernetes resources of a specified kind, optionally filtered by namespace, labels, or annotations. The response is a structured list of resource identifiers and basic metadata. This is the tool kubilitics-ai uses to discover resources matching specific criteria.

- **get_resource**: Retrieves the complete definition of a specific Kubernetes resource. The response is the full resource object in JSON format, including all metadata, spec, and status fields. This tool is used when detailed information about a specific resource is needed.

- **get_resource_yaml**: Returns the raw YAML representation of a resource, as it would appear in a kubectl get -o yaml output. Some operations are easier to perform on YAML than on parsed objects, so this tool provides that representation.

- **get_events**: Retrieves the Kubernetes events associated with a specific resource. The response includes the event objects: when they occurred, what triggered them, the message and reason, and the involved object. This tool is used to understand the history of what happened to a resource.

- **get_logs**: Retrieves logs from a pod or container. The tool accepts parameters for the pod name, namespace, container name, and number of lines. It also accepts a "semantic hint" parameter: natural language describing what the user is looking for in the logs (e.g., "errors", "authentication failures", "startup messages"). The tool uses this hint to help filter or summarize the logs. The response is the log text.

- **get_metrics**: Retrieves current and historical metrics for a resource. The tool accepts parameters for the resource type, name, namespace, and metric types (CPU, memory, network, disk). The response is time-series data: metric values at different timestamps over the requested period.

- **get_topology**: Retrieves the dependency graph of resources related to a specific resource. The response includes the resource and all resources that depend on it or that it depends on. This helps kubilitics-ai understand the blast radius of changes.

- **search_resources**: Performs full-text or pattern-based search across all resources. The tool accepts a search query (label selector, annotation matcher, name pattern, or natural language description). The response is a list of matching resources. This tool is used for discovering resources without knowing exactly what you're looking for.

Each of these Tier 1 tools is expected to be called dozens or hundreds of times during a single investigation. They must be fast and must not overload the backend.

**Tier 2: Analysis Tools** compute insights by analyzing data from Tier 1 tools. These tools do not access Kubernetes directly; they operate on data retrieved by Tier 1 tools or provided by the reasoning engine. They have minimal safety implications. These tools are:

- **diff_resources**: Compares two versions of a resource (e.g., current vs. previous revision, current vs. desired state). The tool accepts two resource representations and returns a structured diff showing what changed.

- **analyze_trends**: Performs statistical analysis on metric time-series data. The tool accepts historical metric data and returns analysis results: moving averages, trends (increasing/decreasing/stable), anomalies, and forecasts. The tool uses classical statistical methods only.

- **simulate_impact**: Predicts the impact of a proposed change. The tool accepts a resource, a proposed change, and returns an estimate of: which other resources would be affected, what the estimated blast radius is, whether the change would violate any constraints, and what the expected outcome would be.

- **check_best_practices**: Evaluates a resource against Kubernetes best practices. The tool checks for: appropriate resource requests and limits, health checks, appropriate replica counts, security policies, image tagging, and other standard practices. The response is a list of findings (what best practices are being followed, what are being violated).

- **calculate_blast_radius**: Determines the set of resources affected by a change to a specific resource. The tool uses the topology graph to trace dependencies. The response is a structured set of affected resources grouped by type and severity of impact.

- **correlate_events**: Finds events that are likely related (occurred around the same time, involved related resources, or have related reasons). The tool accepts a timeframe and resource, and returns correlated events. This is used to understand patterns and root causes.

- **explain_resource**: Generates a natural language explanation of what a resource is, what it does, and why it might exist. The response is a prose explanation suitable for showing to the user.

Each of these Tier 2 tools operates on data already retrieved by Tier 1 tools. They do not make new requests to the backend or Kubernetes.

**Tier 3: Recommendation Tools** produce formal outputs that are presented to the user. These tools do not mutate state. These tools are:

- **draft_recommendation**: Formally records an AI recommendation. The tool accepts a title, description, resource involved, impact (positive/negative/neutral), confidence (0-100%), and reasoning. The tool creates a formal Recommendation object that is persisted and presented to the user.

- **create_insight**: Creates an Insight object that is displayed to the user. The tool accepts insight type, severity, title, description, and resource involved. The insight is persisted and immediately available via the REST API.

- **generate_report**: Creates a structured report object. The tool accepts a title, sections (with descriptions and findings), recommendations, and actions proposed. The report is persisted and available for the user to review.

**Tier 4: Execution Tools** perform mutations on the cluster. These tools are the most restricted. Every execution tool is gated by the safety engine. The tools are:

- **patch_resource**: Applies a JSON Patch or strategic merge patch to a Kubernetes resource. The tool accepts the resource identifier and the patch as parameters. The tool calls through to the safety engine for approval, then executes the command via kubilitics-backend.

- **scale_resource**: Changes the replica count of a Deployment or StatefulSet. The tool accepts the resource identifier and the target replica count. Like all execution tools, it's gated by the safety engine.

- **restart_rollout**: Restarts a Deployment or StatefulSet rollout, causing new pods to be created. The tool accepts the resource identifier and optional parameters for how to perform the restart.

- **rollback_rollout**: Rolls a Deployment or StatefulSet back to a previous revision. The tool accepts the resource identifier and optionally the specific revision to roll back to.

- **delete_resource**: Deletes a Kubernetes resource. The tool accepts the resource identifier and optional parameters (grace period, propagation policy). This is the most dangerous operation and is heavily restricted.

- **apply_resource**: Applies a resource definition (as YAML or JSON). The tool accepts the resource definition. This is used for applying configuration changes, creating new resources, etc.

Each execution tool performs a dry-run first (unless prohibited by configuration), allowing the reasoning engine to see what the actual impact would be before committing to the change. The tool then executes the actual command, monitors the result, and reports back.

### Tool Implementation Details

Each tool is implemented as a handler function that takes parameters, executes the tool's logic, and returns results. The handler function signature is consistent across all tools, allowing the MCP Server to invoke them generically.

Tool results are structured and type-safe. Rather than returning arbitrary text, tools return structured objects (JSON). For example, list_resources returns an array of resource objects, each with name, namespace, kind, creation time, etc. This structure allows the reasoning engine to process results programmatically.

Tools implement caching where appropriate. If list_resources is called twice with the same filter, the second call returns cached results (if the cache hasn't expired). If get_resource is called for the same resource, cached results are returned. The cache respects TTLs: resource metadata cache expires after a few minutes, metric cache expires after seconds.

Tools have consistent error handling. If a tool fails, it returns a structured error response that includes the error code (not_found, permission_denied, invalid_input, service_unavailable, etc.) and a message. The reasoning engine can detect and handle these errors appropriately.

Tools are instrumented for observability. Every tool invocation is logged with the tool name, input parameters, execution time, and result. This information is captured in the investigation trace and audit log.

### Tool Safety and Gating

Tier 1 and Tier 2 tools have no safety gates. They can be called freely by the reasoning engine.

Tier 3 tools (recommendations) are checked for consistency and quality before execution. The safety engine verifies that the recommendation is coherent and reasonable. However, they do not mutate state.

Tier 4 tools (execution) all funnel through a single gating point in the safety engine. Before any execution tool is invoked, the safety engine evaluates:

1. Is the current autonomy level sufficient for this action? (Level 1 prevents all actions, Level 2 prevents all actions, Level 3 allows safe actions, etc.)
2. Does the action violate any immutable safety rules? (Never delete from kube-system, never scale beyond limits, etc.)
3. If the action is dangerous, has the user explicitly approved it?
4. What is the calculated blast radius? Is it acceptable?
5. If automatic rollback is configured, are the metrics stable enough to roll back if needed?

If all checks pass, the execution tool proceeds. If any check fails, the tool returns an error and the action is not executed.

### Streaming and Backpressure

Some tools stream results (like logs, continuous metrics). The MCP Server handles streaming by sending results incrementally and respecting backpressure. If the LLM client is slow to consume responses, the server slows down sending. This prevents memory buildup and ensures graceful degradation under load.

Tools can also accept streaming parameters. For example, a continuous monitoring tool might stream metrics as they arrive, rather than returning a single batch response.

### Caching and Optimization

The tool layer implements intelligent caching to reduce load on kubilitics-backend and improve response times.

Tool result caching stores the results of Tier 1 tools. Calling list_resources with identical parameters returns cached results if they are still fresh (typically 1-2 minutes). This is safe because the World Model is being continuously updated by the gRPC stream from kubilitics-backend; if a resource changes, the cache will be invalidated.

LLM response caching stores responses from tools that might be called multiple times with identical parameters. If the reasoning engine asks for the same resource twice in the same investigation, the second call returns cached results.

Analytics cache stores computed metrics and trends. If analyze_trends is called with the same metric data, cached results are returned until the underlying metric data changes.

Caching is transparent to the reasoning engine. The caching layer sits between the reasoning engine and the actual tool implementations.

Cache invalidation is driven by updates from the World Model. When a resource is updated by an event from kubilitics-backend, any cached tool results involving that resource are invalidated. This ensures that cached data is always approximately current.

---

## Section 5: Reasoning Engine (The Brain)

### Investigation Lifecycle and Workflow

The reasoning engine is the orchestrator that drives the entire investigation process from user query to insight generation and action proposal. It manages a multi-step workflow that gathers context, formulates hypotheses, executes tools, validates conclusions, and generates outputs.

An investigation begins when a user submits a query (either via the REST API investigate endpoint or via chat). The query might be "Why is the payment service down?" or "What's consuming all the memory in production?" or "Recommend optimizations for the data pipeline". The query might target a specific resource or be cluster-wide. The reasoning engine receives the query and its metadata and begins the investigation.

**Trigger Phase**: The investigation enters the trigger phase when the user submits a query. The reasoning engine classifies the query into one of four investigation types: Diagnostic (determining why something is broken), Informational (answering a question about state), Predictive (determining what will happen), or Remediation (fixing a problem). The classification guides the investigation approach. For a diagnostic query like "Why is the payment service down?", the engine knows it should look for problems, anomalies, and error conditions. For an informational query like "What's the memory usage of the payment service?", it should gather metrics. The classification also determines the initial hypothesis to explore.

**Context Gathering Phase**: The investigation enters context gathering. The reasoning engine examines the query and any metadata provided (focused resource, namespace, cluster). It formulates an initial set of context-gathering questions: What resources are involved? What is the current state of these resources? What events have occurred recently? What metrics show? What constraints and dependencies exist? The reasoning engine invokes Tier 1 observation tools to gather this context. For a resource-specific query, it calls get_resource to retrieve full details. It calls get_events to see recent activity. It calls get_metrics to see usage patterns. It calls get_topology to understand dependencies. It calls search_resources if the resource name is ambiguous. These tool calls may be made in parallel if safe. The gathered context is assembled into a context window: a structured representation of everything known about the situation.

**Hypothesis Generation Phase**: Using the context, the LLM generates one or more hypotheses that might explain the situation. For "Why is the payment service down?", hypotheses might include: "Pod is in crash loop due to configuration error", "Service is overloaded and timing out", "Dependent service is down", "Resource quota exceeded", "Network policy is blocking traffic", etc. Each hypothesis is a plausible explanation that can be tested. The LLM is instructed to generate 2-5 hypotheses, not just one. This diversity helps avoid confirmation bias.

**Tool Execution Phase**: For each hypothesis, the reasoning engine determines what tools need to be invoked to test it. For "Pod is in crash loop", it might call get_logs to see error messages, get_events to see crash details, and check_best_practices to see if configuration is wrong. For "Dependent service is down", it might call get_topology to identify dependencies and then get_resource and get_events for each dependent service. The reasoning engine invokes these tools and collects results. Tools that are independent are called in parallel. Tools that depend on results from earlier tools are called sequentially. The reasoning engine keeps track of what has been learned and doesn't call the same tool twice with the same parameters.

**Validation Phase**: As evidence accumulates, the reasoning engine evaluates each hypothesis against the evidence. Is the pod really in crash loop? Does the evidence support this? Does it rule out other hypotheses? The reasoning engine keeps a confidence score for each hypothesis. As evidence comes in, some hypotheses become more likely, others less likely. The investigation continues until one hypothesis reaches high confidence (typically 80%+) or until all evidence has been gathered.

**Conclusion Phase**: Once the dominant hypothesis reaches high confidence, the investigation enters the conclusion phase. The reasoning engine synthesizes the evidence into a conclusion: a statement of what is happening, why it's happening, and how certain the AI is. The conclusion includes reference to the specific evidence (logs showing X, metrics showing Y, events showing Z).

**Action Proposal Phase**: Based on the conclusion, the reasoning engine generates action proposals. These are specific, executable mutations that would remediate the problem or address the situation. For "Pod is in crash loop due to configuration error", the proposal might be "Update the deployment to use correct configuration". For "Service is overloaded", it might be "Scale the deployment from 3 to 5 replicas". Action proposals include a description of what will happen, the expected impact, the risk, and the reasoning behind it.

**Insight Generation and Output Phase**: The reasoning engine creates formal insights from the findings. These are structured records of the AI's conclusions that are stored and displayed to the user. Insights are formatted for human consumption: clear titles, descriptions, severity levels, and links to proposed actions.

Throughout this entire lifecycle, the reasoning engine maintains a reasoning trace: a record of every step, every tool invocation, every result, and every decision. This trace is persisted in the investigation record and shown to the user, providing complete transparency into how the AI arrived at its conclusions.

### Context Window Management

The LLM has a finite context window (the maximum number of tokens it can process in a single request). Different models have different limits: GPT-4 might have 128k tokens, Claude 3.5 Sonnet might have 200k tokens. The reasoning engine must fit all relevant information into this context window while leaving room for the LLM to generate responses.

The reasoning engine implements a context builder that intelligently constructs the context window. It starts by determining the model's context limit and estimating how many tokens are available for input (leaving space for the response). It then assembles context in priority order: the system prompt (instructions for the AI), the user's query, the investigation type and classification, the gathered context (resources, events, metrics), and the hypotheses.

As context is assembled, the context builder tracks token usage. If approaching the limit, it progressively drops lower-priority information. The lowest priority is historical metric data; the highest priority is recent events and errors. This ensures that the most important information is never dropped.

If the total gathered context exceeds the available space, the reasoning engine does not simply truncate it. Instead, it summarizes. It calls analyze_trends on metrics (producing summaries rather than raw time-series), it calls explain_resource to get prose descriptions rather than full resource definitions, it summarizes events (grouping related events together). The goal is to fit the most important information in the available space.

Different LLM models have different token limits and different token counting. The reasoning engine tracks which model is configured and accounts for its specific limitations.

### Prompt Engineering and System Prompts

The reasoning engine provides a carefully crafted system prompt to the LLM that defines its role, constraints, and capabilities. The system prompt is included in every LLM request.

The system prompt establishes:

The LLM's role: "You are an expert Kubernetes operations assistant. Your job is to diagnose problems, answer questions, and propose solutions related to Kubernetes clusters."

Its constraints: "You can only invoke the tools provided. You cannot make HTTP requests, access files, or perform actions outside your tools. Always validate your conclusions against available evidence. Never make up information."

Its investigation methodology: "Follow a structured investigation process. First, clarify the problem. Second, gather context. Third, generate hypotheses. Fourth, test hypotheses. Fifth, validate conclusions. Always explain your reasoning."

How to interact with tools: "You have access to the following tools: [detailed tool descriptions]. Call them like this: [examples]. Each tool returns structured results that you should parse and analyze."

Safety and authorization: "Some actions require authorization. Always check if an action is safe before proposing it. Consider the blast radius and potential impact. Never propose dangerous actions without explaining the risks."

The system prompt is not static. It varies based on the autonomy level, LLM provider, and investigation type. For a diagnostic investigation, the system prompt emphasizes diagnosis. For a remediation investigation, it emphasizes safe action execution.

The system prompt is carefully tuned to produce good behavior. It uses examples, constraints, and explicit instructions. The LLM is instructed to think step-by-step, to justify conclusions, to avoid assumptions, and to ask clarifying questions if needed.

### Chain-of-Thought Enforcement

The reasoning engine enforces Chain-of-Thought (CoT) reasoning, requiring the LLM to show its work. Rather than jumping directly to conclusions, the LLM is instructed to explain its reasoning: "Before proposing a solution, explain your diagnostic reasoning. List the evidence you found. State your hypothesis and why you believe it. List alternative hypotheses you considered and why you ruled them out. Then state your conclusion."

This enforces better reasoning and produces more accurate conclusions. It also provides transparency: the user can see exactly why the AI reached its conclusion.

CoT is enforced through the system prompt and through explicit instructions in each request. The reasoning engine parses the LLM's response and validates that it includes reasoning before jumping to conclusions. If the response jumps straight to conclusions without reasoning, the reasoning engine can prompt for more detail.

### Investigation Types and Specialized Workflows

The reasoning engine handles different investigation types with specialized workflows.

**Diagnostic investigations** follow the hypothesis-testing workflow described above. The goal is to determine why something is not working as expected. The LLM is given specific prompting to diagnose: look for error conditions, unusual state, recent changes, resource constraints, dependency failures, etc.

**Informational investigations** are questions about the current state. "Tell me about the payment service deployment" or "What resources are running in the production namespace?" For these, the reasoning engine gathers all relevant information and asks the LLM to provide an explanation or summary. No hypothesis testing is needed; the goal is to understand and explain.

**Predictive investigations** attempt to forecast future states based on current trends. "If we don't scale up the database, when will we run out of disk space?" The reasoning engine gathers historical metrics, calls analyze_trends, calls simulate_impact with different scenarios, and asks the LLM to make predictions based on this data.

**Remediation investigations** are focused on fixing a problem. The reasoning engine not only diagnoses but also proposes specific solutions. After determining the root cause, it calls simulate_impact on proposed actions, consults the safety engine, and generates action proposals with explicit steps the user can take.

### Parallel Tool Execution

When multiple tools can be invoked in parallel (they don't depend on each other's results), the reasoning engine invokes them concurrently. For example, when gathering context for a resource, it can call get_resource, get_events, and get_metrics in parallel, then proceed once all results are available.

Parallel execution significantly speeds up investigations. An investigation that would take 5 seconds if tools run sequentially (5 × 1 second) might take only 1.5 seconds if tools run in parallel (max latency of 1.5 seconds among all tools). This is important for user experience.

The reasoning engine respects back-end rate limiting and does not overwhelm kubilitics-backend with parallel requests. It limits parallelism to a configurable maximum (e.g., 10 concurrent tool invocations).

### Reasoning Loops and Iteration

If a hypothesis reaches high confidence, the investigation proceeds to conclusion. If no hypothesis reaches high confidence after gathering all context, the reasoning engine enters an iteration phase.

In the iteration phase, the reasoning engine formulates new, more targeted questions. "The evidence doesn't clearly point to any hypothesis. Let me dig deeper into the logs." It calls more specific tools: get_logs with a semantic hint for a specific error, correlate_events to find related events, check_best_practices to see if configuration is problematic. Based on these more targeted results, it re-evaluates hypotheses.

This iteration continues until one hypothesis reaches high confidence or until the reasoning engine determines that it has exhausted available information. If after iteration the confidence remains low, the investigation concludes with a "partially diagnosed" status and explicitly tells the user that more information or manual investigation is needed.

The maximum number of iterations is configurable (typically 3-5). After reaching the maximum, the investigation concludes even if confidence is not high, preventing infinite loops.

### Confidence Scoring

Every investigation conclusion includes a confidence score from 0 to 100%. This represents the AI's confidence in its diagnosis.

Confidence is calculated based on:

The quality of supporting evidence: If the conclusion is supported by multiple independent lines of evidence (logs showing error X, events showing error X, metrics showing problem Y), confidence is higher. If the conclusion is based on inference with limited evidence, confidence is lower.

The clarity of the diagnosis: If the diagnosis is specific and testable ("Pod is in CrashLoopBackOff due to configuration error: missing environment variable FOO"), confidence is higher. If the diagnosis is vague ("Something might be wrong"), confidence is lower.

The strength of alternative explanations: If one hypothesis is much more likely than alternatives, confidence is high. If multiple hypotheses are about equally likely, confidence is lower.

The certainty of the data: If recent metric data clearly shows a trend, confidence is higher. If the data is sparse or noisy, confidence is lower.

The reasoning engine explicitly reports confidence to the user. High confidence (80%+) means "the AI is quite sure about this diagnosis". Medium confidence (50-80%) means "the AI thinks this is likely but is not certain". Low confidence (<50%) means "the AI has a guess but is not confident; manual verification is strongly recommended".

### Explainability and Reasoning Chains

Explainability is a core design principle. Every conclusion the AI draws includes an explanation of how it arrived there.

The reasoning chain is a structured record of every step in the investigation: the hypothesis tested, the tools invoked, the results, the evidence evaluation, and the conclusion. This chain is included in the investigation details returned to the user.

When the user asks "Why did you think the pod was in crash loop?", the system can show them: "I checked the pod events (event: CrashLoopBackOff), I retrieved the pod logs (log: 'java.lang.NullPointerException: missing environment variable'), I verified the deployment configuration (config: 'env vars do not include required FOO'). This evidence strongly supports the crash loop diagnosis."

This explainability is crucial for building user trust in the system and for allowing the user to validate the AI's reasoning.

---

## Section 6: LLM Adapter Layer (BYO-LLM)

### Design Principles and Provider Abstraction

The kubilitics-ai system supports "Bring Your Own LLM" (BYO-LLM). Users can deploy kubilitics-ai with their choice of LLM provider: OpenAI's cloud API, Anthropic's Claude API, a local Ollama instance, or any OpenAI-compatible endpoint. The architecture abstracts the differences between these providers behind a unified interface.

The reasoning engine does not directly call an LLM provider. Instead, it calls the LLM adapter, which translates the call to whatever provider is configured. This abstraction allows switching between providers by changing configuration, without modifying any reasoning engine code.

The adapter layer handles:

Provider selection and initialization: Given a provider name (openai, anthropic, ollama, openai_compatible) and configuration (API key, endpoint, model name), the adapter creates a provider client.

Unified request/response format: Regardless of the underlying provider, the reasoning engine uses a consistent format to request completions. The adapter translates to each provider's native format.

Streaming support: All providers must support streaming responses. The adapter normalizes streaming across providers.

Token counting: Different providers define tokens differently. The adapter counts tokens consistently.

Cost estimation: The adapter tracks token usage per provider and estimates costs.

Error handling: Provider-specific errors are translated to standard error codes.

Provider Implementations: OpenAI, Anthropic, Ollama, OpenAI-compatible

The adapter supports four categories of providers.

**OpenAI**: Supports GPT-4, GPT-4o, GPT-3.5-turbo, and other OpenAI models via the Chat Completions API. The adapter uses the official OpenAI Go SDK (github.com/openai/openai-go). Configuration requires an API key and a model name. Streaming is supported via the OpenAI streaming API. Token counting uses the tiktoken library. Cost tracking uses OpenAI's published pricing (updated periodically in configuration). Fallback is supported: if the configured model is unavailable, fall back to a secondary model.

**Anthropic**: Supports Claude 3.5 Sonnet, Claude 3 Opus, Claude 3 Haiku, and other Claude models via the Messages API. The adapter uses the official Anthropic Go SDK (github.com/anthropics/anthropic-sdk-go). Configuration requires an API key and a model name. Streaming is supported via the Anthropic streaming API. Token counting uses Anthropic's token counting API or the tokenizers package. Cost tracking uses Anthropic's published pricing. Fallback is supported.

**Ollama**: Supports any model available via a local Ollama instance (llama3, mistral, neural-chat, codellama, etc.). Ollama provides an OpenAI-compatible API, so the adapter can treat it as an OpenAI-compatible endpoint. Configuration requires the Ollama endpoint URL and a model name. Streaming is supported. Token counting estimates tokens based on character count (since local models don't provide accurate token counting). Cost tracking is zero (local models have no API costs, though they do have compute costs). Ollama is suitable for deployments where cloud APIs are not available or where data residency is required.

**OpenAI-Compatible**: Supports any endpoint that implements OpenAI's Chat Completions API format. This includes Mistral's API, vLLM local deployments, and other compatible services. Configuration requires the endpoint URL, API key (if required), and model name. Streaming is supported. Token counting and cost estimation are as provided by the compatible endpoint.

### Token Management and Budgeting

The LLM adapter tracks token usage for all interactions. Every request to the LLM is tracked: input tokens, output tokens, total tokens. This information is recorded for observability and cost tracking.

Token budgeting is supported through the safety engine. If a budget is configured (e.g., "spend no more than 1M tokens per month"), the adapter checks usage before each request. If the request would exceed the budget, it is rejected (or escalated to require human approval, depending on configuration).

Rate limiting is implemented per provider. Some providers have rate limits (e.g., OpenAI has limits on requests per minute). The adapter respects these limits and queues requests if needed.

### Fallback Strategy

If the primary LLM provider is unavailable, the adapter can fall back to a secondary provider. This is configured at startup. For example, the configuration might be: "Primary: OpenAI GPT-4, Fallback: Anthropic Claude 3.5 Sonnet". If OpenAI is unavailable, the adapter automatically switches to Anthropic.

Fallback is transparent to the reasoning engine. It simply sees the request succeed via a different provider.

Fallback is also the mechanism for handling provider outages. If a provider becomes unavailable mid-investigation, the investigation can continue using the fallback provider.

### Streaming Support

All providers must support streaming responses. The LLM adapter normalizes streaming across all providers.

For the reasoning engine's perspective, streaming works like this: the reasoning engine sends a request with streaming enabled. The adapter returns immediately with a response stream (a channel or iterator). The reasoning engine consumes responses from the stream as they arrive. As the LLM generates tokens, the adapter immediately returns them to the reasoning engine, which can process partial results in real-time.

Streaming is important for a couple reasons. First, it allows the frontend to display results as they arrive, rather than waiting for the entire response. This improves perceived performance. Second, it reduces peak memory usage; the adapter doesn't need to buffer the entire response before returning it.

### Model Capability Detection

Different LLM models have different capabilities. Some support function calling, some don't. Some support structured output via JSON mode, some don't. Some have extremely large context windows, others don't.

The LLM adapter detects the capabilities of the configured model on startup. It queries the provider for model details, or uses hardcoded knowledge about known models. The capabilities are exposed to the reasoning engine via a capabilities structure.

If the model doesn't support function calling natively, the adapter emulates it via prompt engineering. The reasoning engine can still invoke tools, but the adapter handles the translation to the model's native format.

If the model supports JSON structured output, the adapter uses that for MCP tool invocations, ensuring more reliable parsing of results.

### Cost Tracking

The LLM adapter maintains detailed cost tracking. Every request is tracked with input tokens, output tokens, and cost. Costs are estimated based on the provider's pricing.

For providers with published per-token pricing (OpenAI, Anthropic, etc.), the adapter multiplies token counts by the rates. For local models (Ollama), costs are zero (or can be configured with an estimated per-token compute cost).

Total costs are aggregated by timeframe (per hour, per day, per month) and per provider. This information is exposed via the REST API usage endpoints, allowing users to monitor spending.

### Context Window Management

Different models have different context window sizes. GPT-4 has 128k tokens, Claude 3.5 Sonnet has 200k tokens, some models might have only 4k tokens.

The LLM adapter knows the context window of the configured model. It exposes this limit to the reasoning engine, which uses it to manage the context builder (described in the reasoning engine section).

If a request would exceed the context window, the adapter rejects it with a clear error before sending it to the provider (which would also reject it). This allows the reasoning engine to handle context limitations gracefully.

### Response Parsing

Different providers return responses in slightly different formats. The LLM adapter normalizes these to a standard format.

For chat completions, the adapter returns a structured response with: the generated text, the number of input and output tokens, the stop reason (completed, length limit, tool invocation, etc.), and provider-specific metadata.

For streaming responses, the adapter returns a stream of deltas (partial responses). The reasoning engine assembles these deltas into the complete response.

If the provider supports structured output (JSON mode), the adapter uses that for responses that need to be parsed structurally. For other responses, the adapter attempts to parse the text into structured formats if needed.

---

## Section 7: Analytics Engine (Intelligence Without ML)

### Approach and Statistical Methods

The analytics engine provides insights into cluster usage, trends, and predictions without using machine learning. All analysis is based on classical statistical methods: moving averages, standard deviations, linear regression, and other techniques that are fast, interpretable, and do not require training data.

The analytics engine operates on time-series metrics: CPU usage, memory usage, network bandwidth, disk space, request latency, error rates, etc. These metrics are collected from kubilitics-backend (which gets them from Kubernetes APIs and monitoring systems). The analytics engine stores these metrics in SQLite (for desktop deployments) or PostgreSQL (for in-cluster deployments) with configurable retention periods.

The analytics engine runs both in real-time (as metrics arrive) and on-demand (when investigating a specific issue or generating reports). Computationally expensive analyses are run periodically (e.g., every hour) and results are cached.

### Time-Series Analysis

The analytics engine stores time-series data as a series of (timestamp, value) pairs for each metric. Common metrics include:

Pod CPU usage: the CPU consumed by a pod, sampled every 15-30 seconds.

Pod memory usage: the memory consumed by a pod, sampled every 15-30 seconds.

Node CPU availability: the CPU available on a Kubernetes node.

Node memory availability: the memory available on a Kubernetes node.

Network ingress and egress bytes: traffic in and out of pods.

Request latency: latencies of requests (if the application exposes this metric).

Request error rate: percentage of requests resulting in errors.

Storage usage: used and available storage space.

The analytics engine provides tools for analyzing these time-series:

**Moving averages**: Computes the average value over a sliding window (e.g., the 5-minute moving average, the 1-hour moving average). Moving averages smooth out noise and short-term fluctuations, revealing trends.

**Standard deviation**: Computes the standard deviation of values within a window, measuring variability. High standard deviation indicates instability or high variance.

**Linear regression**: Fits a line to the time-series data, determining if the trend is increasing, decreasing, or flat. The slope indicates the rate of change. This is used for capacity planning: if memory usage is increasing at 100MB per day, when will the pod exceed its memory limit?

**Seasonal decomposition**: Identifies seasonal patterns in metrics (e.g., higher CPU usage during business hours, lower during nights). This is used to understand normal vs. abnormal behavior.

### Anomaly Detection

The analytics engine implements multiple anomaly detection algorithms, all based on classical statistics, not machine learning.

**Z-score based detection**: For each data point, compute the Z-score (how many standard deviations is it from the mean?). If the Z-score exceeds a threshold (typically 2-3), the point is flagged as anomalous. This detects sudden spikes or drops.

**IQR-based detection**: Compute the interquartile range (IQR) of the data. Values below Q1 - 1.5*IQR or above Q3 + 1.5*IQR are flagged as outliers. This is robust to extreme values.

**Rolling window comparison**: Compare recent values to historical averages. If the recent average is significantly different from the historical average, flag as anomalous. This detects shifts in behavior.

**Threshold-based detection**: If values exceed configured thresholds (e.g., CPU > 80%), flag as anomalous. This is user-configured and domain-specific.

Each anomaly is flagged with a severity: critical (immediate investigation recommended), high (should investigate soon), medium (monitor), or low (informational).

### Trend Forecasting

The analytics engine forecasts future metrics using simple extrapolation. If memory usage is currently 60% and increasing at 2% per day, what will it be in 7 days? The answer is 74% (approximately).

Trend forecasting uses linear regression to determine the current trend, then extrapolates the line into the future. The forecast includes a confidence interval: the actual value might deviate from the forecast due to noise.

Trend forecasting is limited to short-term predictions (days to weeks, not months). Long-term forecasts are unreliable because trends change.

### Resource Utilization Scoring

The analytics engine assigns a utilization score to each resource (pod, namespace, node) on a scale of 0-100%. The score reflects how efficiently the resource is being used.

A resource has a score of 100% if it is fully utilized: CPU and memory usage are near the requested limits. A score of 20% means the resource is under-utilized: it's consuming only a small fraction of what it requested.

The utilization score is used to identify:

**Over-provisioned resources**: Resources requesting too much and using too little. These waste cluster capacity.

**Under-provisioned resources**: Resources requesting too little but using most or all of what's requested. These are at risk of throttling or crashes.

**Efficient resources**: Resources requesting the right amount and using most of it. These are well-tuned.

The analytics engine recommends actions based on utilization: "Scale down this deployment (currently 20% utilized)", "Increase memory limits on this pod (currently using 90% of limit)", etc.

### Cost Estimation

The analytics engine estimates cluster costs based on resource usage and the cloud provider's pricing.

For cloud-hosted Kubernetes (AWS EKS, Google GKE, Azure AKS), the analytics engine knows the pricing of different instance types. It aggregates resource requests and usage across the cluster and estimates the monthly cost.

For on-premises Kubernetes, the analytics engine can use a configured cost per resource unit (e.g., "$0.05 per CPU-hour") to estimate costs.

Cost estimation is broken down by namespace and workload, identifying which applications consume the most resources (and thus cost the most).

### Pattern Detection

The analytics engine identifies recurring patterns in metrics: failure patterns, deployment impact patterns, resource usage patterns.

**Recurring failure patterns**: If a pod crashes every morning at 6am, or every Friday at 5pm, this is a recurring failure pattern. The analytics engine detects this and alerts the user: "This pod crashes on a schedule; there's likely a batch job or scheduled event that triggers the crash."

**Deployment impact patterns**: When a deployment is updated, what happens to metrics? Does request latency increase? Does error rate spike? The analytics engine tracks the impact of deployments and can predict the impact of future deployments.

**Resource usage patterns**: Does the application have busy hours and quiet hours? Does resource usage vary by day of week? The analytics engine detects these patterns and uses them to forecast.

### Storage and Retention

The analytics engine stores metrics in SQLite (desktop) or PostgreSQL (in-cluster). The schema includes:

A metrics table: (metric_name, resource_type, resource_name, namespace, timestamp, value, unit). Example: (cpu, pod, payment-service-abc123, production, 2025-02-10 14:30:00, 450, millicores).

Time-series indices: indexed by metric_name, resource, and timestamp for efficient querying.

Raw metrics are retained for a configurable period (typically 7-30 days, configurable per deployment). Older raw metrics are downsampled: instead of storing every 30-second sample, 1-hour aggregates (average, min, max, count) are stored. These downsampled metrics are retained for much longer (months to years).

Retention policies are configurable per metric type. High-priority metrics (errors, resource constraints) might be retained longer than low-priority metrics (informational).

Data downsampling is automatic. A background job runs periodically (e.g., daily) and downsamples old data. This keeps the database size manageable while preserving useful historical information.

---

## Section 8: Safety & Policy Engine

### Five Autonomy Levels

The safety engine implements five levels of autonomy that define how much the AI can do without human intervention. The user selects the autonomy level via configuration. Different organizations might choose different levels based on their risk tolerance.

**Level 1: Observe**. The AI can only observe and report. It gathers information, analyzes it, and generates insights. It cannot propose actions or recommendations. It cannot execute any mutations. This level is for deployments where the AI is purely informational and humans make all decisions.

**Level 2: Recommend**. The AI can observe and make recommendations. It gathers information, analyzes it, generates insights, and recommends actions ("You should scale down this over-provisioned deployment"). However, it does not propose specific actions to the system and certainly does not execute anything. Humans read the recommendations and decide whether to act on them. This level is for deployments where the AI is a "smart advisor" but humans retain full control.

**Level 3: Propose**. The AI can observe, recommend, and propose specific actions. It identifies a problem, diagnoses the cause, recommends a solution, and proposes a specific action ("Approve this patch to deployment X"). The action is shown to the user with full details (what will change, why, risk assessment). The user must explicitly approve before the action executes. This level is for deployments where the AI suggests concrete actions but humans must approve each one.

**Level 4: Act with Guard**. The AI can execute safe actions automatically without human approval, but asks for approval on dangerous actions. "Safe" actions are defined by immutable safety rules (see below). Examples of safe actions: scaling a deployment within configured limits, restarting a pod, patching a configuration. "Dangerous" actions (deleting resources, scaling beyond limits, modifying RBAC) require explicit human approval before executing. This level is for deployments where the AI can manage routine operations automatically but escalates to humans for risky decisions.

**Level 5: Full Autonomous**. The AI executes all actions autonomously within the bounds of configured safety policies. No human approval is required. However, the AI still respects safety rules (never delete from kube-system, never exceed limits, etc.) and can automatically roll back changes if they cause problems. This level is only for deployments with very high confidence in the AI system and extensive safety policies.

The autonomy level is specified at configuration time and can be changed at runtime (though changing from low to high levels requires explicit confirmation from the user).

### Immutable Safety Rules

Immutable safety rules are hardcoded constraints that cannot be disabled or overridden. These rules apply at all autonomy levels. Even Level 5 (Full Autonomous) respects these rules.

The immutable rules are:

**Never delete more than N% of pods in a namespace at once**. This prevents accidental cascading failures. For example, if N=25%, the AI can delete at most 25% of pods in a namespace in a single action. This ensures that the application remains partially functional.

**Never scale beyond configured maximum**. Each resource has a configured maximum replica count (e.g., maximum 100 pods for a deployment). The AI never scales beyond this, preventing runaway scaling due to bugs or misconfigurations.

**Never modify resources in protected namespaces**. Namespaces like kube-system, kube-public, and kube-node-lease are protected. The AI can read from these namespaces but cannot modify anything. This prevents accidental damage to cluster infrastructure.

**Never execute during maintenance windows**. If maintenance windows are configured (e.g., "no changes between midnight and 2am"), the AI does not execute mutations during these windows. It queues actions for execution after the window closes.

**Always create audit entry before mutation**. Before every mutation, the AI creates an audit log entry that records: what is about to change, why, who authorized it, and at what time. This ensures complete auditability.

**Never execute the same action twice in a short timeframe**. If the AI just restarted a pod, it doesn't immediately restart it again if the same problem occurs. This prevents thrashing.

These rules are implemented as guards in the safety engine. Before any action is executed, the safety engine checks every rule. If any rule is violated, the action is blocked. The user (if an approval workflow is in place) is notified of the violation and can take alternative action.

### User-Configurable Policies

In addition to immutable rules, the user can define policies in YAML that constrain the AI's behavior further. Policies are specific to each organization and deployment.

Example policies:

```
max_scale_per_action: 10  # Limit scaling to 10 pods per action
namespace_constraints:
  production:
    max_pods: 500
    no_delete_resources: true
  staging:
    max_pods: 100
safe_scaling_window:
  enabled: true
  day_of_week: "weekday"
  hours: "10-16"
critical_labels:
  - critical=true
  - missioncritical=true
# Actions on resources with these labels require extra approval
```

Policies are loaded at startup and can be reloaded at runtime without restarting kubilitics-ai. If policies are updated and make a pending action non-compliant, the action is failed.

### Blast Radius Calculation

Before every mutation, the safety engine calculates the blast radius: the set of resources that would be affected by the change and the severity of impact.

To calculate blast radius, the safety engine uses the resource topology graph (obtained from kubilitics-backend). It starts with the target resource and traces dependencies: which resources depend on the target? If we stop this pod, which services go down? If we patch this configuration, which deployments restart?

The blast radius includes:

Direct impacts: the resource being changed itself.

Indirect impacts: resources that depend on the target. If we delete a service, pods that depend on it are impacted.

Cascade impacts: resources that depend on impacted resources. If pods depending on a service are impacted, other services depending on those pods might be impacted.

The impact severity is estimated: critical (service goes down), high (performance degrades), medium (minor impact), low (no meaningful impact).

The blast radius is presented to the user or decision-maker. For high-risk actions, a large blast radius triggers escalation or cancellation.

### Dry-Run Execution

Before executing any mutation, the safety engine requests a dry-run execution from kubilitics-backend. The dry-run applies the change to the cluster without actually committing it. Kubernetes returns what the change would do (what fields would change, what side effects would occur).

The dry-run result is compared to expectations. If the dry-run shows unexpected changes (e.g., the patch would affect a field that was not intended), the action is flagged for review.

For some resource types, dry-run is not possible. In these cases, the safety engine may require extra approval or may refuse to execute.

### Automatic Rollback

The safety engine can be configured with automatic rollback triggers. If an action is executed and metrics immediately degrade, the action is automatically reverted.

For example: "If we scale a deployment from 3 to 5 replicas and request latency increases more than 20% within 2 minutes, automatically scale back to 3."

Automatic rollback is only enabled if:
1. Automatic rollback is configured
2. The action is executed with Level 4 or 5 autonomy (lower levels require human approval)
3. The necessary metrics are available and healthy
4. The rollback action is itself safe (e.g., scaling back down is always safe)

When rollback occurs, an audit log entry records the automatic rollback with the reason (metrics degraded).

### Human Escalation

If the AI's confidence in a proposed action is below a threshold (e.g., 60%), or if the action triggers safety warnings, the action is escalated to a human for approval even at higher autonomy levels.

Escalation is also triggered if:
- The blast radius is large
- The action is outside the safe operating envelope
- The action is of a dangerous type (delete, major patch)
- Resource constraints are near limits

Escalation means: stop automatic execution, notify the user (via the REST API or alerts), wait for explicit user approval via the REST API action approval endpoint, then execute if approved.

### Dead Man's Switch

If kubilitics-ai loses contact with kubilitics-backend (the gRPC connection is down), it automatically reverts to Level 1 (Observe) mode. No mutations can be executed. No actions can be proposed. The system operates in read-only mode until the backend connection is restored.

This "dead man's switch" prevents the AI from taking unilateral action when it cannot communicate with the backend. It ensures that if communication is lost, the system becomes conservative.

---

## Section 9: Memory & Storage Architecture

### In-Memory Storage: The World Model

kubilitics-ai maintains an in-memory representation of the entire cluster state called the World Model. The World Model is populated on startup with a full sync from kubilitics-backend and kept up-to-date by the StreamClusterState gRPC subscription.

The World Model is organized as:

A resource store: a map from resource identifiers (namespace/kind/name) to resource objects. Each resource object includes all metadata (labels, annotations, ownership references), spec, and current status. This store is used for instant resource lookups without database queries.

An event log: recent events associated with resources, indexed by resource and by timestamp. This allows quick retrieval of recent activity.

A metrics buffer: recent metric values (last 1-5 minutes of raw data) for fast metric lookups during investigations.

A topology graph: the computed dependency relationships between resources. This is used for blast radius calculations.

The World Model is entirely in-memory and is not persisted to disk. On restart, it's rebuilt from kubilitics-backend. This design trades some startup latency (time to re-sync) for simplicity and safety (no stale data on disk).

The World Model is continuously updated by the StreamClusterState subscription, so it's always (approximately) in sync with the actual cluster state.

### Persistent Storage: SQLite and PostgreSQL

For persistent storage of investigations, insights, actions, audit logs, and analytics data, kubilitics-ai uses either SQLite (for desktop deployments) or PostgreSQL (for in-cluster deployments).

**SQLite for desktop**: SQLite is a lightweight, file-based database. For single-user desktop deployments of kubilitics-ai, SQLite is sufficient. A single database file stores all persistent data. Configuration specifies the path to the SQLite file (e.g., ~/.kubilitics/ai.db).

**PostgreSQL for in-cluster**: For production in-cluster deployments, PostgreSQL provides scalability, concurrent access, and replication. Configuration specifies the PostgreSQL connection string (host, port, database, credentials).

The database schema is identical for SQLite and PostgreSQL (with minor syntax differences). The same application code works with both backends, selected at configuration time.

### Database Schema

The database contains the following primary tables:

**investigations** table: (id, query, investigation_type, status, created_at, completed_at, resource_type, resource_name, namespace, findings, confidence, reasoning_trace). This table stores investigation records. reasoning_trace is a JSON blob containing the full trace of the investigation.

**insights** table: (id, investigation_id, insight_type, severity, title, description, resource_type, resource_name, namespace, created_at, dismissed_at). This stores insights generated by investigations. An investigation can generate multiple insights.

**actions** table: (id, resource_type, resource_name, namespace, action_type, description, status, created_at, executed_at, approved_by, result, error_message). This stores action proposals and their execution results.

**audit_log** table: (id, timestamp, action_type, resource, user, status, result, reasoning). This stores immutable audit entries.

**analytics** table: (metric_name, resource_type, resource_name, namespace, timestamp, value, unit). This is a time-series table storing metrics.

**config** table: (key, value, set_at). This stores user preferences and configuration.

**cache** table: (key, value, expires_at). This stores cached tool results with expiration times.

Additional supporting tables for relationships: investigation_tool_calls (records of tool invocations during investigations), investigation_recommendations (recommendations generated), etc.

All tables have appropriate indices for performance. For example, the analytics table is indexed by (metric_name, resource_name, timestamp) for efficient time-range queries.

### Migration and Schema Management

The database schema is versioned. On startup, kubilitics-ai checks the schema version and runs any necessary migrations to bring the database up to current schema.

Migrations are stored in the internal/models/ package as Go functions. New migrations are additive (they add new columns or tables, they don't delete). This allows for safe schema evolution without losing data.

### Vector Memory (Optional)

Vector memory is an optional feature that enhances kubilitics-ai's ability to find similar past investigations and learn from history.

When enabled, kubilitics-ai uses a vector database (ChromaDB embedded, or Qdrant external) to store embeddings of:

Investigation queries: the text of past investigation queries, converted to embeddings. When a new investigation is started, its query is embedded and the system searches for similar past investigations.

Kubernetes documentation: official Kubernetes documentation and documentation for common tools (Helm, Istio, etc.) are pre-embedded and stored. When investigating, the system can find relevant documentation.

Error messages and logs: error messages and log snippets are embedded. When similar errors occur, the system can find related past occurrences.

Vector search is used to enhance context gathering: "We're seeing an error 'out of memory'. Let me search for past investigations involving out-of-memory errors."

Vector memory is gracefully degraded: if the vector database is unavailable, kubilitics-ai continues to work without semantic search. The system falls back to lexical search (keywords) instead of semantic search.

### Caching Layer

kubilitics-ai implements a multi-layer caching system:

**Tool result cache**: Tier 1 tools' results are cached. Calling list_resources twice with the same filter returns cached results if fresh. Cache TTLs are typically 1-2 minutes for resource metadata, seconds for metric data.

**LLM response cache**: Exact query matches in previous investigations are cached. If the user asks "What's the memory usage of the payment service?" and kubilitics-ai answered this recently, the cached answer is returned.

**Analytics cache**: Computed analytics (moving averages, trends, anomalies) are cached. Until new metric data arrives, cached results are returned.

**Backend query cache**: Frequently accessed data from kubilitics-backend (resource lists, topology) is cached with long TTLs (5-10 minutes), since this data changes less frequently than metrics.

Caches are invalidated by events from kubilitics-backend. When a resource is updated, all caches mentioning that resource are invalidated. Caches are also invalidated by TTL expiration.

---

## Section 10: Audit & Observability

### Structured Logging

All logging throughout kubilitics-ai uses structured JSON format. Each log line is a JSON object with fields: timestamp, level, logger, message, and contextual fields (investigation_id, tool_name, resource, user, error_stack, etc.).

Example log line:
```json
{"timestamp": "2025-02-10T14:30:45Z", "level": "info", "logger": "reasoning.investigation", "message": "Starting investigation", "investigation_id": "inv_12345", "query": "Why is payment service down?", "user": "alice@example.com"}
```

Structured logging allows centralized log aggregation systems (like ELK, Datadog, etc.) to parse and index logs effectively.

Correlation IDs are used throughout: every investigation, every tool invocation, every API request has a unique correlation ID. All logs related to a single investigation include the same correlation ID, allowing easy tracing of a single user operation across all components.

Log levels are used appropriately: DEBUG (detailed information for debugging), INFO (informational messages about normal operations), WARN (warnings about unexpected but recoverable issues), ERROR (errors that require attention), FATAL (errors causing shutdown).

### Metrics Exposition

kubilitics-ai exposes Prometheus metrics on the /metrics endpoint. Metrics are aggregated and exposed in Prometheus format for scraping by monitoring systems.

Key metrics:

**ai_investigations_total**: Counter of investigations started, labeled by type (diagnostic, informational, predictive, remediation) and status (running, completed, failed).

**ai_investigations_duration_seconds**: Histogram of investigation duration in seconds. Allows monitoring how long investigations take.

**ai_recommendations_total**: Counter of recommendations generated, labeled by type and acceptance status.

**ai_actions_executed_total**: Counter of actions executed, labeled by type and result (success, failure).

**ai_tool_invocations_total**: Counter of tool invocations, labeled by tool name. Shows which tools are used most.

**ai_tool_duration_seconds**: Histogram of tool execution duration, labeled by tool. Shows which tools are slow.

**ai_llm_tokens_total**: Counter of tokens consumed, labeled by provider and model. Shows usage per provider.

**ai_llm_api_calls_total**: Counter of API calls to LLM providers, labeled by provider.

**ai_llm_errors_total**: Counter of LLM API errors, labeled by provider and error type.

**ai_confidence_distribution**: Histogram of confidence scores of conclusions.

**ai_risk_score_distribution**: Histogram of risk scores of actions.

**ai_cache_hits_total**: Counter of cache hits (how many times a cached result was used).

**ai_cache_misses_total**: Counter of cache misses (how many times a cache was unavailable).

**ai_memory_bytes**: Gauge of current memory usage (World Model, caches).

**ai_backend_connection_status**: Gauge: 1 if connected to backend, 0 if disconnected.

These metrics feed into dashboards and alerts, allowing operators to understand system health and performance.

### Distributed Tracing

kubilitics-ai uses OpenTelemetry for distributed tracing. Every investigation generates a trace with spans for:

- Investigation initialization
- Context gathering (spans for each tool call)
- Hypothesis generation
- Tool execution (spans for each tool, including wait time and execution time)
- Validation
- Conclusion generation
- Action proposal

Each span includes:
- Start and end time
- Duration
- Span name and attributes
- Logs (events that occurred during the span)
- Links to other spans

Traces are exported to a backend (Jaeger, DataDog, etc.) and can be visualized, making it easy to understand where time is spent during investigations and to debug performance issues.

### Audit Log

Every consequential operation is recorded in the immutable audit log. Audit entries include:

- Timestamp (exact time of the operation)
- Operation type (action_proposed, action_approved, action_executed, action_failed, insight_generated, etc.)
- User (who initiated the operation, or system if automatic)
- Resource (what resource was involved)
- Result (what happened: success, failure, etc.)
- Reasoning (for mutations: why was this action proposed?)
- Confidence (for recommendations: how confident)
- Changes (for mutations: what changed)

The audit log is append-only (immutable): entries are never modified or deleted (except by explicit retention policy deletion of very old entries). The audit log is stored in the database and optionally exported to an external audit service.

The audit log provides complete traceability: you can find out who changed what, when, why, and with what result.

### Health Endpoints

kubilitics-ai exposes three health-related endpoints:

**/health** - Liveness probe. Returns 200 if the service is running. Returns 500 if the service is completely broken. Used by orchestration systems to determine if the pod is alive.

**/ready** - Readiness probe. Returns 200 if the service is ready to handle requests. Returns 503 if the service is starting up or temporarily unable to serve. Returns 500 if the service is broken. Used by orchestration systems and load balancers to route traffic.

**/metrics** - Prometheus metrics endpoint. Returns metrics in Prometheus text format.

These endpoints are lightweight and do not depend on the full service being operational. They can be checked frequently without overloading the system.

### Self-Monitoring

kubilitics-ai monitors its own performance and alerts on degradation.

The system tracks:

- Number of failed investigations (if too many fail, alert)
- Average investigation duration (if duration increases unexpectedly, alert)
- Error rates in tool invocations (if a tool frequently fails, alert)
- Backend connection stability (if connection is frequently lost, alert)
- Memory usage (if memory usage is growing unbounded, alert)
- Database health (if database is slow or corrupted, alert)

When thresholds are exceeded, kubilitics-ai can emit alerts to a configured alerting system or log WARN/ERROR level logs that trigger upstream alerts.

---

## Section 11: Testing Strategy

### Unit Tests

Every component is unit tested in isolation. Dependencies are mocked.

For example:
- The reasoning engine is tested with mock LLM responses and mock tool results
- The LLM adapter is tested against mock provider API responses
- Tool implementations are tested with mock cluster data
- The safety engine is tested with various autonomy levels, policies, and proposed actions
- The analytics engine is tested with various time-series data

Unit tests are fast (typically milliseconds to seconds) and run locally without external dependencies. They achieve high code coverage (target: 80%+).

### Integration Tests

Integration tests exercise multiple components together, without mocking entire subsystems.

For example:
- The gRPC client is tested against a mock gRPC server
- The entire reasoning engine is tested with mock tools, verifying that a complete investigation succeeds
- The MCP server is tested with actual tool implementations
- The REST API handlers are tested with actual service implementations

Integration tests are slower than unit tests but test real interactions between components. They run frequently (continuous integration) but may have external dependencies.

### End-to-End Tests

E2E tests exercise the entire system from API request to conclusion.

For example:
- A user sends a query via the REST API → kubilitics-ai runs an investigation → tools are invoked → the LLM is called → insights are generated → actions are proposed → the user retrieves results via the REST API.

E2E tests verify the complete flow. They may use a test Kubernetes cluster (KinD, Minikube) or a mock backend.

E2E tests are slowest (typically seconds to minutes) but test the complete system. They run less frequently (e.g., on commits to main branch).

### LLM Testing

LLM testing is challenging because LLM behavior is non-deterministic. To make testing deterministic, kubilitics-ai uses mock LLM responses for most testing.

The LLM adapter has a "test mode" where instead of calling a real LLM provider, it returns pre-recorded responses. This allows testing the reasoning engine with known, reproducible LLM outputs.

Periodically, integration tests run against real LLM providers to catch provider-specific issues.

For specific critical paths (diagnostic investigation of a known failure), snapshots of LLM responses are recorded and used for regression testing.

### Safety Testing

The safety engine is heavily tested, including adversarial testing.

Tests verify:
- Immutable rules are enforced (no deletion from kube-system, etc.)
- Autonomy levels work correctly (Level 1 prevents actions, etc.)
- Blast radius calculations are accurate
- Dry-run validation works

Adversarial tests attempt to trick the safety engine into unsafe actions:
- Proposing an action that would violate immutable rules → safety engine blocks it
- At Level 2 autonomy, attempting to execute an action → safety engine blocks it
- Proposing an action with a massive blast radius → safety engine escalates

### Performance Testing

Performance tests measure response times and throughput.

- Investigation duration: under normal conditions, a simple investigation completes in 5-30 seconds
- Tool invocation latency: individual tools complete in <5 seconds
- Throughput: the system can handle multiple concurrent investigations
- Memory usage: steady-state memory usage is <500MB, peak <1GB

Performance baselines are established and tracked. Regression is detected when latency increases or throughput decreases unexpectedly.

### Chaos Testing

Chaos tests verify system behavior when things break.

Example chaos scenarios:
- **Backend disconnection**: kubilitics-ai loses gRPC connection to backend. System should fall back to cached data, mark insights as stale, and reconnect when backend is available.
- **LLM provider failure**: The configured LLM provider becomes unavailable. System should fail over to secondary provider or return an error gracefully.
- **Database corruption**: The SQLite/PostgreSQL database becomes corrupted. System should log error and continue operating (investigations might fail, but the system doesn't crash).
- **Out of memory**: kubilitics-ai runs out of memory. System should gracefully degrade: oldest cache entries are evicted, investigations are cancelled if necessary.
- **High load**: Many concurrent investigations are started. System should queue them and process them in order, not crashing or producing incorrect results.

Chaos tests verify that the system degrades gracefully rather than failing catastrophically.

---

## Section 12: Engineering Task Breakdown

### Implementation Phases

The implementation of kubilitics-ai is broken into 7 phases, each lasting roughly 2-3 weeks with a full engineering team. Phases are sequential; each phase depends on the previous one(s).

### Phase 1: Foundation and Project Setup (Weeks 1-3)

Deliverables:
- New kubilitics-ai repository/directory structure created with correct Go module, Makefile, and build system
- gRPC protocol buffer definitions (api/proto/) for communication with kubilitics-backend: ClusterDataService with all methods
- gRPC client code (internal/integration/) that can connect to kubilitics-backend and maintain a connection
- Database schema and migrations (internal/models/) for SQLite and PostgreSQL
- Configuration system (internal/config/) loading from environment, files, and providing type-safe access
- Health check endpoints (/health, /ready, /metrics) returning appropriate status
- Structured logging system (JSON, correlation IDs) working throughout
- Basic HTTP server and REST API scaffolding (internal/api/) with empty handlers

Deliverables are tested with:
- Unit tests for configuration loading, database schema, gRPC connection
- Integration test: kubilitics-ai starts, connects to mock kubilitics-backend, health checks pass

Dependencies:
- Proto definitions must match kubilitics-backend's gRPC service definitions (coordination needed with backend team)

Effort: High. Setting up the project skeleton and infrastructure is time-consuming but foundational.

### Phase 2: MCP Server and Tier 1 Tools (Weeks 4-6)

Deliverables:
- MCP server (internal/mcp/) fully functional, implementing MCP protocol
- Tool registry and tool invocation system
- All Tier 1 observation tools (list_resources, get_resource, get_logs, get_metrics, get_topology, search_resources, get_events, get_resource_yaml)
- Tool caching layer (internal/cache/) with TTL-based expiration
- World Model (in-memory cluster state) populated from gRPC stream and updated in real-time
- LLM adapter (internal/llm/) skeleton with at least one provider (OpenAI) fully functional
- REST API endpoints for health and configuration (GET /health, GET /api/v1/ai/status, GET /api/v1/ai/config, PUT /api/v1/ai/config, POST /api/v1/ai/config/test)

Deliverables are tested with:
- Unit tests for each tool implementation
- Integration tests: mock tools are called, results are cached, cache invalidation works
- E2E test: Connect to mock backend, sync World Model, call tools, results are accurate

Dependencies:
- gRPC integration from Phase 1 must be working
- Database schema from Phase 1 must be finalized

Effort: Very high. MCP server and tool implementations are the bulk of the work.

### Phase 3: Reasoning Engine and Investigation Lifecycle (Weeks 7-9)

Deliverables:
- Reasoning orchestrator (internal/reasoning/) managing full investigation lifecycle
- Investigation trigger, context gathering, hypothesis generation, validation, conclusion phases
- Chain-of-thought enforcement
- Investigation types (Diagnostic, Informational, Predictive, Remediation) with specialized workflows
- Parallel tool execution with dependency management
- Reasoning loops and iteration
- Confidence scoring
- Explainability: reasoning chains captured and persisted
- Context window management for different LLM models
- REST API endpoints for investigations: POST /api/v1/ai/investigate, GET /api/v1/ai/investigations, GET /api/v1/ai/investigations/{id}, DELETE, POST /cancel
- WebSocket endpoint for investigation streaming: /api/v1/ai/chat

Deliverables are tested with:
- Unit tests: context gathering, hypothesis generation, validation
- Integration tests: full investigation flow with mock LLM
- E2E tests: complete diagnostic investigation from query to conclusion

Dependencies:
- Tier 1 tools from Phase 2 must be working
- LLM adapter from Phase 2 must be working

Effort: Very high. The reasoning engine is complex and the core of the system.

### Phase 4: Analytics Engine (Weeks 10-12)

Deliverables:
- Analytics engine (internal/analytics/) with all statistical methods
- Time-series analysis (moving averages, standard deviations, linear regression, seasonal decomposition)
- Anomaly detection (Z-score, IQR, rolling window)
- Trend forecasting with confidence intervals
- Resource utilization scoring
- Cost estimation
- Pattern detection (recurring failures, deployment impacts, usage patterns)
- Metrics storage and retention policies
- Data downsampling for long-term storage
- REST API endpoints: GET /api/v1/ai/analytics/summary, GET /api/v1/ai/analytics/resource/..., GET /api/v1/ai/analytics/predictions

Deliverables are tested with:
- Unit tests for each statistical method with various data distributions
- Integration tests: metrics stored, analytics computed, results returned
- Performance tests: analytics computation on 1 month of data completes in <5 seconds

Dependencies:
- Database from Phase 1 must be functional
- World Model from Phase 2 must be providing metrics

Effort: High. Statistical implementations must be numerically correct.

### Phase 5: Safety Engine and Action Execution (Weeks 13-15)

Deliverables:
- Safety engine (internal/safety/) implementing all five autonomy levels
- Immutable safety rules enforcement
- User-configurable policies
- Blast radius calculation using topology graph
- Dry-run execution and validation
- Automatic rollback triggers and execution
- Human escalation workflow
- Dead man's switch (revert to Level 1 on backend disconnection)
- Tier 3 recommendation tools (draft_recommendation, create_insight, generate_report)
- Tier 4 execution tools (patch_resource, scale_resource, restart_rollout, rollback_rollout, delete_resource, apply_resource)
- REST API endpoints: GET /api/v1/ai/actions/pending, POST /api/v1/ai/actions/{id}/approve, POST /api/v1/ai/actions/{id}/reject, GET /api/v1/ai/actions/history
- Audit logging (immutable audit log of all actions)

Deliverables are tested with:
- Unit tests: each autonomy level enforces its rules, safety rules are unbypassable
- Safety tests: adversarial testing attempts to bypass rules, all fail
- Integration tests: dry-run works, automatic rollback works
- E2E tests: full flow from investigation to action execution

Dependencies:
- Everything from Phases 1-4 must be working
- Reasoning engine must be generating action proposals

Effort: Very high. Safety is critical and must be bulletproof.

### Phase 6: Additional LLM Providers, Advanced Features, Optimization (Weeks 16-18)

Deliverables:
- LLM adapter support for Anthropic Claude models
- LLM adapter support for Ollama local models
- LLM adapter support for OpenAI-compatible endpoints
- Fallback provider selection
- Vector memory (ChromaDB/Qdrant) for semantic search over past investigations
- Tool result caching enhancements
- LLM response caching
- Token budgeting and usage tracking
- REST API endpoints: GET /api/v1/ai/usage, GET /api/v1/ai/usage/budget
- Insights REST API: GET /api/v1/ai/insights, GET /api/v1/ai/insights/resource/..., POST /api/v1/ai/insights/{id}/dismiss
- Performance optimization: measure and improve latencies
- Chat endpoint refinement: WebSocket /api/v1/ai/chat, SSE /api/v1/ai/chat/stream

Deliverables are tested with:
- Unit tests for each LLM provider adapter
- Integration tests: provider switching, fallback, token budgeting
- Performance benchmarks: latency targets met

Dependencies:
- Everything from Phases 1-5
- LLM provider API keys must be available for testing

Effort: High. Provider implementations are varied and need testing against real services.

### Phase 7: Integration Testing, Documentation, Production Hardening (Weeks 19-20)

Deliverables:
- Comprehensive integration tests with actual kubilitics-backend
- End-to-end tests covering all major scenarios
- Performance and load tests
- Chaos testing
- Documentation: architecture, API, configuration, deployment
- Docker image and Kubernetes manifests for deployment
- Production hardening: error handling, rate limiting, timeouts, graceful shutdown
- Observability: all metrics, traces, audit logs functional
- Security review and fixes

Deliverables are tested with:
- Full E2E test suite against actual backend
- Load test: system handles 10+ concurrent investigations
- Chaos test: system recovers from various failure modes
- Security test: RBAC, authentication, authorization correct

Dependencies:
- All previous phases complete and working

Effort: Medium-High. Integration and hardening are necessary but not as design-intensive as earlier phases.

---

## Section 13: Integration with Existing Backend (Minimal Changes)

### Changes to kubilitics-backend

kubilitics-ai depends on kubilitics-backend but the backend does not depend on kubilitics-ai. However, kubilitics-backend must be modified minimally to expose the gRPC service that kubilitics-ai consumes.

**New gRPC Server**: A new package internal/grpc/ is created in kubilitics-backend. This package contains:
- gRPC server initialization (listening on a configurable port, default 50051)
- The ClusterDataService implementation with all methods
- Connection management for multiple clients (kubilitics-ai can be one of many potential clients)

The gRPC server reuses existing code from kubilitics-backend to query Kubernetes and build cluster state. The server does not introduce new business logic; it simply exposes existing capabilities via gRPC instead of HTTP.

**Resource Streaming Endpoint**: The StreamClusterState RPC is the most complex addition. It must:
- Maintain a long-lived stream connection
- Push resource change events as they occur (detected by the existing Kubernetes client-go watch mechanism or from existing event handling)
- Support multiple concurrent clients (multiple kubilitics-ai instances or other clients)
- Handle reconnection gracefully

The StreamClusterState endpoint reuses existing event handling from kubilitics-backend. No new cluster monitoring is needed; events are translated into StreamClusterState events.

**Command Execution Endpoint**: The ExecuteCommand RPC executes Kubernetes commands. It:
- Receives a command request (patch, scale, delete, apply) with resource details
- Verifies RBAC (the authenticated user/service account has permission)
- Executes the command against Kubernetes
- Logs the action in the existing audit system
- Returns the result

The ExecuteCommand endpoint uses existing Kubernetes client-go code and RBAC checking. It simply exposes this as a gRPC API.

**Feature Flag**: All gRPC additions are behind a feature flag (--enable-grpc or environment variable ENABLE_GRPC). By default, the flag is false, so existing deployments are unaffected. Only deployments that explicitly enable gRPC start the gRPC server.

**Backward Compatibility**: The existing REST API, WebSocket connections, and all other functionality continues to work identically. The gRPC additions are purely additive.

### Changes to kubilitics-frontend

kubilitics-ai has its own REST API (different port, different endpoints) so the frontend must be aware of it. However, the changes are minimal:

**AI Service Discovery**: The frontend must discover whether kubilitics-ai is available. This is done by attempting to call GET /api/v1/ai/status on kubilitics-ai's port (8081). If successful, AI features are enabled in the UI. If unsuccessful, AI features are disabled or show as unavailable.

**UI for AI Features**: New UI components for AI features:
- Chat interface (for conversational AI)
- Investigations list and details
- Insights display
- Action approval workflow
- Analytics dashboard

These components call kubilitics-ai's REST API endpoints.

The implementation is straightforward: new routes in the frontend, new API service for kubilitics-ai, new UI components.

### Deployment Configuration

**Docker Compose** (for local development): Two services:
- kubilitics-backend on port 8080, gRPC on port 50051
- kubilitics-ai on port 8081

**Kubernetes** (for production):
- kubilitics-backend Deployment with gRPC port exposed (50051)
- kubilitics-ai Deployment with REST port exposed (8081)
- Service for kubilitics-backend with clusterIP for gRPC
- Service for kubilitics-ai with clusterIP for REST

kubilitics-ai's configuration specifies the kubilitics-backend gRPC endpoint (e.g., kubilitics-backend:50051).

### Health and Monitoring

The kubilitics-backend health endpoint (GET /health) is unchanged. It reports health of the backend only, not the AI subsystem.

kubilitics-ai has its own health endpoints (/health, /ready) that report AI subsystem health.

The frontend can check both: GET http://backend:8080/health and GET http://ai:8081/health. If both return 200, the full platform is operational. If only backend returns 200, the platform works but AI is unavailable. If backend returns error, the platform is unavailable regardless of AI status.

---

## Section 14: Advanced Reasoning Patterns and Decision Trees

### Specialized Investigation Workflows

Beyond the four basic investigation types (Diagnostic, Informational, Predictive, Remediation), kubilitics-ai implements several advanced reasoning patterns for specific classes of problems.

**Cascading Failure Analysis**: When a service outage is reported, the problem is rarely isolated to a single component. kubilitics-ai implements a cascading failure analyzer that:

Starts with the failing service reported by the user, then uses the topology graph to trace upstream dependencies (what services does this one depend on?). For each upstream service, it checks health status, recent errors, and metrics. It recursively traces further up until it reaches either a healthy service or a system boundary (external API, database, cluster infrastructure).

For each service in the chain, it gathers evidence: logs, events, metrics, configuration. It evaluates each service against a diagnostic checklist: is it running, is it healthy, does it have resources, is it receiving traffic, is it responding with errors, has it been recently updated?

The analyzer builds a dependency chain diagram showing each service and its status. It identifies the "root cause layer" — the highest level in the dependency chain where problems are detected. It may also identify multiple independent failure points.

The reasoning engine uses this cascade analysis to formulate hypotheses about root cause and to generate recommendations that address the chain of issues, not just the symptoms.

**Resource Pressure Chain Analysis**: When a cluster is under resource pressure (CPU, memory, disk), kubilitics-ai implements an analysis that:

Identifies which resources are consuming the most (top consumers by CPU, memory, disk). For each top consumer, it checks if the consumption is legitimate (expected for its workload type) or anomalous.

Traces the consequence chain: if this resource is consuming too much, what impact does it have on other resources? Does it starve other pods? Does it cause node pressure? Does it trigger evictions?

Generates recommendations in priority order: first, address the resource being consumed (is it misconfigured, is there a memory leak, is it just under load?). Second, add more capacity if needed. Third, implement constraints (resource limits, quotas) to prevent future issues.

**Configuration Error Root Cause**: Many Kubernetes problems are caused by misconfiguration. kubilitics-ai implements a specialized analyzer that:

Compares the deployed resource definition to Kubernetes best practices and common error patterns. It checks for: wrong image names, missing environment variables, incorrect mount paths, invalid resource limits, wrong service selector labels, misconfigured ingress, RBAC issues, etc.

For each configuration issue detected, it calculates the likelihood that this issue is causing the reported problem. It ranks configuration issues by likelihood.

It explains each configuration issue clearly, showing the actual value, what the correct value should be, and why the mismatch is problematic.

It generates a precise patch that would fix the configuration.

**Performance Degradation Root Cause**: When performance metrics are degraded (latency, throughput), kubilitics-ai analyzes:

Current vs. baseline: compares current metrics to historical baselines. How much has performance degraded? Is it degradation or just noise?

Correlation analysis: what changed recently that could explain the degradation? Was there a deployment, a configuration change, an increase in traffic, a resource constraint triggered?

Bottleneck analysis: where in the request flow is the latency coming from? Is it network, is it database, is it application logic? (Inferred from available metrics.)

Capacity analysis: is the system out of capacity (CPU, memory), or is the degradation due to something else?

Based on this analysis, it generates recommendations: add capacity, optimize configuration, optimize application code, improve efficiency.

### Decision Trees and Diagnostic Protocols

For common problems, kubilitics-ai implements diagnostic decision trees that guide the investigation systematically.

**Pod Crash Loop Diagnosis Tree**: When a pod is in CrashLoopBackOff, the diagnostic tree checks:

1. Check logs for stack traces or error messages → if found, extract the error type
2. Based on error type, check: configuration (missing env vars, bad mount paths), resources (OOM killer, CPU throttling), dependencies (service down, database unavailable), permissions (RBAC errors)
3. For each hypothesis, gather supporting evidence (recent changes, metrics, events)
4. Narrow down to most likely hypothesis
5. Generate specific fix

This structured approach ensures all angles are examined systematically.

**Resource Exhaustion Diagnosis Tree**: When a node or namespace is out of resources:

1. Identify which resource is exhausted (CPU, memory, disk, ephemeral-storage)
2. Identify top consumers of that resource
3. Check if top consumers are legitimate or anomalous
4. Check if there's a resource constraint issue (limit too low) or actual overuse
5. Generate recommendations: increase limits, remove unnecessary pods, optimize efficiency

### Explanation Generation and Clarity

kubilitics-ai generates explanations that are understandable to both operators and developers.

For operators: explain in terms of impact and remedy. "The payment service is down because its database connection pool is exhausted. Scale up the database or reduce the payment service replica count."

For developers: provide technical details. "PostgreSQL maxconn is 100, but the payment service is configured with connection_pool_size=50 and there are 3 service replicas, so they can create up to 150 connections, exceeding maxconn."

Explanations always include uncertainty: "I'm 95% confident the issue is X, but there's a 5% chance it's Y."

---

## Section 15: Performance Characteristics and Scalability

### Performance Targets

kubilitics-ai is designed to meet these performance targets:

**Investigation latency**: The time from when a user submits a query to when initial findings are returned should be under 30 seconds in normal conditions, under 60 seconds in high load. The investigation may continue running in the background and refine findings, but initial results should come quickly.

**Tool invocation latency**: Individual tool calls (get_resource, list_resources, get_logs) should complete in under 5 seconds normally, under 10 seconds in high load. Tools that access kubilitics-backend wait for backend response time plus local processing.

**Concurrent investigations**: The system should support at least 5 concurrent investigations without significant latency degradation. At 10+ concurrent investigations, latency increases but the system continues operating.

**Memory footprint**: Steady-state memory usage should be under 500MB (excluding the World Model). The World Model size depends on cluster size: a small cluster (100 nodes, 1000 pods) might have 50MB World Model, a large cluster (1000 nodes, 10000 pods) might have 500MB World Model.

**Database query latency**: Queries to the SQLite/PostgreSQL database should complete in under 1 second. Bulk queries (analytics computations) may take longer.

**Cache hit rate**: For typical usage patterns, cache hit rates should exceed 80%, meaning 80% of tool calls return cached results.

### Horizontal Scalability

kubilitics-ai is designed to be stateless (for the REST API and MCP server), which means multiple kubilitics-ai instances can be deployed and share load.

However, the World Model and caches are in-memory, so they cannot be shared across instances without additional coordination. For a fully horizontally scalable deployment, a shared cache (Redis) and shared database would be used, but this adds operational complexity.

For most deployments, a single kubilitics-ai instance is sufficient because the actual LLM provider (OpenAI, Anthropic, etc.) becomes the bottleneck before kubilitics-ai becomes CPU or memory bound.

For very large clusters with high investigation load, multiple kubilitics-ai instances can be deployed behind a load balancer, accepting that each instance maintains its own World Model (which is eventually consistent with the cluster state).

### Database Scalability

SQLite is suitable for deployments up to moderate load. For high-load deployments, PostgreSQL is recommended.

PostgreSQL can handle high concurrency, large data volumes (years of analytics data), and distributed deployments (replicas, read replicas).

The analytics table, storing time-series metrics, grows over time. For a typical deployment:
- 100 pods × 10 metrics × 96 samples/day (15-minute intervals) = 96,000 rows/day
- Over 1 year: 35 million rows
- With downsampling (keeping only hourly data after 30 days), total table size: ~200MB

PostgreSQL handles this easily.

---

## Section 16: Security Considerations

### Authentication and Authorization

kubilitics-ai relies on the frontend for authentication. The frontend authenticates the user (via OAuth, OIDC, or another method) and passes an authentication token to kubilitics-ai. kubilitics-ai trusts this token; it assumes the frontend has already verified the user's identity.

For token validation, kubilitics-ai can be configured to validate JWT tokens locally (checking signature and expiration) or to call the authentication service for validation.

Authorization is primarily delegated to kubilitics-backend: when kubilitics-ai requests an action (patch, scale, delete), kubilitics-backend verifies that the user has permission via RBAC. kubilitics-ai does not make independent authorization decisions; it enforces policies (autonomy levels, safety rules) but defers to the backend for actual RBAC.

kubilitics-ai can also be configured with its own authorization policies: certain users can access certain namespaces, certain users can execute mutations, etc. These policies are checked before delegating to the backend.

### Data Privacy and Residency

kubilitics-ai stores investigation data, insights, and audit logs in its own database. Users may want to ensure this data is encrypted at rest.

For SQLite deployments, the database file should be stored on an encrypted filesystem (full disk encryption, or encrypted volumes).

For PostgreSQL deployments, PostgreSQL's transparent data encryption (TDE) can be enabled, or the storage volume can be encrypted.

kubilitics-ai can be configured to store sensitive data (API keys, credentials) in a secrets management system (Kubernetes Secrets, HashiCorp Vault, AWS Secrets Manager) rather than configuration files.

LLM providers (OpenAI, Anthropic) may require data residency in certain regions. Configuration allows specifying the endpoint of the LLM provider, so users can direct queries to their preferred region or to a local deployment.

### Rate Limiting and Quotas

kubilitics-ai implements rate limiting to prevent abuse:

Per-user rate limiting: each authenticated user can initiate at most X investigations per hour. This prevents a runaway script from overwhelming the system.

Per-provider rate limiting: respect the rate limits of LLM providers (e.g., OpenAI's rate limits on API calls).

Per-resource rate limiting: the gRPC client to kubilitics-backend respects backend rate limits.

Token quotas: if a budget is configured (max tokens per month), kubilitics-ai stops accepting new investigations when the budget is reached.

Rate limiting is configurable per deployment.

### Secrets Management

kubilitics-ai requires several secrets: LLM API keys, database passwords, authentication service credentials, etc. These must be handled securely.

The configuration system supports loading secrets from:
- Environment variables (recommended)
- Kubernetes Secrets (if deployed in Kubernetes)
- HashiCorp Vault
- A secrets file (with restricted permissions)

Secrets are never logged, never included in metrics or traces, and are kept in memory only as long as needed.

---

## Section 17: Operational Considerations

### Deployment Modes

kubilitics-ai supports multiple deployment modes, depending on the environment.

**Desktop development**: kubilitics-ai runs locally on a developer's machine, connecting to a local Kubernetes cluster (Docker Desktop, Minikube). Data is stored in a local SQLite database. LLM provider is configured (may be local Ollama or cloud API).

**Docker Compose**: kubilitics-ai and kubilitics-backend run as Docker services, along with PostgreSQL (if desired). Suitable for small-team deployments or demos.

**Kubernetes (single instance)**: kubilitics-ai is deployed as a single Deployment and Service in the Kubernetes cluster. PostgreSQL runs as a StatefulSet. Suitable for most production deployments.

**Kubernetes (high availability)**: Multiple kubilitics-ai pods behind a Service, sharing a PostgreSQL database. More complex but suitable for demanding environments.

**Kubernetes (large scale)**: Multiple kubilitics-ai pods with stateful caching (Redis), PostgreSQL with replication, potentially multiple databases (one per cluster if managing multiple clusters).

Each deployment mode has its own Kubernetes manifests and Docker Compose files.

### Backup and Disaster Recovery

Since kubilitics-ai's database contains investigation history and audit logs, backups are important.

SQLite databases are backed up by copying the database file.

PostgreSQL databases are backed up using pg_dump or continuous archiving.

Backup frequency depends on use case: daily backups are usually sufficient. Backups should be tested periodically to ensure recoverability.

In case of data loss, the World Model can be rebuilt by resyncing with kubilitics-backend, so that's not critical to back up. But investigation history, insights, and audit logs should be preserved.

### Upgrading kubilitics-ai

Upgrading kubilitics-ai involves:

1. Building new Docker image with new code
2. Running database migrations (if schema changed)
3. Redeploying pods with new image
4. Verifying health checks pass

The database must be upgraded before pods are deployed (or migrations are run as an init container). Database migrations are backward compatible (new columns are added, old code can still run with old schema for a grace period).

If upgrading significantly changes behavior (e.g., a new autonomy level), configuration may need updating. The system validates configuration and warns if obsolete settings are found.

Rollback is possible: revert to the previous Docker image, and the old code runs with the new (or compatible) database schema.

### Monitoring and Alerting

kubilitics-ai should be monitored for:

**Health**: Liveness checks (is the service running?) and readiness checks (can it handle requests?).

**Performance**: Latencies, throughput, error rates for API endpoints and tool invocations.

**Resource usage**: CPU, memory, disk usage. Alerts if approaching limits.

**Database health**: Database size, slow queries, replication lag (if using PostgreSQL).

**External dependencies**: Backend connectivity, LLM provider connectivity, database connectivity.

**Business metrics**: Number of investigations, success rate, action execution rate. Alerts if patterns change unexpectedly.

Monitoring is exposed via the /metrics endpoint (Prometheus format). Alerting rules (Prometheus AlertManager, or equivalent) can be configured to trigger on threshold violations.

---

## Section 18: Future Extensibility and Evolution

### Extensibility Points

The architecture is designed for extensibility at several points:

**New LLM providers**: New providers can be added to the LLM adapter by implementing the Provider interface. No changes to the reasoning engine needed.

**New tools**: New Tier 1, 2, 3, or 4 tools can be added by implementing the Tool interface. No changes to the reasoning engine needed.

**New analysis techniques**: New statistical methods can be added to the analytics engine without affecting other components.

**New safety policies**: Users can define new policies in YAML without code changes.

**New investigation types**: New specialized investigation types can be added to the reasoning engine by defining new workflows.

**Integration with other systems**: New integrations (e.g., with incident management systems like PagerDuty, or with chat systems like Slack) can be added via new REST API clients.

### Evolution Roadmap (Beyond Phase 7)

Potential future enhancements (not in the initial design):

**Machine learning**: Beyond phase 7, machine learning could be added for anomaly detection, pattern matching, and prediction. However, the initial system uses classical statistics intentionally for interpretability and performance.

**Multi-cluster support**: Currently designed for single cluster. Extension to manage multiple clusters would involve managing multiple World Models (one per cluster) and coordinating insights and actions across clusters.

**Collaborative intelligence**: Multiple instances of kubilitics-ai could learn from each other's past investigations, sharing insights about patterns and solutions.

**Advanced NLP**: Ability to understand more natural language, not just structured queries.

**Integration with observability systems**: Direct integration with Prometheus, Grafana, Datadog, etc., for richer context gathering.

**Autonomous optimization**: Beyond proposing actions, kubilitics-ai could continuously optimize cluster configurations to meet targets (cost, latency, availability).

---

## Section 19: Design Rationale and Key Decisions

### Why Unidirectional Dependency?

The decision to make kubilitics-ai completely independent of kubilitics-backend (dependency is one-way) was made deliberately. Alternatives were considered:

**Tightly integrated**: kubilitics-ai could be part of kubilitics-backend, same codebase, same binary. This simplifies deployment but makes it harder to iterate on AI features independently. Any bug in kubilitics-ai risks breaking the core platform.

**Bidirectional integration**: kubilitics-backend and kubilitics-ai could call each other. This enables tighter integration but makes deployment and scaling more complex.

Unidirectional dependency provides the best of both worlds: tightly coupled communication (via gRPC) but loose deployment coupling. The core platform remains stable and deployable independently.

### Why Embedded MCP Server, Not External?

The MCP server could be a separate process, but it's embedded in kubilitics-ai process for several reasons:

**Latency**: Tool invocations are fast because they're in-process, not over RPC.

**Simplicity**: One process to deploy and monitor, not two.

**Shared state**: The MCP server shares memory with the reasoning engine, caches, and World Model. No need to serialize/deserialize across process boundaries.

**Failure isolation**: If the MCP server crashes, the whole kubilitics-ai crashes (which is fine, it's one service). If it were external, a separate failure mode exists.

The trade-off is that the MCP server is not independently scalable, but this is acceptable because LLM provider calls are the bottleneck, not tool invocations.

### Why Multiple LLM Providers?

Supporting multiple providers (OpenAI, Anthropic, Ollama, custom) was a key design decision:

**Flexibility**: Users can choose their preferred provider based on cost, capability, data residency, or other criteria.

**Resilience**: If one provider is down, switch to another automatically.

**Vendor lock-in prevention**: Users are not forced to use a specific provider.

**Cost optimization**: Users can use cheaper providers for simple tasks, expensive providers for complex tasks.

The cost of supporting multiple providers is the abstraction layer (LLM adapter), which is minimal.

### Why Not Machine Learning?

The initial design deliberately avoids machine learning (ML):

**Interpretability**: Classical statistical methods are interpretable. You can explain why the system flagged an anomaly (Z-score exceeded threshold). ML models are often black boxes.

**Speed**: No training required. Classical methods compute instantly on streaming data.

**Debuggability**: If analysis is wrong, you can inspect the math. With ML, you might not know why.

**Reliability**: No data quality issues or training instability.

Future versions could add ML, but the foundation is intentionally simple and transparent.

### Why SQLite as Default?

The design supports both SQLite (desktop) and PostgreSQL (production):

**SQLite for desktop**: Lightweight, no setup, works offline.

**PostgreSQL for production**: Scalable, reliable, supports concurrency.

Rather than forcing users to run PostgreSQL locally, the architecture abstracts the database behind an interface, allowing choice.

### Why gRPC, Not REST for Backend Communication?

kubilitics-ai uses gRPC to communicate with kubilitics-backend (not REST):

**Streaming**: gRPC streaming (StreamClusterState) is more efficient than polling REST endpoints.

**Efficiency**: Binary protocol (Protobuf) is more efficient than JSON for high-frequency updates.

**Type safety**: Protocol Buffers provide schema definition and code generation.

**Performance**: Lower latency and overhead than REST.

The cost is that kubilitics-backend must expose a gRPC server (new code), but this is minimal and additive.

---

## Conclusion

This comprehensive design document specifies every aspect of the kubilitics-ai subsystem in detail. The system achieves the fundamental design goal: a completely independent AI enhancement to Kubilitics that provides intelligent analysis, autonomous recommendations, and safe action execution while maintaining zero dependency from the core platform on the AI subsystem.

The architecture is built on clear principles: unidirectional dependency, safety-first design, observability and auditability, extensibility, and human-in-the-loop control. The system is designed for both small deployments (single instance, SQLite) and large deployments (multiple instances, PostgreSQL, high availability).

Implementation proceeds systematically in seven phases, with clear deliverables and dependencies. Performance, security, and operational considerations are addressed throughout the design. The system is positioned for future evolution through careful extensibility points.

This design document provides the complete specification necessary to implement kubilitics-ai. It should serve as the foundation for all engineering decisions, architectural choices, and implementation work on the kubilitics-ai subsystem.

---

## Section 20: Detailed Tool Specifications and Behavior

### Tier 1 Observation Tools - Complete Specification

**list_resources Tool**

Purpose: Discover Kubernetes resources matching specified criteria without knowing exact names. Used when the user asks "Show me all pods in the production namespace that are using more than 500m CPU" or when the reasoning engine needs to find all resources of a type.

Input parameters:
- resource_kind (required): Kubernetes resource kind (Pod, Deployment, StatefulSet, Service, Ingress, ConfigMap, Secret, etc.)
- namespace (optional): namespace to filter by (empty means all namespaces)
- label_selector (optional): Kubernetes label selector for filtering (e.g., "app=payment")
- field_selector (optional): Kubernetes field selector (e.g., "status.phase=Running")
- limit (optional): maximum number of results to return (default 100, max 1000)
- offset (optional): pagination offset

Output format: Array of resource summaries. Each summary includes:
- identifier (namespace/kind/name for unique reference)
- name, namespace, kind
- creation_time, last_update_time
- labels (all labels as key-value pairs)
- annotations (all annotations as key-value pairs)
- current_status (one-liner describing current state)
- resource_version (for detecting changes)

Example response:
```json
{
  "resources": [
    {
      "identifier": "production/Pod/payment-service-abc123",
      "name": "payment-service-abc123",
      "namespace": "production",
      "kind": "Pod",
      "creation_time": "2025-02-08T10:30:00Z",
      "last_update_time": "2025-02-10T14:30:00Z",
      "labels": {"app": "payment", "version": "v2.1.0"},
      "annotations": {"deployment.kubernetes.io/revision": "3"},
      "current_status": "Running, 2/2 containers ready",
      "resource_version": "123456"
    }
  ],
  "total_count": 47,
  "has_more": true
}
```

Safety level: Safe (read-only). Can be called freely.

Caching: Results cached for 2 minutes. Cache invalidated when any resource matching the filter is updated.

Dependencies: Requires gRPC connection to kubilitics-backend. Falls back to cached results if backend unavailable.

**get_resource Tool**

Purpose: Retrieve the complete definition of a single Kubernetes resource, including spec, status, metadata, and all fields.

Input parameters:
- resource_identifier (required): the unique identifier in format "namespace/kind/name" (e.g., "production/Pod/payment-service-abc123")

Output format: Complete resource object in JSON, with all fields including:
- metadata (name, namespace, labels, annotations, owner references, etc.)
- spec (the desired configuration)
- status (the current state)
- conditions (for resources that support conditions, e.g., Pod conditions, Deployment conditions)

Example response:
```json
{
  "metadata": {
    "name": "payment-service-abc123",
    "namespace": "production",
    "uid": "12345678-1234-1234-1234-123456789012",
    "resourceVersion": "123456",
    "labels": {"app": "payment"},
    "ownerReferences": [
      {
        "apiVersion": "apps/v1",
        "kind": "ReplicaSet",
        "name": "payment-service-abc",
        "uid": "87654321-4321-4321-4321-210987654321"
      }
    ]
  },
  "spec": {
    "containers": [
      {
        "name": "payment",
        "image": "payment-service:v2.1.0",
        "ports": [{"containerPort": 8080, "name": "http"}],
        "resources": {
          "requests": {"cpu": "500m", "memory": "512Mi"},
          "limits": {"cpu": "1000m", "memory": "1Gi"}
        }
      }
    ]
  },
  "status": {
    "phase": "Running",
    "conditions": [
      {
        "type": "Ready",
        "status": "True",
        "lastProbeTime": "2025-02-10T14:30:00Z",
        "lastTransitionTime": "2025-02-08T10:30:00Z"
      }
    ],
    "containerStatuses": [
      {
        "name": "payment",
        "ready": true,
        "restartCount": 0,
        "state": {"running": {"startedAt": "2025-02-10T14:25:00Z"}}
      }
    ]
  }
}
```

Safety level: Safe (read-only).

Caching: Results cached for 2 minutes, invalidated when resource is updated.

**get_logs Tool**

Purpose: Retrieve logs from a Pod, filtered by time range and optionally by semantic meaning.

Input parameters:
- pod_identifier (required): "namespace/Pod/pod-name"
- container_name (optional): specific container (if not specified, all containers)
- lines (optional): number of recent lines to retrieve (default 100, max 10000)
- since_time (optional): retrieve logs since this time
- semantic_hint (optional): natural language hint about what to search for (e.g., "errors", "connection failures", "startup")
- follow (optional): if true, stream logs continuously (for investigation streams)

Output format: Log lines in text format, optionally with metadata:

```json
{
  "logs": [
    {
      "timestamp": "2025-02-10T14:30:01Z",
      "level": "INFO",
      "message": "Server started on port 8080"
    }
  ],
  "container": "payment",
  "pod": "payment-service-abc123",
  "truncated": false,
  "total_lines_available": 1043
}
```

Safety level: Safe (read-only). Logs may contain sensitive information, handled according to security policies.

Caching: Not cached (logs change frequently). Retrieved fresh from kubilitics-backend.

**get_metrics Tool**

Purpose: Retrieve current and historical metrics for a resource (CPU, memory, network, disk, application metrics if available).

Input parameters:
- resource_identifier (required): "namespace/kind/name"
- metric_types (optional): which metrics to retrieve (cpu, memory, network_in, network_out, disk, latency, error_rate, etc.)
- time_range (optional): how far back to go (default 1 hour, max 30 days)
- granularity (optional): level of detail (1m, 5m, 1h, etc., default depends on time range)

Output format: Time-series data:

```json
{
  "resource": "production/Pod/payment-service-abc123",
  "metrics": [
    {
      "name": "cpu_usage_millicores",
      "unit": "m",
      "samples": [
        {"timestamp": "2025-02-10T14:00:00Z", "value": 450},
        {"timestamp": "2025-02-10T14:05:00Z", "value": 480}
      ],
      "current_value": 475,
      "min": 100,
      "max": 950,
      "average": 450,
      "p95": 800,
      "p99": 900
    }
  ]
}
```

Safety level: Safe (read-only).

Caching: Results cached for 30 seconds. Frequent calls return cached results.

**get_topology Tool**

Purpose: Retrieve the resource dependency graph showing what resources depend on the specified resource and what it depends on.

Input parameters:
- resource_identifier (required)
- depth (optional): how many levels of dependencies to include (default 2, max 5)
- direction (optional): "in" (what depends on this), "out" (what this depends on), "both" (default)

Output format: Graph structure:

```json
{
  "center": "production/Deployment/payment-service",
  "nodes": [
    {
      "identifier": "production/Deployment/payment-service",
      "kind": "Deployment",
      "name": "payment-service",
      "status": "healthy"
    }
  ],
  "edges": [
    {
      "from": "production/Deployment/payment-service",
      "to": "production/Service/payment",
      "relationship_type": "creates",
      "impact_severity": "high"
    }
  ]
}
```

Safety level: Safe (read-only).

Caching: Results cached for 5 minutes.

### Tier 2 Analysis Tools - Detailed Specifications

**analyze_trends Tool**

Purpose: Perform statistical analysis on time-series metric data, identifying trends, anomalies, and forecasting future values.

Input parameters:
- metric_data (required): array of {timestamp, value} pairs
- analysis_type (optional): which analyses to perform (trend, anomaly, forecast, seasonal, all)
- forecast_horizon (optional): how far ahead to forecast (default 1 day, max 30 days)
- anomaly_sensitivity (optional): threshold for anomaly detection (default 2.5 sigma)

Output format: Comprehensive analysis results:

```json
{
  "trend": {
    "direction": "increasing",
    "slope": 2.5,  // units per day
    "confidence": 0.92,
    "interpretation": "CPU usage increasing at 2.5m per day"
  },
  "anomalies": [
    {
      "timestamp": "2025-02-09T03:00:00Z",
      "value": 950,
      "z_score": 3.2,
      "severity": "critical",
      "explanation": "Spike 3.2 standard deviations above normal"
    }
  ],
  "forecast": {
    "next_1_day": {
      "predicted_value": 500,
      "confidence_interval": [450, 550],
      "confidence": 0.85
    },
    "next_7_days": {
      "predicted_value": 520,
      "confidence_interval": [400, 640],
      "confidence": 0.70
    }
  },
  "seasonality": {
    "detected": true,
    "period": "daily",
    "peak_hour": 9,
    "valley_hour": 3
  }
}
```

Safety level: Safe (analysis only).

Caching: Results cached. Invalidated when new data arrives.

### Tier 4 Execution Tools - Safety and Behavior

**patch_resource Tool**

Purpose: Apply a JSON patch or strategic merge patch to a Kubernetes resource.

Input parameters:
- resource_identifier (required)
- patch (required): the patch to apply (as JSON patch or SMM patch)
- patch_type (optional): "json" or "merge" (default: merge)
- dry_run (optional): if true, show what would change without applying (default: true)

Behavior:
1. Validate patch syntax
2. If dry_run mode, retrieve current resource, apply patch locally, return result without committing
3. If not dry_run or after user confirms dry-run results:
   a. Call safety engine to verify patch is allowed
   b. Call kubilitics-backend ExecuteCommand with patch
   c. Wait for result
   d. Return success/failure

Output format:
```json
{
  "status": "success|failure",
  "resource_before": {...},
  "resource_after": {...},
  "changes": [
    {"path": "/spec/replicas", "old_value": 3, "new_value": 5}
  ],
  "message": "Successfully patched deployment"
}
```

Safety level: Dangerous (mutation). Requires safety engine approval.

**delete_resource Tool**

Purpose: Delete a Kubernetes resource. This is the most dangerous operation.

Input parameters:
- resource_identifier (required)
- grace_period_seconds (optional): grace period for pod termination (default 30)
- propagation_policy (optional): how to handle dependent resources

Behavior:
1. Call safety engine to verify deletion is allowed
2. Check immutable rule: "Never delete from kube-system or protected namespaces"
3. Calculate blast radius: what other resources would be affected?
4. If blast radius is large or autonomy level is low, require explicit approval
5. If approved, call kubilitics-backend ExecuteCommand
6. Return result

Safety level: Very dangerous. Requires high autonomy level and explicit approval.

---

## Section 21: Context Builder Algorithms and Strategies

### Relevance Scoring Algorithm

The context builder must select the most relevant information to fit in the LLM context window. It uses a relevance scoring algorithm that assigns scores to different pieces of information.

For an investigation about "Why is the payment service down?", the relevance scores might be:

- Recent events related to payment service: score 100 (highly relevant)
- Recent errors in payment service logs: score 95
- Metrics for payment service: score 90
- Configuration of payment service: score 85
- Events in dependent services: score 70
- Events in upstream services: score 60
- Events in unrelated services: score 5
- Historical metrics from 30 days ago: score 1

The context builder sorts information by relevance and includes as much as fits in the context window, starting with highest relevance.

Different investigation types use different relevance weights:
- Diagnostic investigation: recent events and errors are highly relevant
- Informational investigation: current state and configuration are highly relevant
- Predictive investigation: historical trends and patterns are highly relevant
- Remediation investigation: configuration and best practices are highly relevant

### Progressive Summarization Strategy

If the context is too large to fit in the window, the context builder progressively summarizes data rather than dropping it.

Level 1 (raw): Include all data
Level 2 (summarized): Summarize time-series to key statistics (min, max, average, trend)
Level 3 (highly summarized): Summarize to single sentences ("CPU is stable at 500m", "Memory increasing 10MB/day")
Level 4 (extreme): Drop lowest-relevance categories entirely

Example of progressive summarization for metrics:

Raw (100 data points over 1 hour):
```
timestamp,value
14:00,450
14:05,480
14:10,520
...
```

Summarized (key statistics):
```
CPU usage: min=450m, avg=475m, max=950m, trend=stable
Last spike at 14:30 (950m), 2 minutes duration
```

Highly summarized (prose):
```
CPU usage is stable around 475m with occasional spikes to 950m.
```

This ensures that even with limited context, the LLM has a good overview of the situation.

---

## Section 22: Autonomy Level Behavioral Specifications

### Level 1: Observe - Detailed Behavior

At Level 1, kubilitics-ai is purely informational. It gathers data, analyzes it, and reports findings. It does not propose actions.

Behavior:
- User submits investigation query
- Reasoning engine gathers context, generates hypotheses, tests them
- Findings are generated and displayed as insights
- Recommendations may be generated (suggestions, best practices)
- No actions are proposed
- No mutations are made

API responses for Level 1:
- Investigations complete normally
- Insights are created and displayed
- GET /api/v1/ai/actions/pending returns empty list (no pending actions at Level 1)
- Any attempt to create an action proposal fails with error "Cannot propose actions at Level 1"

Use case: Organizations want AI as an advisor, not an actor.

### Level 2: Recommend - Detailed Behavior

At Level 2, kubilitics-ai can recommend actions but does not execute them.

Behavior:
- All Level 1 behavior
- After reaching conclusions, the reasoning engine generates explicit recommendations
- Recommendations are formatted as prose with explanation, not as executable actions
- Examples: "You should scale this deployment up", "Update the image to remove the vulnerability"
- No structured action proposals are created
- No execution occurs

API responses for Level 2:
- Insights include recommendations field
- GET /api/v1/ai/actions/pending returns empty list (actions are not proposed, only recommended)
- Recommendations appear in investigation details

Use case: Organizations want AI to advise on what should be done.

### Level 3: Propose - Detailed Behavior

At Level 3, kubilitics-ai proposes specific executable actions.

Behavior:
- All Level 1 and 2 behavior
- After determining actions to take, create explicit action proposals
- Each action proposal specifies exactly what would change, why, risk, etc.
- User must approve each action before it executes
- Safety engine checks each action before approval is allowed
- User approves/rejects via REST API

API responses for Level 3:
- GET /api/v1/ai/actions/pending returns list of proposed actions awaiting approval
- POST /api/v1/ai/actions/{id}/approve executes the action
- Actions must be individually approved; cannot bulk approve

Use case: Organizations want AI to propose specific actions for human approval.

### Level 4: Act with Guard - Detailed Behavior

At Level 4, kubilitics-ai executes safe actions automatically. Dangerous actions require approval.

Behavior:
- All Level 1-3 behavior
- When proposing actions, categorize each as safe or dangerous
- Safe actions are executed immediately
- Dangerous actions are proposed and require approval before execution
- Safety engine categorizes actions based on:
  - Type of mutation (scaling safe, deletion dangerous)
  - Blast radius (large blast radius triggers dangerous)
  - Autonomy level of the action (high-risk autonomy decisions need approval)

Safe action examples: Scale within configured limits, restart a pod, update configuration
Dangerous action examples: Delete a resource, scale beyond limits, modify RBAC

API responses for Level 4:
- GET /api/v1/ai/actions/pending returns dangerous actions only
- POST /api/v1/ai/actions/{id}/approve is needed for dangerous actions
- Safe actions are already executed, not shown as pending

Use case: Organizations want AI to manage routine operations automatically while escalating risky decisions.

### Level 5: Full Autonomous - Detailed Behavior

At Level 5, kubilitics-ai executes all actions autonomously within policy bounds.

Behavior:
- All Level 1-4 behavior
- All actions (safe and dangerous) are executed without human approval
- Safety engine still enforces immutable rules and policies
- Actions are logged and audited
- Automatic rollback may trigger if action degrades metrics

API responses for Level 5:
- Actions are executed immediately
- GET /api/v1/ai/actions/pending returns empty list (actions don't wait for approval)
- Action history shows all executed actions

Use case: Organizations with very high confidence in the system and extensive safety policies.

---

## Section 23: Testing and Quality Assurance Strategies

### Test Pyramid

kubilitics-ai follows the testing pyramid: many unit tests (cheap, fast), fewer integration tests (medium cost and speed), few E2E tests (expensive, slow).

Base (unit tests): 70% of test code. Test individual functions, components in isolation with mocks.

Middle (integration tests): 20% of test code. Test multiple components together, e.g., reasoning engine with mock tools.

Top (E2E tests): 10% of test code. Test entire system from API to outcome.

### Fuzz Testing for Safety Engine

The safety engine is extensively fuzz-tested with adversarial inputs attempting to break safety guarantees.

Fuzz scenarios:
- Try to propose actions that violate immutable rules → safety engine blocks
- Try to execute at wrong autonomy level → safety engine blocks
- Try to patch resources in protected namespaces → safety engine blocks
- Try to delete more pods than the limit → safety engine blocks
- Propose actions with blast radius exceeding limits → safety engine escalates

For each scenario, generate random variations and verify the safety engine correctly handles them.

### Regression Testing

For critical paths (e.g., "Diagnose pod crash loop"), record the complete investigation (mocked LLM response) and replay it periodically to verify outputs haven't changed.

---

## Section 24: Resource Estimation and Capacity Planning

### Typical Resource Consumption

kubilitics-ai resource consumption depends on several factors: cluster size (number of nodes and pods), investigation frequency (how often investigations are run), database retention period (how much historical data is kept), and whether optional features like vector memory are enabled.

For a small cluster deployment (5 nodes, 50 pods) with light usage (1-2 investigations per day) and 7 days of retention:
- CPU: 50-100 millicores steady state, up to 500 millicores during active investigations
- Memory: 100-200 MB steady state, peaks at 300-400 MB
- Database size: 10-20 MB SQLite
- Network egress: 100-500 MB per month

For a medium cluster deployment (20 nodes, 500 pods) with moderate usage (10-20 investigations per day) and 30 days of retention:
- CPU: 100-300 millicores steady state, 500 millicores to 1 core during load
- Memory: 200-400 MB steady state, 500-700 MB peak
- Database size: 100-200 MB SQLite or 500 MB to 1 GB PostgreSQL
- Network egress: 10-50 GB per month

For a large cluster deployment (100 nodes, 5000 pods) with heavy usage (100+ investigations per day) and 1 year of retention:
- CPU: 500 millicores to 2 cores steady state, 2-4 cores during peak load
- Memory: 500 MB to 1 GB steady state, up to 2-3 GB peak
- Database size: 5-10 GB PostgreSQL with proper indexing
- Network egress: 100-500 GB per month

The metrics table growth for analytics data is predictable: with 100 pods, 10 metrics per pod, and 96 samples per day (15-minute intervals), you accumulate 96,000 rows per day or about 35 million rows per year. With downsampling (keeping raw data for 30 days, then 1-hour aggregates), the database remains manageable at 200 MB to 1 GB.

### Cost Estimation Models

kubilitics-ai costs consist of three components: infrastructure costs (Kubernetes resources), LLM API costs (per-token charges), and database costs (if using managed services).

Infrastructure costs depend on cluster size and can be estimated as: "kubilitics-ai shares the cluster with other workloads, so allocate a portion of cluster costs to AI. For a 50-node cluster, allocate 1-3 nodes worth of cost."

LLM API costs are the most significant variable cost. OpenAI GPT-4 Turbo costs $0.01 per 1K input tokens and $0.03 per 1K output tokens. A typical investigation might consume 5K-10K input tokens and generate 2K-5K output tokens, costing $0.05-$0.15 per investigation. With 10 investigations per day, that's $0.50-$1.50 per day or $15-45 per month per investigation. At 100 investigations per day, costs climb to $150-450 per month. Anthropic Claude 3.5 Sonnet is roughly 70% the cost of GPT-4. Local Ollama models have zero API cost but compute cost (hardware depreciation and electricity).

Database costs for managed PostgreSQL (AWS RDS, Google Cloud SQL, Azure) are typically $10-50 per month for small deployments, $50-200 per month for medium deployments, and $200-1000+ for large deployments with replication and backups.

Total cost for typical deployments:

Small (5 nodes): Infrastructure $5-10/mo + LLM APIs $15-45/mo + Database $0/mo (SQLite) = $20-55/mo

Medium (20 nodes): Infrastructure $50-150/mo + LLM APIs $150-450/mo + Database $20-50/mo = $220-650/mo

Large (100 nodes): Infrastructure $200-500/mo + LLM APIs $1500-4500/mo + Database $100-300/mo = $1800-5300/mo

### Capacity Planning Recommendations

For organizations planning kubilitics-ai deployment:

1. Start with a pilot deployment on a smaller cluster to understand usage patterns
2. Monitor actual resource consumption and LLM API token usage for 1-2 months
3. Use collected data to project costs for full deployment
4. Configure token budgets to prevent unexpected costs
5. Implement cost alerts that notify when spending exceeds thresholds
6. Review quarterly to optimize: are some investigations costing more than expected? Can tools be cached better?

---

## Section 25: Training and Knowledge Transfer

### Documentation Strategy

kubilitics-ai requires comprehensive documentation for multiple audiences, each with different needs and expertise levels.

Operator Documentation is aimed at people who deploy, maintain, and troubleshoot kubilitics-ai. This includes: installation procedures for different platforms (Kubernetes, Docker Compose, standalone), configuration reference documentation for every environment variable and configuration option, troubleshooting guides covering common issues and their solutions, upgrade procedures for moving between versions, backup and recovery procedures for data protection, and monitoring setup instructions for health checks and alerting. Example troubleshooting entries: "kubilitics-ai pod keeps crashing: check backend connectivity, LLM API key validity", "Investigations are slow: check tool caching, LLM provider latency, backend latency".

Platform Administrator Documentation targets users who configure policies, safety rules, and access controls. This includes detailed YAML reference for safety policies, explanation of each autonomy level with recommendations on which to use, cost budgeting setup and monitoring, rate limiting configuration, integration with authentication systems (OAuth, OIDC, SAML), and audit log configuration. Administrators need to understand the security and policy model deeply.

End User Documentation is for people actually using kubilitics-ai to manage clusters. This includes: tutorials on how to ask effective investigation questions, explanation of what insights mean and how to interpret them, action approval workflow (how to review and approve proposed changes), chat interface guide (conversational usage patterns), best practices for query formulation, and examples of common scenarios. Users don't need to understand the internal architecture, only how to use the system.

Developer Documentation is for engineers contributing to kubilitics-ai development. This includes architecture overview (reference this design document), component deep-dives explaining each major component, REST API reference (auto-generated from OpenAPI specs), tool catalog with complete specifications, LLM provider integration guide, testing framework explanation, and build and deployment procedures.

Architectural Documentation maintains this design document as the source of truth, supplemented by: decision records (why was architecture choice X made instead of Y?), component deep-dives for each major module, technology choices and trade-offs, and rationale for design decisions.

### Training Program Outline

Organizations deploying kubilitics-ai across teams may want formal training. A suggested curriculum:

Operator Training (4 hours): Introduction to kubilitics-ai and how it integrates with Kubilitics, installation and deployment walkthrough, configuration and environment setup, health monitoring and alerting setup, common troubleshooting scenarios, backup and recovery procedures.

Administrator Training (6-8 hours): Safety and autonomy levels deep-dive, policy configuration with hands-on YAML editing, authorization and RBAC configuration, audit logging setup and analysis, cost monitoring and budgeting, integration with authentication systems, disaster recovery procedures.

User Training (2-4 hours): Capabilities and limitations of the AI system, how to ask effective questions, understanding investigation results and insights, approving and monitoring actions, best practices for using the system, when to rely on AI vs. manual operations.

Development Training (8-16 hours, specialized): Architecture overview and design principles, codebase walkthrough, tool implementation how-to, testing strategies and writing tests, deploying and testing changes, debugging and profiling, contribution guidelines.

---

## Section 26: Compliance and Regulatory Considerations

### Audit Trail and Compliance Requirements

kubilitics-ai must maintain complete audit trails to comply with regulations such as SOC 2, ISO 27001, HIPAA, PCI-DSS, and other security/compliance frameworks. The audit trail is non-negotiable for organizations in regulated industries.

What must be audited: Every investigation initiated (user, timestamp, query text, target resources), every tool invocation during an investigation (which tool, parameters, results), every action proposed (what would change, risk assessment, confidence), every action approval or rejection (who decided, when, any notes), every action execution (what actually changed, success/failure, any errors), configuration changes (what setting changed, old value, new value, who changed it, when), user access and authentication events, any failed security checks or attempts to violate safety rules, cost and token usage (for compliance with budgets).

The audit log must be immutable: once written to the audit log, entries cannot be modified or deleted (except per retention policy for entries older than the policy-defined period, e.g., "delete audit entries older than 7 years"). Timestamps must be precise (at least second-level precision, preferably millisecond). Every audit entry must attribute the action to a user or service account. Entries must be traceable: investigation IDs, action IDs, and correlation IDs link related events. Audit logs must be exportable to compliance and SIEM systems (Splunk, ELK, Datadog, etc.).

Audit log retention policies should match organizational and regulatory requirements: many regulations require 3-7 years of audit logs. Default retention should be at least 1 year.

### Data Residency and Privacy Compliance

Organizations subject to data residency requirements (GDPR, HIPAA, CCPA, etc.) can configure kubilitics-ai to never transmit cluster data outside specified geographic regions.

Deployment models for data residency:
- Local Ollama instances: LLM runs locally in the cluster, no data leaves
- Region-specific LLM endpoints: Use OpenAI, Anthropic, or Ollama in the same region/datacenter
- On-premises databases: PostgreSQL runs in owned data center, not in cloud
- Network policies: Restrict outbound traffic to approved endpoints only

Configuration options for data privacy:
- Disable vector memory (avoids uploading text to external vector databases)
- Encrypt database at rest (SQLite on encrypted filesystem, PostgreSQL with TDE)
- Encrypt database in transit (TLS for database connections)
- Secrets in Vault: Store API keys in external secret manager, not in config files
- Log sanitization: Remove sensitive data from audit logs before export

### Security Compliance Features

kubilitics-ai supports the security requirements of compliance frameworks:

Authentication: Integration with enterprise authentication systems (OAuth 2.0, OpenID Connect, SAML), MFA support (delegated to identity provider), service account authentication for programmatic access.

Authorization: RBAC integration (users can only see/act on resources they have permission to access), attribute-based access control (policies based on user attributes, resource attributes), delegation (users can delegate approval authority).

Encryption: At-rest encryption (database stored encrypted), in-transit encryption (TLS for all external connections), secrets encryption (API keys stored encrypted).

Secrets management: Integration with Kubernetes Secrets, HashiCorp Vault, AWS Secrets Manager, Azure Key Vault; automatic secret rotation support.

Audit logging: Complete audit trail as described above, tamper detection (alerts on audit log modification), audit log archival and export.

Rate limiting: Per-user rate limits prevent abuse, per-API rate limits prevent overload, DDoS mitigation (if deployed behind load balancer).

Input validation: All user inputs validated to prevent injection attacks, API request validation against schema, Safe deserialization of untrusted data.

---

## Section 27: Long-Term Maintenance and Evolution

### Ongoing Code Maintenance

kubilitics-ai codebase should be maintained with these practices:

Technical debt allocation: Allocate 15-20% of each sprint to addressing technical debt (refactoring, simplifying complex code, improving tests). Technical debt compounds over time; ignoring it leads to slower development. Regular investment keeps the codebase healthy.

Dependency management: Go dependencies should be updated monthly, or immediately if security vulnerabilities are announced. Updates should be tested in staging before production. Use dependabot or similar tools to automate dependency version checks. Balance staying current with stability.

Performance optimization: Profile the system regularly (monthly or quarterly), identify slow code paths, optimize. Measure improvements before and after. Target: investigations should complete faster over time as optimizations accumulate. Maintain performance benchmarks and alert if performance regresses.

Documentation maintenance: Keep architectural documentation current as code evolves. Outdated documentation is actively harmful (misleads developers). Review and update docs quarterly.

Testing discipline: Maintain high test coverage (target 80%+). New features should include tests. Bug fixes should include regression tests (prevent the bug from reoccurring). Refactors should not change test coverage.

Code review process: All code changes reviewed by at least one other engineer. Code reviews catch bugs, share knowledge, maintain consistency. Review checklist should cover functionality, performance, testing, security, and documentation.

### Version Management and Release Process

kubilitics-ai follows semantic versioning:
- Major version changes (X.0.0): Breaking changes in API, behavior, or data format. Users may need manual migration.
- Minor version changes (X.Y.0): New features, backward compatible. Users can upgrade freely.
- Patch version changes (X.Y.Z): Bug fixes, backward compatible. Users should upgrade promptly, especially for security fixes.

Release process:
1. Create release branch from main
2. Update version number, CHANGELOG
3. Tag release (git tag vX.Y.Z)
4. Build artifacts (Docker images, binaries)
5. Run full test suite
6. Publish artifacts
7. Update documentation
8. Announce release

Users are encouraged to stay within one minor version of current (e.g., if current is 1.5.0, supported versions are 1.4.x and 1.5.x). Security updates should be deployed quickly; minor feature updates can be deployed on a schedule.

### Long-Term Feature Roadmap

Expected feature development timeline:

Weeks 1-20 (initial implementation): Phases 1-7 deliver core functionality.

Months 6-12 (stabilization): Fix bugs, performance optimization, user feedback incorporation. Expected: v1.1, v1.2, v1.3.

Year 2 (expansion): Multi-cluster support, advanced ML-based analytics, tighter integrations with observability platforms, enhanced LLM provider support, community feedback features.

Year 3+ (maturation): Machine learning models trained on historical investigation data, autonomous optimization (automatically optimize cluster configuration), integration with incident management systems, collaborative intelligence (clusters learn from each other).

Development velocity: 2-week sprints, with 25-30% velocity allocated to maintenance, testing, and technical debt. Typical capacity: 2-3 significant features per sprint, or 1 major feature per sprint plus maintenance.

---

## Final Comprehensive Summary and Conclusion

The kubilitics-ai system as specified in this complete design document represents a comprehensive, production-grade AI subsystem for the Kubilitics platform. It is architected to achieve multiple critical objectives:

Complete independence from the core platform (one-way dependency only), ensuring the core remains stable and the AI can be deployed, upgraded, and removed independently. Multiple layers of safety guarantees (autonomy levels, immutable rules, human escalation) that prevent the AI from causing harm. Comprehensive observability through structured logging, metrics, tracing, and immutable audit logs. Extensibility at multiple points (LLM providers, tools, policies) allowing customization without code changes.

The system implements best practices in several domains:

Safety and control: Five autonomy levels let organizations choose their level of AI autonomy. Immutable safety rules prevent dangerous operations. Human escalation ensures humans remain in control when needed. Automatic rollback prevents sustained damage from AI mistakes.

Observability and auditability: Every significant action is logged. Logs are structured (JSON), searchable, and exportable. Tracing shows the complete flow of investigations. Metrics track system health and usage. Complete audit trail for compliance.

Reliability and graceful degradation: The system handles component failures gracefully. If the backend gRPC connection fails, kubilitics-ai operates on cached data. If the LLM provider is unavailable, it fails over to a secondary provider. If the database fails, investigations in-memory continue (but history is not persisted). The system never crashes due to component failures; it degrades.

Performance and scalability: Caching at multiple levels reduces latency. Parallel tool execution speeds investigations. Incremental updates from the backend keep the World Model fresh without full syncs. The system scales from single-instance (small deployments) to multi-instance with shared database (large deployments).

Security: Authentication and authorization integrated with enterprise systems. Encryption at rest and in transit. Secrets management integration. Rate limiting and abuse prevention. RBAC enforcement.

Extensibility: New LLM providers can be added by implementing one interface. New tools can be added without modifying the reasoning engine. New analysis techniques can be added to analytics. New policies can be configured without code changes.

Implementation of this design requires discipline and good engineering practices, but the architecture provides a solid foundation that has been carefully thought through. The phased approach (7 phases over 20 weeks) ensures early wins and allows course correction based on learning.

This comprehensive design document provides everything needed to guide the engineering team through the entire kubilitics-ai implementation journey, from initial project setup through production deployment and long-term maintenance. It serves as the definitive specification and will remain the authoritative source for architectural decisions throughout the project lifecycle.

