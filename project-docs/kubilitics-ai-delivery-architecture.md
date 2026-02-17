# Kubilitics AI-Integrated Delivery Architecture & Deployment Strategy

**Document 1 of 3: Architecture & Multi-Platform Deployment Model**

**Version:** 1.0
**Date:** 2026-02-10
**Classification:** Technical Architecture Document
**Audience:** Engineering Leadership, Platform Architects, DevOps Teams

---

## Section 1: Executive Summary

### The Delivery Challenge

Kubilitics represents a sophisticated systems management platform built on Kubernetes principles, engineered as a distributed application spanning desktop, mobile, and in-cluster deployment models. The core platform has successfully delivered REST API backends, real-time WebSocket streaming, cross-platform desktop applications via Tauri, and cloud-native Helm-based deployments. This foundation enabled users to observe, control, and troubleshoot Kubernetes clusters with unprecedented clarity and responsiveness.

However, the next evolutionary step in platform capability requires integration of artificial intelligence as a first-class feature, not a peripheral add-on. Users increasingly demand intelligent analysis: predictive failure detection, root cause investigation across distributed logs, automated remediation recommendations, and natural language interfaces to cluster operations. This is not a simple feature toggle. Integrating AI into Kubilitics requires fundamentally rethinking our delivery architecture to accommodate a new class of computational workload—one that is stateful, resource-hungry, vendor-dependent (via external LLM APIs), and operationally distinct from traditional Kubernetes monitoring systems.

The engineering challenge unfolds across three dimensions. First, the technical complexity: how do we incorporate an AI service (kubilitics-ai) alongside existing backend and frontend components without creating a monolithic binary that bloats every installation? Second, the operational complexity: how do we manage an additional process on the desktop, coordinate networking between multiple services, and ensure graceful degradation when AI components are unavailable or misconfigured? Third, the commercial complexity: how do we allow users to bring their own LLM providers (OpenAI, Anthropic, open-source models via Ollama), manage varying API costs, and prevent runaway spending?

### Key Architectural Decision: kubilitics-ai as a Separate Process/Container

The central architectural decision that unlocks this integration is the commitment to kubilitics-ai as an independent, standalone service rather than embedding it within the existing backend monolith. This decision has profound implications across all deployment targets.

On the desktop, kubilitics-ai runs as a second sidecar process spawned alongside kubilitics-backend, each with its own lifecycle, networking, and resource boundaries. On mobile, kubilitics-ai coexists with kubilitics-backend on a remote server, communicating via well-defined gateway patterns. In-cluster, kubilitics-ai deploys as a separate Kubernetes Deployment and Service, scaling independently from the backend. This architectural choice enables several critical capabilities:

**Operational Independence**: AI workloads can be updated, restarted, or disabled without affecting core cluster monitoring and control. If an AI investigation fails, the system continues delivering accurate real-time cluster metrics. If an LLM API goes down, users receive a graceful "AI features unavailable" message, not a degraded or broken platform.

**Resource Isolation**: AI computations (reasoning, vector memory operations, LLM API calls) are confined within their own process, preventing memory leaks or runaway threads in one subsystem from crashing the entire application. This is especially critical on desktop environments where resources are constrained and user expectations for reliability remain high.

**Vendor Agnosticity**: By maintaining clear, versioned gRPC and HTTP boundaries between services, kubilitics-ai can evolve LLM provider support (OpenAI, Anthropic, Ollama, Azure OpenAI, local quantized models) without requiring coordinated deployments of backend and frontend. The architecture anticipates a future where LLM providers are pluggable, testable in isolation, and upgradeable on independent schedules.

**Scaling Flexibility**: Enterprise customers deploying Kubilitics in Kubernetes can scale the AI pod independently based on investigation request volume, separate from backend API servers that handle cluster monitoring queries. A large cluster with heavy monitoring load might run five backend replicas but only two AI replicas, optimizing resource utilization and cost.

### The Graceful Degradation Principle: Core Platform Independence from AI

The foundational design principle that permeates every architectural decision in this document is graceful degradation. Kubilitics must function completely, fully, and reliably without any AI component operational. A user installing Kubilitics for the first time has access to all core features—real-time monitoring, log aggregation, cluster control, event streaming—immediately, without needing to configure API keys, manage LLM provider accounts, or ensure external service dependencies are reachable.

This principle is not merely a "nice to have" for resilience; it is a non-negotiable contract with users. Users have come to depend on Kubilitics to see their clusters and respond to failures in real-time. The platform must never make this core dependency conditional on the availability of an AI subsystem. The business model and user trust depend on this commitment.

Graceful degradation manifests across multiple layers. At the application layer, all user interface components detecting AI feature availability check dynamically whether the kubilitics-ai service is reachable and properly configured. If a health check fails, the UI disables AI-specific buttons, hides advanced investigation panels, and shows a non-blocking "Configure AI (optional)" prompt in Settings. The rest of the application continues functioning identically to a non-AI deployment.

At the deployment layer, the architecture ensures that failure to build, package, or deploy kubilitics-ai does not block desktop or mobile releases of the core platform. CI/CD pipelines treat backend and AI builds as independent tracks that merge only at the final release artifact stage. An AI build failure might delay a full release, but it need not block shipping critical security patches or reliability fixes to the backend and frontend.

At the operational layer, both desktop and in-cluster deployments implement health monitoring, automatic restart policies, and status reporting for kubilitics-ai that is independent from backend health monitoring. A misconfigured API key or unreachable LLM provider might cause kubilitics-ai to restart repeatedly, but this retry logic is decoupled from the backend's startup and operation.

This design ensures that the addition of AI capabilities to Kubilitics represents a strict superset of functionality: all existing behavior remains unchanged; all existing deployments continue to operate identically; the platform becomes more capable only when users explicitly choose to configure AI features. This commitment to backward compatibility and operational resilience will be evident throughout each deployment model discussed in subsequent sections.

---

## Section 2: Delivery Architecture Overview

### Three Distinct Deployment Targets

Kubilitics' delivery architecture must accommodate three fundamentally different environments, each with distinct constraints, capabilities, and operational models. These are not mere variations on a single deployment pattern; they represent three separate delivery pipelines that converge on the same set of frontend and backend artifacts but diverge significantly in how they incorporate kubilitics-ai.

**The Desktop Environment** represents the highest-control, most-optimized deployment scenario. Tauri provides a pristine application container, bundling the React frontend in a native webview, spawning Go processes as sidecars, managing network ports locally, and leveraging the host operating system's native keychain for credential storage. Users on desktop have administrative control over their machine, enabling features like local Ollama model hosting that would be impossible in shared environments. The desktop user experience emphasizes immediacy: changes to AI configuration take effect within seconds, not minutes. Resource consumption is directly visible and controllable.

**The Mobile Environment** removes the ability to spawn local processes entirely. Neither iOS nor Android permit applications to spawn arbitrary sidecar services as desktop Tauri can. Instead, the mobile application must be designed as a frontend-only thin client that connects to a remote backend cluster. This creates both constraints and opportunities. The constraint is that AI features must be hosted on a server somewhere—either an enterprise deployment of Kubilitics running on Kubernetes, or a Kubilitics Cloud service provided by the vendor. The opportunity is that mobile users have the same cluster visibility and control as desktop users, with features scaling and updating from a central server.

**The In-Cluster Environment** represents deployment on Kubernetes itself, where Kubilitics runs as a service managing other Kubernetes clusters (or, in some cases, managing itself). This is the environment where Kubilitics is deployed as part of shared infrastructure, managed by DevOps teams, integrated into GitOps pipelines, and subject to organizational policies around resource quotas, network policies, and data residency. In this environment, kubilitics-ai becomes another containerized workload among many, subject to the same governance, monitoring, and scaling patterns as the backend and frontend services.

### Architecture Diagram Descriptions: Text-Based Conceptual Model

While this document contains no graphical diagrams, understanding the spatial relationships between components is essential to understanding the delivery architecture.

**Desktop Architecture Conceptualization**: Picture a single user's macOS or Windows machine. The Tauri application window displays the React frontend in a webview. Beneath the surface, the Tauri runtime spawns two distinct Go processes as external binaries. The first process is kubilitics-backend, bound to localhost:8080, implementing the REST API and WebSocket streaming infrastructure. The second process is kubilitics-ai, bound to localhost:8081, implementing the reasoning engine and LLM orchestration. The frontend JavaScript communicates with both services via HTTP and WebSocket connections to these local ports. Each process manages its own configuration, logs, and lifecycle. The Tauri updater system manages binary versions for both services, ensuring that desktop updates install matching versions of both backend and AI components. The user's machine's native keychain stores LLM API keys securely; the kubilitics-ai process retrieves these keys at startup or when settings change.

**Mobile Architecture Conceptualization**: A user opens the Kubilitics mobile application on their iPhone or Android device. They see the same React frontend interface as a desktop user, rendered in a Tauri mobile webview, but the underlying services are not local. Instead, the frontend connects to a server whose address was configured during onboarding (either an enterprise Kubilitics deployment or a cloud-hosted variant). On that server, kubilitics-backend and kubilitics-ai run as Kubernetes Pods, possibly coordinated by a single ingress or API gateway that exposes both services to the mobile client. The frontend makes HTTP and WebSocket requests across the network to these backend services. Latency and bandwidth become visible considerations—streaming responses are chunked appropriately, and the frontend may request only essential information for mobile screens rather than the full detail available to desktop users.

**In-Cluster Architecture Conceptualization**: Imagine a Kubernetes cluster running Kubilitics as a self-contained deployment. The Helm chart instantiates multiple Kubernetes resources: a Deployment managing replicas of the backend API server, a Deployment for the frontend nginx server (or backend serving static files), and a new Deployment for kubilitics-ai. Each Deployment has associated Service resources exposing endpoints to other pods on the cluster network. A ConfigMap stores non-sensitive configuration (LLM provider selection, feature flags). A Secret stores sensitive data (LLM API keys). The kubilitics-ai pod mounts these configuration resources, starts up, and begins listening for requests from the backend pod over gRPC. The frontend nginx server serves static assets, and the backend API server implements REST and WebSocket endpoints accessible to external clients. Within the cluster, the backend communicates with kubilitics-ai; to external clients, the cluster appears as a single service. Users can apply standard Kubernetes patterns: deploy multiple AI replicas with an HPA (Horizontal Pod Autoscaler) for high-volume scenarios, apply network policies to restrict egress from AI pods to only internal services plus external LLM provider APIs, and integrate monitoring and alerting via Prometheus and Grafana.

### Unified Service Discovery and Health Model

Across all three deployment environments, kubilitics-ai must be discoverable and health-checkable by the frontend in a consistent manner. The frontend does not hard-code assumptions about whether AI is local or remote, bundled or separate. Instead, both kubilitics-backend and kubilitics-ai expose health check endpoints (REST HTTP endpoints) that report their operational status. The backend implements a `/health` endpoint; kubilitics-ai implements `/health` and `/ready` endpoints that include AI-specific diagnostic information (LLM connectivity, vector memory status, reasoning engine operational status).

When the frontend initializes, it performs a health check to the backend (which is always reachable in the local or configured address space). The backend responds with metadata indicating whether kubilitics-ai is reachable. Separately, the frontend performs a direct health check to kubilitics-ai if it is configured as a local service. If both services are healthy and properly configured, the frontend unlocks AI features throughout its interface. If kubilitics-ai is unreachable or unhealthy, the frontend disables AI features and displays a clear indication (an icon, tooltip, or banner) that AI features are unavailable.

This abstraction allows the frontend to remain agnostic to deployment model. The same frontend code runs on desktop (where AI is local), mobile (where AI is on a server), and in-cluster (where AI is in a pod). The only variation is in configuration: a configuration property specifies the kubilitics-ai endpoint URL (localhost:8081 on desktop, a remote server address on mobile, a Kubernetes Service name on in-cluster).

---

## Section 3: Desktop Delivery - Tauri with Dual Sidecar Architecture

### Current Desktop Model and Its Extension

The existing Kubilitics desktop application exemplifies a sophisticated integration of Tauri, React, and Go into a seamless user experience. When a user launches the Kubilitics desktop application on macOS, Windows, or Linux, the Tauri runtime initializes. The React frontend renders within a native webview, presenting the full Kubilitics interface. Behind the scenes, Tauri spawns a Go binary (kubilitics-backend) as an external process, detaches from it (so the Go process continues running even if Tauri restarts), and exposes it on localhost:8080. The frontend connects to this local backend via HTTP and WebSocket, establishing real-time connections to stream logs, events, and metrics. This architecture has proven robust in production, delivering low-latency cluster monitoring and control directly to users' desktops.

The introduction of kubilitics-ai extends this model symmetrically. Rather than embedding AI into the backend monolith, Tauri spawns a second Go binary (kubilitics-ai) as an additional external process, bound to localhost:8081. The frontend, already equipped with HTTP and WebSocket client logic, gains new code paths that route AI requests to this second service. The architecture remains clean: each service owns its namespace, configuration, logging, and lifecycle. The operational model remains transparent: users see in Task Manager or Activity Monitor that their Kubilitics application is running multiple processes (one Tauri webview, one backend, one AI), each with visible CPU and memory consumption.

### Enhanced Process Management: BackendManager Becomes ServiceManager

The Tauri application currently implements process lifecycle management for kubilitics-backend through a BackendManager component (or equivalent pattern in your codebase) that handles spawning, monitoring, stopping, and restarting the backend binary. This pattern must be extended to coordinate both kubilitics-backend and kubilitics-ai as a unified service mesh.

The refactored ServiceManager pattern centralizes logic for spawning, health checking, and stopping both services. At application startup, the ServiceManager initializes in a specific sequence. First, it spawns kubilitics-backend and waits for it to become ready by polling its health endpoint until it responds successfully. Only after the backend is healthy does the ServiceManager spawn kubilitics-ai. This dependency ordering is critical: kubilitics-ai requires network connectivity to the backend for certain operations (validating cluster connectivity, storing investigation state) and should not attempt to start if the backend fails. The ordering provides fail-fast semantics—if the backend cannot start, the AI service will not even attempt to initialize, avoiding cascading startup failures.

The ServiceManager implements health monitoring for both services independently. It periodically polls the `/health` endpoint of both kubilitics-backend and kubilitics-ai. If either service becomes unhealthy (port unresponsive, process crashed), the ServiceManager logs the incident, marks the service as unhealthy in its status store, and implements configurable restart logic. The restart strategy for kubilitics-ai should be more conservative than for the backend: if kubilitics-ai fails due to a misconfigured LLM API key, restarting it repeatedly will not fix the problem. Instead, the ServiceManager should implement exponential backoff, a maximum restart count, and a clear user notification that AI features are unavailable due to a configuration error. The backend, conversely, might be restarted more aggressively since backend failures are typically due to transient network issues or system resource constraints.

At application shutdown, the ServiceManager follows a graceful shutdown sequence in reverse order: it sends a termination signal to kubilitics-ai first (if it is running), waits for it to exit cleanly (with a configurable timeout), then sends a termination signal to kubilitics-backend, and waits for that to exit. This sequence ensures that any in-flight requests from AI to backend can complete, and that the backend is not interrupted mid-request by sudden application closure.

### Network Port Allocation and Coordination

Desktop Tauri applications operate within a single user's local network namespace, where port allocation conflicts are rare but possible. The strategy for port allocation must be simple, predictable, and conflict-resistant.

The kubilitics-backend hardcodes port 8080 as its listen address. This is a known, documented port used by the existing user base. The kubilitics-ai service similarly hardcodes a specific port, designated as 8081. If a conflict is detected at startup (the port is already in use, perhaps by another application), the ServiceManager implements a fallback: it attempts the next port in a sequence (8082, 8083, etc.) until an available port is found. It then stores the actual port in a file in the user's data directory (typically ~/.kubilitics/config or a platform-specific equivalent), and the frontend reads this file at startup to discover the actual ports.

This approach is simpler than attempting dynamic port discovery via port 0 (which would require coordination between backend, AI service, and frontend), and it's more resilient than hard-coded assumptions. In practice, ports 8080 and 8081 will be available the vast majority of the time on user machines.

### Health Monitoring and Service Availability

The frontend UI must reflect the availability status of both backend and AI services. This creates a multi-level health model: the backend can be healthy and AI unhealthy, or vice versa. The frontend implements a status bar or indicator (possibly in the top-right corner or settings panel) that shows the status of both services. A green indicator means both are healthy. A yellow indicator means backend is healthy but AI is unavailable or misconfigured. The frontend intelligently enables and disables UI features based on this status.

The health check logic is asynchronous and non-blocking. The frontend does not wait for AI health checks to complete before rendering the interface. Instead, it renders with a provisional assumption (based on the last known state or a cached configuration), starts background health checks, and updates the UI when results arrive. This ensures that the application interface remains responsive even if health checks to the local services hang or time out.

The health check to the backend includes a query for AI status: the backend maintains an internal record of whether kubilitics-ai is reachable and responds to the frontend as part of its health response. This reduces the number of direct health checks the frontend must perform and provides a single source of truth for service health.

### Startup Sequence and Initialization Logic

The Tauri application startup sequence is critical to user experience. Users expect the application to open within seconds, not minutes. Blocking on service health checks during startup violates this expectation.

The optimized startup sequence proceeds as follows. When the user launches the Kubilitics application, the Tauri runtime initializes and renders the frontend interface immediately. While the interface renders, the ServiceManager initializes in the background, spawning kubilitics-backend and then kubilitics-ai. If the backend becomes ready within a short timeout (typically 3-5 seconds), the frontend transitions from a "Connecting..." state to a "Connected" state and enables cluster-related features. If kubilitics-ai becomes ready within a similar timeout, the frontend unlocks AI features.

If services are not ready within the timeout, the frontend still allows interaction. Users can browse settings, review cached data from previous sessions, and read documentation. When the backend finally becomes ready, the interface automatically transitions to connected state without requiring user intervention. This graceful initialization gives users the impression that the application is starting immediately while maintaining the ability to fully function even if service startup is slow or fails.

### Graceful Shutdown and Resource Cleanup

Desktop users expect to close the Kubilitics window and have the application cleanly shut down. The Tauri runtime provides a window close event that the application listens for. When the user closes the window, the application initiates shutdown.

The shutdown sequence is carefully orchestrated. First, the application signals all active AI operations to complete or cancel gracefully. Any in-flight investigations, long-running operations, or pending LLM requests are given a brief window to complete or be interrupted cleanly. Then, the ServiceManager sends a termination signal to kubilitics-ai and waits for it to exit (with a timeout, after which it forcibly terminates the process). Then it sends a termination signal to kubilitics-backend and waits similarly. Finally, the Tauri webview closes.

This sequence ensures that data is flushed, files are closed cleanly, and no background processes remain running after the user closes the application. This is especially important on macOS, where processes that do not exit cleanly may interfere with application relaunching and updates.

### Offline Mode and Graceful Feature Degradation

Desktop users may not always have configured LLM API credentials. In this case, kubilitics-ai can start, but it cannot fulfill AI requests because it lacks credentials to call external LLM providers. The frontend must detect this scenario and provide a clear, non-blocking user experience.

Offline mode (or more accurately, "AI unconfigured mode") is transparent to users. The core application functions completely: users can monitor clusters, view logs, manage resources, and receive real-time notifications. When the user attempts an action that requires AI (such as asking the AI Assistant panel a question, or requesting an investigation), the UI detects that AI credentials are not configured and displays a modal dialog or inline prompt: "AI features require configuration. Go to Settings > AI Configuration to enable?"

Clicking this prompt navigates the user to Settings, where they can choose an LLM provider and enter credentials. The UI does not shame or penalize users for not having AI configured; it simply presents the capability when requested, and explains clearly what is required to enable it.

When the user successfully configures an API key and the kubilitics-ai service connects to the LLM provider, the feature becomes available. Depending on the implementation, the frontend might cache this configuration in the backend's persistent storage, so that subsequent application launches do not require re-entry.

### Local LLM Model Support via Ollama Integration

An important design decision is that kubilitics-ai should support not only cloud-based LLM providers (OpenAI, Anthropic, Azure) but also local models running via Ollama. Ollama is an open-source project that allows users to download and run large language models locally on their machine, without requiring external API calls or credentials.

The integration with Ollama is straightforward: kubilitics-ai implements an Ollama adapter within its provider abstraction layer. When a user selects "Local Model (Ollama)" in the AI Configuration settings, the frontend prompts for the Ollama server URL (defaulting to http://localhost:11434, the standard Ollama port). The frontend attempts to validate this URL by querying Ollama's health endpoint.

On desktop, many users will already be running Ollama locally (it is a popular choice among ML enthusiasts and developers). Kubilitics detects whether Ollama is running and optionally suggests using it in the AI Configuration interface. The advantage to users is significant: no external API calls, no API keys to manage, no per-request costs, and full privacy (all computation happens locally). The tradeoff is that model inference happens on the user's machine, consuming local CPU or GPU resources, and response times may be slower than cloud-based models.

The architecture supports Ollama as a first-class LLM provider alongside commercial options. The frontend does not distinguish between "premium" (cloud) and "free" (local) models in terms of UI or capability. Both are presented as equal options, allowing users to choose based on their preferences for cost, privacy, and performance.

### Platform-Specific Binary Builds and Distribution

Tauri supports cross-platform development, but final binaries are platform-specific: macOS universal (supporting both Apple Silicon and Intel), Windows x86_64, and Linux x86_64 (with optional Wayland support). The kubilitics-ai Go binary must be built and distributed separately for each platform, matching the architecture and os flags of the backend.

The build pipeline produces the following artifacts for each release:
- macOS: a universal Apple Silicon + Intel binary for kubilitics-ai, bundled with the backend binary and frontend assets into an Electron-style .dmg disk image
- Windows: a native x86_64 PE binary for kubilitics-ai, bundled with the backend binary and frontend assets into an .msi or .exe installer
- Linux: x86_64 ELF binaries for kubilitics-ai and backend, packaged into an AppImage (for portable cross-distro usage) and .deb package (for Debian/Ubuntu)

Each platform's build job compiles both kubilitics-backend and kubilitics-ai Go binaries from source using the appropriate target flags. The binaries are then embedded into the Tauri bundle configuration, specified in the externalBin array that tells Tauri which binaries to include in the final distribution.

The CI/CD system performs these builds in parallel: a macOS build agent compiles for Apple silicon and Intel, a Windows agent compiles for Windows, a Linux agent compiles for Linux. The builds complete in parallel and are collected at the final release stage. If any build fails, the entire release is blocked, ensuring that users never receive an incomplete bundle missing the AI binary for their platform.

### Atomic Updates for Multi-Binary System

A critical operational challenge in the dual-sidecar model is updating both binaries atomically. Users may not notice that their Kubilitics application has two processes; even fewer will understand the concept of version compatibility between them. If a backend update ships without a corresponding AI update, or vice versa, the services might fail to communicate or might have incompatible protocols.

The Tauri updater system must treat the backend and AI binaries as a single logical unit for versioning and update purposes. Rather than versioning them separately, the entire bundle (frontend + backend + AI) increments a single version number. When an update is available, the Tauri updater downloads and applies a bundle that includes all three components, ensuring they are consistent.

The updater manifest specifies file hashes for all binaries and assets. When a user's application checks for updates, it receives a manifest with hashes for the current version. If an update is available, the user downloads a bundle containing new versions of all files. The updater verifies the hash of each file before replacing it, ensuring integrity. Only after all files are downloaded and verified does the updater apply the update and request restart.

This approach prevents the "partial update" scenario where a user's desktop is running mismatched versions of the backend and AI. It also provides rollback capability: if a new version proves problematic, users can downgrade to the previous version by re-downloading the previous bundle.

### Configuration Management on Desktop

Desktop users store configuration in local files, not in the cloud. The kubilitics-ai service on desktop must store and retrieve configuration from the local filesystem. This configuration includes the selected LLM provider, encrypted API keys, usage statistics, and AI-specific settings.

The configuration is stored in the user's platform-specific config directory: ~/Library/Application Support/Kubilitics on macOS, %APPDATA%/Kubilitics on Windows, ~/.config/kubilitics on Linux. Within this directory, a subdirectory ai/ contains AI-specific configuration files. API keys are stored encrypted using the native platform keychain APIs (Keychain on macOS, Credential Manager on Windows, Secret Service on Linux), not as plaintext files.

The Tauri application exposes settings UI for configuring AI. Changes to configuration are written to local files and then signaled to the kubilitics-ai service, which reloads configuration dynamically (without requiring a restart). This allows users to change their LLM provider or update an API key in Settings, and have the change take effect within a few seconds, visible in the frontend status indicators.

### Resource Constraints and Memory Management on Desktop

Desktop machines have finite resources. A typical development or operations workstation might have 16 GB of RAM and a quad-core processor. The Kubilitics application (Tauri webview + React + backend + AI) must coexist with many other applications: web browsers, IDEs, messaging clients, etc.

The resource budget for kubilitics-ai on desktop is constrained. The process should not exceed 200 MB of resident memory at idle (with no active investigations or LLM requests). During an active investigation or response from an LLM, memory may spike to 500 MB temporarily, but should return to baseline when the operation completes. CPU usage at idle should be negligible (less than 1%), and during operation should not exceed 10% of a single core (on multi-core systems, this appears as less than 10% of total CPU).

These constraints are achieved through careful resource management in the Go implementation: limiting vector memory to a fixed cache size, implementing garbage collection tuning, and avoiding unnecessary data structures. They are also enforced at the Tauri level: the Tauri process manager can specify memory and CPU limits for child processes (on platforms that support it, such as Linux and macOS with resource limits).

If kubilitics-ai exceeds its resource budget consistently (indicating a memory leak or runaway loop), the ServiceManager can implement a restart. However, rather than restarting silently, it should log the incident and optionally notify the user via a non-blocking notification, so they are aware that something unusual is happening.

### Performance Optimization: Fast Startup and Low Latency

Users expect Kubilitics to launch quickly. On a modern machine, the application should open and connect to a local backend within 3-5 seconds. The inclusion of kubilitics-ai must not significantly degrade this startup time.

Startup time is optimized by ensuring that kubilitics-ai initialization does not block the frontend from becoming interactive. The AI service can perform expensive initialization tasks (loading the vector memory database, warming up LLM provider connections) in the background, after the user can already interact with the application. The frontend detects that AI is still initializing and disables AI features temporarily, then enables them once initialization completes.

LLM request latency is a separate performance concern. When a user types a question in the AI Assistant panel and presses Enter, they expect a response within a few seconds. Cloud-based LLM providers (OpenAI, Anthropic) typically respond within 1-3 seconds for simple queries. kubilitics-ai does not add significant latency beyond the LLM provider's response time, as it is primarily an orchestration layer.

---

## Section 4: Mobile Delivery - Remote Service Architecture

### Constraints of Mobile Operating Systems

Mobile devices running iOS or Android operate under fundamental constraints that make the desktop sidecar model impossible. Neither iOS nor Android allows user-facing applications to spawn arbitrary background processes or services. Mobile apps run in a sandboxed environment with restricted system access. This sandbox is a security feature—it prevents compromised apps from accessing system resources or other apps' data—but it also prevents Kubilitics from using the same architecture on mobile as on desktop.

Moreover, mobile devices have tight resource constraints. A typical smartphone has 4-8 GB of RAM shared among dozens of running apps, and CPU is power-limited to preserve battery life. Running a memory-intensive service like kubilitics-ai locally on a mobile device would drain battery rapidly and degrade overall phone performance, making the feature unusable in practice.

The consequence is that kubilitics-ai must run on a server, not on the mobile device. The mobile application becomes a thin client: it executes the React frontend locally (rendered in a Tauri mobile webview), but all backend services run remotely.

### Server-Hosted AI Architecture for Mobile

When a user installs Kubilitics on their mobile device and opens the application, they go through an onboarding flow that configures a backend connection. The user either selects a pre-existing Kubilitics deployment (a self-hosted instance on their corporate network, or a Kubilitics Cloud instance provided by the vendor), or they enter a custom URL pointing to a Kubilitics deployment. At this point, the user has specified a single base URL, such as https://kubilitics.example.com or https://kubilitics-cloud.vendor.com.

Behind this base URL, both kubilitics-backend and kubilitics-ai are running, deployed either in the same Kubernetes cluster or in a coordinated cloud service. The mobile frontend knows the base URL but does not directly care whether kubilitics-ai is deployed as a sidecar, a Kubernetes pod, or a serverless function; these are implementation details of the server deployment.

The mobile frontend sends HTTP and WebSocket requests to endpoints on the backend URL. For backend API requests (cluster queries, resource management), it connects to the REST API endpoint. For AI requests (assistant queries, investigations), it connects to the AI service endpoint, either directly if kubilitics-ai exposes its own HTTP port, or via a gateway pattern where the backend proxies requests to the AI service.

### Gateway Pattern: Backend as Proxy vs. Direct AI Connection

The mobile architecture must decide between two patterns for connecting to kubilitics-ai: direct connection or backend proxy.

In the **direct connection** pattern, the backend and AI services expose separate endpoints (e.g., https://kubilitics.example.com/api/backend for backend requests, https://kubilitics.example.com/api/ai for AI requests, both possibly behind the same Kubernetes ingress). The frontend is aware of both endpoints and makes requests to each independently. This pattern is simpler to implement and allows the frontend to directly monitor AI health and status.

In the **backend proxy** pattern, only the backend service is exposed externally. AI requests are proxied through the backend: the frontend sends AI requests to the backend (e.g., POST https://kubilitics.example.com/api/proxy/ai), the backend receives the request, forwards it internally to kubilitics-ai via gRPC or local HTTP, receives the response, and forwards the response back to the frontend. This pattern adds a hop (all AI traffic passes through the backend), but it simplifies the network architecture because only one service is exposed to clients.

The recommended pattern is **direct connection** for external clients (including mobile), with the backend serving as a discovery service. The backend's health endpoint includes metadata about the AI service: its address, port, and health status. The mobile frontend reads this metadata during initialization and then communicates with both services directly. This gives the frontend visibility into service health, allows it to implement intelligent retry and fallback logic, and avoids an extra network hop for each AI request.

If the backend deployment runs the AI service as a sidecar on the same pod or process (for simplicity), the backend exposes a route that returns the AI address; if the AI service is separate, the backend returns the distinct address. The frontend logic remains the same: it reads the service discovery metadata and routes requests appropriately.

### Reduced AI Feature Set and Mobile-Specific UI

The mobile UI is constrained by screen real estate. A detailed investigation with multi-step reasoning, diagnostic trees, and historical analysis may render beautifully on a desktop monitor but becomes unwieldy on a 5-inch phone screen. The mobile deployment of Kubilitics implements a reduced set of AI features appropriate to mobile usage patterns.

Mobile users primarily interact with Kubilitics to monitor cluster health at a glance and respond to critical alerts. They are less likely to spend time on deep investigations or exploratory analysis. Accordingly, mobile AI features focus on alert summarization, root cause hints, and quick remediation suggestions. The AI Assistant panel on mobile is simplified: rather than a full chat interface, it shows a button "Ask AI" next to key pieces of information (an alert, an event, a resource), and tapping it opens a modal showing the AI's analysis of that specific thing.

Advanced features like the investigation builder (where users configure complex multi-step investigations) are desktop-only. The mobile UI gracefully disables these features, with tooltips explaining "Available on desktop version." This reduces the scope of testing and validation for mobile AI features, focusing engineering effort on high-value scenarios.

### Streaming Responses and Bandwidth Optimization

Mobile networks are less predictable than wired networks. Response times vary from 100 milliseconds on fast 5G networks to 1-2 seconds on slower LTE. LLM responses can be large (1000+ tokens), which at mobile network speeds might take 5-10 seconds to download in full.

To avoid users staring at a blank screen for several seconds, kubilitics-ai implements streaming responses for AI requests. The backend and AI service communicate with HTTP/2 or gRPC, supporting bidirectional streaming. When an AI request is made, the LLM provider streams the response token-by-token. kubilitics-ai forwards these tokens to the mobile client via server-sent events (SSE) or WebSocket, and the frontend renders them progressively as they arrive.

From the user's perspective, they tap "Ask AI", and after 500-1000 ms the first words of the response appear and continue to accumulate in real-time. This perceived latency is much shorter than waiting for the entire response to arrive before displaying anything, significantly improving user experience.

The backend and AI service can also implement response compression for mobile clients (detecting the client type from HTTP headers and gzipping responses), and it can downsize images and attachments sent to mobile clients to conserve bandwidth. The architecture is flexible: these bandwidth optimizations are applied consistently to all responses, regardless of whether the client is mobile or desktop.

### Push Notifications for AI Alerts

Mobile users expect to be notified of important events even when the application is not open. Kubilitics already implements push notifications for cluster alerts; the AI-integrated mobile version extends this to include AI-generated alerts and insights.

When kubilitics-ai performs a background investigation (perhaps triggered by a scheduled rule like "check pod restart rates every 5 minutes"), it can generate alerts (e.g., "Pod xyz is restarting frequently, likely due to memory limit being exceeded"). These AI-generated alerts are sent to the backend's notification service, which routes them to connected mobile clients.

Mobile clients receive push notifications through the native push service (Apple Push Notification service for iOS, Google Cloud Messaging or Firebase Cloud Messaging for Android). The notification displays a brief alert on the lock screen or notification center (e.g., "Pod xyz restarting frequently"). When the user taps the notification, the Kubilitics app opens and navigates to a detailed view showing the AI's analysis and recommendations.

This integration closes a feedback loop: mobile users, even when not actively monitoring the app, receive timely AI-generated insights about cluster health. The notification frequency is rate-limited to avoid notification spam.

### Offline Caching and Progressive Sync

Mobile users may operate in environments with intermittent connectivity—on a commute, in a building with poor signal, on an airplane. The mobile application implements offline caching to provide some level of functionality even without active network connectivity.

Recent AI insights and investigations are cached locally on the device. If the user closes the app and reopens it later without network connectivity, they can still review the cached AI analysis from the last sync. This cached data is not real-time (it may be hours old), but it provides context and reduces the feeling of helplessness when offline.

When connectivity is restored, the mobile app performs a background sync: it fetches new data from the backend and AI services and updates its local cache. The frontend detects when a sync is in progress and disables AI-specific features until the sync completes, ensuring that users are not working with stale information.

The cached data is stored in the mobile app's local storage (typically an SQLite database) using the same encryption as the browser's localStorage or the OS's secure storage APIs. API keys and sensitive configuration are never cached locally.

---

## Section 5: In-Cluster Delivery - Kubernetes Helm Architecture

### Extending the Existing Helm Chart

Kubilitics' Helm chart currently deploys a set of Kubernetes resources that provision the backend API server (as a Deployment), the frontend (as a static website served by nginx or bundled with the backend), and associated infrastructure (Services, ConfigMaps, Ingress). The chart is parameterized: users can customize image versions, resource limits, replica counts, and persistent storage through Helm values.

The addition of kubilitics-ai to the in-cluster deployment begins with extending the existing Helm chart to include new resource templates. Rather than modifying the existing backend Deployment, the chart gains a new Deployment template specifically for kubilitics-ai. This separation maintains clarity: the backend is responsible for cluster API and monitoring, while the AI service is responsible for reasoning and LLM orchestration. They can be deployed, scaled, and monitored independently.

The chart structure gains a new subdirectory or section: `templates/ai/` containing Kubernetes resource definitions for the AI service. This includes:
- A Deployment managing AI pod replicas
- A Service exposing the AI service within the cluster
- A ConfigMap for non-sensitive AI configuration
- A ServiceAccount for RBAC
- Optional PersistentVolumeClaim for vector memory storage
- Optionally, a separate Deployment and Service for auxiliary components like ChromaDB or Qdrant

The Helm values file gains new sections: `ai.enabled`, `ai.replicas`, `ai.image.repository`, `ai.image.tag`, `ai.resources.requests` and `ai.resources.limits`, `ai.llmProvider`, and `ai.apiKeySecret`. These values allow operators to enable/disable AI, set resource constraints, specify which LLM provider to use, and reference a Kubernetes Secret containing API keys.

### kubilitics-ai Deployment, Service, and Networking

The kubilitics-ai Deployment specification resembles the backend Deployment but with specific customizations for AI workloads. The pod template specifies the kubilitics-ai container image, specifies resource requests (a recommended minimum of 256Mi memory and 0.5 CPU) and limits (a recommended maximum of 1Gi memory and 2 CPU), and mounts configuration and secrets.

The pod also mounts persistent storage if required: a PersistentVolumeClaim for vector memory (if the implementation uses ChromaDB, Qdrant, or Pinecone) or a local sqlite database file. The path to this storage is passed to the container as an environment variable.

The kubilitics-ai Service is a ClusterIP service (internal to the cluster) exposing the gRPC and HTTP endpoints of the AI pods. The Service name is something like `kubilitics-ai` and can be referenced by the backend pods using the Kubernetes DNS name `kubilitics-ai:8081` (assuming 8081 is the port). This naming pattern is documented in the chart's README so operators understand how the services discover each other.

The Service does not have an external ingress. The AI service is not meant to be accessed directly by external clients; only the backend and other in-cluster services access it. If operators wish to expose AI endpoints externally (for other services to call kubilitics-ai directly), they can create additional Ingress or Service resources in their own cluster, but the chart does not provide this by default.

The backend Deployment's pod specification is updated to include an init container or startup script that discovers the kubilitics-ai Service address. The backend's configuration specifies the AI service endpoint as `kubilitics-ai:8081` (or the full internal DNS name), and the backend uses this address to establish gRPC or HTTP connections to the AI service.

### ConfigMap and Configuration Management

The kubilitics-ai Helm chart includes a ConfigMap that stores non-sensitive configuration. This ConfigMap includes:
- The LLM provider selection (openai, anthropic, ollama, azure, etc.)
- Feature flags indicating which AI features are enabled (investigation, assistant, predictions, etc.)
- Reasoning engine parameters (max steps, max tokens, temperature, etc.)
- Vector memory settings (cache size, embedding model, etc.)
- Optional Ollama server address (if using local models)

The ConfigMap is mounted into the AI pod as a file or as environment variables, and the kubilitics-ai service reads it at startup. Changes to the ConfigMap require restarting the pod for the changes to take effect (Kubernetes does not auto-reload ConfigMaps). To support dynamic configuration updates without pod restarts, the AI service can implement a sidecar pattern where a configuration reload controller watches the ConfigMap and signals the AI service to reload, but this is an optional advanced pattern.

### Secret Management for API Keys

LLM API keys (OpenAI, Anthropic, etc.) are sensitive data and must be stored as Kubernetes Secrets, not ConfigMaps. The Helm chart references a Secret that contains these keys, without needing to define the Secret itself in the chart. Operators are responsible for creating the Secret using their own secret management system (manual kubectl, a Kubernetes Secrets operator, HashiCorp Vault, etc.).

The Secret has a known schema: it contains keys like `openai-api-key`, `anthropic-api-key`, `ollama-url`, etc. The backend and AI services mount this Secret as environment variables or files, reading the applicable keys based on the configured LLM provider.

Example flow: An operator deploys Kubilitics using Helm. In the Helm values, they set `ai.llmProvider: openai` and `ai.apiKeySecret: kubilitics-ai-secrets`. Before deploying the Helm chart, they create a Secret: `kubectl create secret generic kubilitics-ai-secrets --from-literal=openai-api-key=sk-xxxx`. Then they run `helm install kubilitics ./kubilitics-helm -f values.yaml`, and the chart mounts the Secret into the AI pod. The AI pod reads the OpenAI API key from the Secret and uses it to authenticate with OpenAI.

This pattern decouples the Helm chart from specific secrets, allowing the chart to be committed to version control without exposing credentials.

### ServiceAccount and RBAC

The kubilitics-ai pod runs under a dedicated ServiceAccount, separate from the backend's ServiceAccount. This applies the principle of least privilege: if the AI container is compromised, the attacker has limited capabilities within the cluster.

The AI ServiceAccount has minimal RBAC permissions. At a minimum, it might have read access to ConfigMaps and Secrets that store its configuration, and create/read access to PersistentVolumes for its vector memory store. It does not have permission to create, delete, or modify Pods, Deployments, or other cluster resources. These permissions are reserved for the backend, which directly manages cluster operations on behalf of users.

If the AI service needs to query the Kubernetes API (e.g., to fetch metadata about running pods for context in investigations), it can request read-only permissions to the API group, constrained to specific resource types (pods, services, events) and specific verbs (get, list, watch). These permissions are explicitly specified in a Role and RoleBinding.

### Shared Storage and Persistence for AI

The kubilitics-ai service maintains state: vector memory indexes, cached investigation results, session history. This state must persist across pod restarts. The Helm chart provisions a PersistentVolumeClaim for AI storage.

The PVC is requested in the AI pod specification. The size defaults to 10Gi (sufficient for a vector memory index of moderate size), but operators can customize this in Helm values. The PVC is mounted at a specific path (e.g., /data/ai) that the kubilitics-ai binary expects.

Storage class selection is configurable: operators can specify which StorageClass the PVC requests, allowing them to use fast SSDs for performance-sensitive workloads or cheaper network storage for bulk data. The chart does not mandate a specific storage class, allowing it to work in various cluster environments.

If multiple replicas of kubilitics-ai are deployed (e.g., two pods for high availability), they could share the same PVC (if the underlying storage supports ReadWriteMany access mode), or they could each have their own PVC. If they share a PVC, care must be taken to avoid concurrent writes to the same SQLite database, which SQLite does not support well in a distributed setting. A more robust approach is for each AI pod replica to have its own PVC, and for a separate "primary" pod (running as a StatefulSet) to maintain the authoritative vector memory index that replicas read from.

Alternatively, the AI service can offload vector memory to a separate managed service (Pinecone, Weaviate Cloud, or a self-hosted Qdrant container) that supports distributed access. In this case, multiple AI pod replicas can share the same vector memory service without needing a shared PVC.

### Optional: Auxiliary Components (ChromaDB, Qdrant)

Some implementations of kubilitics-ai may use a dedicated vector database like ChromaDB or Qdrant for vector memory storage. The Helm chart optionally includes subchart definitions for these services. When operators enable them (via Helm values like `vectorDatabase.enabled: true`, `vectorDatabase.provider: qdrant`), the Helm chart renders additional Deployment and Service resources for the vector database.

These are optional because many deployments might choose to use a managed vector database service (Pinecone, Weaviate Cloud) instead, or might use an embedded vector database within the AI service itself (avoiding the need for a separate service). The Helm chart's design accommodates all these choices through parameterization.

If a local vector database is deployed as part of the Kubilitics cluster, it gets the same treatment as the backend and AI services: dedicated Deployment, Service, PVC for persistent data, resource limits, and monitoring. The backend and AI services can then reference the vector database Service name to connect to it.

### Horizontal Pod Autoscaling for AI

In-cluster deployments may experience varying load on the AI service depending on time of day, cluster size, and user investigation patterns. Kubernetes HPA (Horizontal Pod Autoscaler) allows the AI Deployment to automatically increase or decrease the number of replicas based on observed metrics.

The Helm chart optionally configures an HPA for the AI Deployment, setting scaling policies such as:
- Target CPU utilization of 70% (scale up if average CPU across AI pods exceeds 70%, scale down if it drops below 30%)
- Target memory utilization of 75%
- Minimum replicas of 1, maximum replicas of 5

Operators can customize these policies in Helm values to match their operational preferences. With HPA configured, the cluster automatically spawns additional AI replicas when load increases (e.g., many users running investigations simultaneously) and terminates replicas when load decreases, optimizing resource utilization and cost.

### Network Policies and Egress Control

Enterprise deployments often apply Kubernetes NetworkPolicies to control traffic flows within the cluster. A NetworkPolicy for kubilitics-ai might specify:
- Ingress: Allow traffic from kubilitics-backend pods (port 8081)
- Egress: Allow traffic to kubilitics-backend pods (for backend queries), allow DNS (port 53), allow HTTPS traffic to external LLM provider APIs (port 443 to openai.com, anthropic.com, etc.), deny all other egress

This policy prevents the AI service from making unexpected outbound connections and contains potential security breaches. If an attacker compromises the AI container, they cannot immediately pivot to attack other services in the cluster; the network policy blocks such lateral movement.

The Helm chart can optionally render NetworkPolicy resources alongside the AI Deployment, with configurable ingress and egress rules. For simplicity, operators can disable NetworkPolicy in their Helm values if their cluster does not use it.

### Monitoring and Observability Integration

The kubilitics-ai pod exposes a `/metrics` endpoint (Prometheus metrics format) that reports operational metrics: request latency, error rates, LLM API latency, vector memory size, cache hit rates, etc. The Helm chart optionally configures a ServiceMonitor resource (if the cluster has Prometheus Operator installed) that scrapes these metrics.

With metrics scraping enabled, operators can build Grafana dashboards showing AI service health, performance, and cost (token count, API calls). They can set Prometheus alerts to fire if the AI service becomes unhealthy, if API errors spike, or if latency exceeds a threshold.

This observability integration mirrors the existing monitoring setup for the backend service, providing operators with a consistent view of all Kubilitics components.

---

## Section 6: The Zero-to-AI User Journey

### Step-by-Step Feature Activation

The design principle of graceful degradation requires that Kubilitics be fully functional without any AI configuration. The user journey for adding AI capabilities must be optional, non-blocking, and clearly explained at every step.

**Step 1: Initial Installation and Launch**

A new user installs Kubilitics (desktop or mobile, or navigates to a Kubilitics in-cluster deployment). Upon launch, the application connects to a cluster and displays all available features: real-time monitoring, logs, events, resource management, etc. There is no indication that AI features are missing; the user experiences a complete, functional application. Optionally, a non-intrusive tooltip or info banner in the Settings menu might mention "AI features available" to inform users that an optional feature exists, but the absence of this banner does not prevent any core functionality.

**Step 2: User Discovers AI Settings**

When the user navigates to Settings, a new section appears: "AI Configuration" or "AI Assistant". This section displays the current AI status: "Not configured" or "AI features disabled" depending on the implementation. The UI does not show an error; it shows a clear, friendly message: "AI features help you investigate cluster issues, understand error logs, and get recommendations. Want to enable AI?"

A large button labeled "Configure AI" or "Enable AI" invites the user to proceed. Clicking this button opens the AI configuration wizard.

**Step 3: LLM Provider Selection**

The AI configuration wizard presents a list of supported LLM providers, each with a brief explanation and icon:
- OpenAI (ChatGPT): "Requires API key from OpenAI. Fast, capable model."
- Anthropic (Claude): "Requires API key from Anthropic. Excellent reasoning."
- Ollama (Local): "Run open-source models on your machine. No API key required. Privacy-focused."
- Azure OpenAI: "If your organization uses Azure. Requires configuration."
- Other providers: as they are added

The wizard allows the user to select one provider. If the user selects OpenAI, the UI guides them to openai.com, explains how to create an API key, and provides a copy-paste area to paste the key. The UI validates that the key format looks correct (checking the prefix, e.g., sk- for OpenAI keys) before accepting it.

If the user selects Ollama, the wizard checks whether Ollama is running locally (by attempting to connect to localhost:11434). If Ollama is found, the user selects which local model to use (the wizard queries Ollama to fetch the list of installed models). If Ollama is not found, the wizard shows instructions for installing Ollama and points the user to the Ollama download page.

**Step 4: API Key Storage and Validation**

Once the user has entered credentials or configured a provider, the application validates them. For OpenAI/Anthropic/etc., this means making a test API call (e.g., "What is Kubernetes?") and checking that the response is successful. If the key is invalid or the provider is unreachable, the wizard displays a clear error: "API key is invalid. Please check your key and try again." The user is not blamed; the error message is specific enough to diagnose the issue.

Once validation succeeds, the API key is stored securely using the platform-specific mechanism (Keychain on macOS, Credential Manager on Windows, Secret Service on Linux, or Kubernetes Secrets in-cluster). The key is never stored as plaintext in logs or configuration files.

**Step 5: AI Features Activate**

Once configuration is complete, the user returns to the main application interface. The UI now displays AI-related buttons and features throughout the application. In the Logs viewer, a new button appears: "Ask AI" next to each log entry. In the Events viewer, an icon appears indicating that the AI can analyze events. The Settings panel changes: the AI section now displays "AI configured: OpenAI (ChatGPT)" with buttons to change the configuration or disable AI.

The frontend confirms activation by performing a health check to the kubilitics-ai service. If the service is ready, the UI reflects "AI ready". If the service is still initializing, the UI shows "AI initializing..." and enables the features once ready.

**Step 6: First AI Interaction**

The user clicks "Ask AI" next to a log entry about a pod crash. A modal window or panel opens, showing the log entry and a text area prompting "What would you like to know about this?". The user types a question: "Why did this pod crash?" They press Enter.

The frontend sends the request to kubilitics-ai. The service retrieves the full log context, queries the Kubernetes API (via the backend) for pod metadata and recent events, formulates a prompt to the LLM provider including all this context, and streams the response back. The user sees the response appear token-by-token: "This pod was evicted due to memory pressure. The pod's memory limit is 256 MiB, but it was consuming 350 MiB. Kubernetes evicted the pod to free resources for other workloads. Recommendation: increase the memory limit for this pod or optimize the application to use less memory."

The user reads the analysis and learns something about their cluster. They might click "View pod details" or "Increase memory limit" (which the UI provides as quick action buttons), or they might close the modal and move on. Critically, they have experienced the AI feature working without friction, and they understand its value.

**Step 7: Progressive Feature Disclosure**

As the user becomes comfortable with basic AI features (asking questions about logs and events), the UI progressively discloses more advanced features. After the user has asked 3-5 questions, the UI might suggest "Try the AI Assistant panel for interactive investigations" or "Use the investigation builder to automate multi-step diagnostics". These suggestions are soft promotions, not mandatory upgrades. Users can ignore them and continue using basic AI features indefinitely.

Over time, users who engage with AI features extensively may unlock advanced capabilities: the ability to schedule recurring investigations, create custom investigation templates, integrate AI insights into their monitoring alerting, etc. The progressive disclosure approach ensures that casual users are not overwhelmed by feature complexity, while power users have access to advanced capabilities.

### How the Frontend Discovers AI Availability

The frontend implements a multi-layered approach to discovering whether kubilitics-ai is available and properly configured.

**Layer 1: Backend Health Response**

At application startup and periodically thereafter, the frontend queries the backend's `/health` endpoint. The response includes a field indicating AI availability: `{ "status": "healthy", "ai": { "available": true, "healthy": true, "provider": "openai" } }`. The frontend reads this field and updates its internal state.

**Layer 2: Direct AI Health Check**

In addition, if the frontend knows the address of the kubilitics-ai service (from configuration), it performs a direct HTTP request to the AI service's `/health` endpoint. This check times out quickly (1-2 seconds) if the service is unreachable, and returns detailed status if reachable: `{ "status": "ready", "provider": "openai", "llmConnected": true, "vectorMemory": "healthy" }`.

**Layer 3: Feature Detection**

As the user navigates through the application, the frontend attempts to render AI-related UI elements conditionally. When the Logs viewer loads, it checks the current AI availability status. If AI is available, it renders an "Ask AI" button next to each log. If AI is unavailable (due to misconfiguration, service error, or user choice to disable it), the button is absent, and no space is reserved for it (the UI does not show a grayed-out button).

**Layer 4: User Consent and Privacy**

Before any cluster data is sent to kubilitics-ai (and potentially forwarded to an external LLM provider), the frontend shows a one-time privacy notice: "AI features use your cluster data to provide insights. Data may be sent to [LLM Provider]. You can disable AI features in Settings." The user acknowledges this notice by clicking "I understand", and the frontend sets a flag in local storage so the notice is not shown again (until AI configuration changes).

This notice respects user privacy and informs users about data flows, especially important for enterprise deployments where data residency may be a compliance concern.

### Graceful Handling of AI Unavailability

Throughout the user journey, the frontend must handle scenarios where AI becomes unavailable after configuration:
- The user configured AI with an OpenAI API key, but the key expires or reaches usage limit
- The kubilitics-ai service crashes or becomes unresponsive
- The LLM provider becomes unreachable (network issue, provider downtime)
- The user is offline (no network connectivity)

In each scenario, the frontend implements graceful degradation. If the user clicks "Ask AI" and the service is unavailable, instead of showing an error or crashing, the frontend displays a friendly message: "AI features are currently unavailable. This might be because of a network issue, an invalid API key, or a temporary service interruption. Try again in a moment, or check your AI configuration in Settings." The message is not a hard error; the user can dismiss it and continue using the rest of the application.

The frontend also implements automatic retry logic with exponential backoff. If the first request to AI fails, the frontend retries a second time after 2 seconds, then again after 4 seconds. If all retries fail, the user-facing error is shown.

For long-lived features like the AI Assistant panel (a persistent sidebar that accepts user questions), the frontend shows a "Connecting..." state and continues attempting to establish the connection. Once the connection is established, the panel transitions to an "Active" state. If the connection is lost mid-session, the panel shows "Disconnected" and provides a "Reconnect" button. Critically, closing the AI Assistant panel and reopening the main application view continues to work fully.

---

## Section 7: Binary & Package Architecture

### Go Module Structure and Build Organization

The kubilitics codebase is organized as a monorepo or multi-module structure. The existing modules are:
- `kubilitics-backend`: Go module containing the backend API server
- `kubilitics-desktop`: Tauri project containing the frontend (React) and Tauri runtime configuration
- `kubilitics-frontend`: React/TypeScript frontend (possibly a git submodule or separate repo)
- `kubilitics-mobile`: Tauri mobile project
- `kubilitics-website`: Marketing website (separate project)

The addition of kubilitics-ai adds a new module:
- `kubilitics-ai`: Go module containing the AI service, MCP server, reasoning engine, and LLM provider adapters

The kubilitics-ai module has its own go.mod file, dependency tree, version tags, and CI/CD pipeline. It can be versioned independently from the backend, though releases are typically coordinated so that backend and AI versions are compatible.

Within kubilitics-ai, the internal structure is organized by responsibility:
- `cmd/`: Entry point for the kubilitics-ai binary
- `pkg/mcp/`: MCP server implementation
- `pkg/reasoning/`: Reasoning engine
- `pkg/providers/`: LLM provider adapters (openai, anthropic, ollama, etc.)
- `pkg/vector/`: Vector memory and embeddings
- `pkg/safety/`: Safety and policy filtering
- `pkg/analytics/`: Analytics engine
- `pkg/grpc/`: gRPC service definitions and implementation for communication with backend

### Build Pipeline: Parallel Compilation for Multiple Targets

The CI/CD system (GitHub Actions, GitLab CI, or equivalent) implements a build matrix that compiles kubilitics-ai for multiple platforms in parallel. For each commit to the main branch (or on a release tag), the CI/CD system spins up three build agents:
- macOS agent (with Apple Silicon and Intel cross-compilation tools)
- Windows agent (with Windows SDK)
- Linux agent (with musl libc for static linking)

Each agent compiles the kubilitics-ai Go binary for its target platform(s). The macOS agent produces a universal binary supporting both Apple Silicon and Intel. The Windows agent produces a 64-bit PE binary. The Linux agent produces a static ELF binary (using musl) and a glibc-linked binary for compatibility with various Linux distributions.

The compilation also happens for kubilitics-backend in parallel, though this document focuses on AI. The backend and AI binaries are built independently, allowing them to be updated on separate schedules if needed.

Once compilation completes, the binaries are uploaded to a build artifact repository (or the CI/CD system's artifact store). The build manifest includes the binary name, hash, platform, and architecture.

### CI/CD Integration and Release Artifacts

The release process orchestrates the build, test, and packaging of Kubilitics artifacts. When a release tag (e.g., v1.2.0) is pushed to the repository, the CI/CD system:

1. Triggers the backend build pipeline (compiling kubilitics-backend for all platforms)
2. Triggers the AI build pipeline (compiling kubilitics-ai for all platforms)
3. Triggers the frontend build pipeline (transpiling React to JavaScript bundles)
4. Waits for all three pipelines to complete successfully
5. Assembles release artifacts: for desktop, it combines backend binary, AI binary, and frontend assets into a Tauri bundle; for mobile, it creates mobile-specific bundles; for in-cluster, it builds Docker images
6. Signs all binaries and images with cryptographic signatures
7. Publishes release artifacts to distribution channels (GitHub Releases, Docker registry, etc.)

If any pipeline fails (compilation error, test failure, security scan failure), the entire release is blocked. Engineers must fix the issue and retry. This ensures that users never receive an incomplete or inconsistent release.

### Docker Images for In-Cluster Deployment

For Kubernetes deployments, kubilitics is distributed as Docker images. The build system produces separate images:
- `kubilitics-backend:v1.2.0`: Contains the backend API server and optionally the frontend static assets
- `kubilitics-ai:v1.2.0`: Contains the AI service, reasoning engine, and dependencies (ChromaDB/Qdrant client libraries, embedding model, etc.)

Each image is as small as possible to reduce storage requirements and deployment time. The kubilitics-ai image is particularly optimized to avoid unnecessary dependencies. For example, if kubilitics-ai does not need to parse Kubernetes manifests (the backend handles that), it does not include the Kubernetes Go client library.

Multi-stage Docker builds are used to produce lean final images. The builder stage includes all development tools (Go compiler, dependencies, test tools). The final stage includes only the compiled binary and minimal runtime dependencies. Images are typically in the 50-150 MB range for the backend and 100-300 MB for AI (larger due to embedding models and vector database client libraries).

Images are versioned with tags corresponding to release versions (v1.2.0) and also with a `latest` tag for convenience. Images are signed with cryptographic signatures to ensure authenticity. Container registries (Docker Hub, ECR, GCR) automatically scan images for known vulnerabilities and report any issues.

### Binary Bundling in Tauri Externalbin Array

The Tauri configuration file (tauri.conf.json or equivalent) specifies which external binaries to bundle in the final application. For Kubilitics, this array includes:
- kubilitics-backend: the backend API server binary
- kubilitics-ai: the AI service binary

Each entry specifies the binary name, the platform and architecture it targets, and where to find the precompiled binary (typically in a releases directory or fetched from a CI/CD artifact store).

During the Tauri build process, the bundler collects these binaries from the artifact store, verifies their signatures, and copies them into the final application bundle (DMG for macOS, MSI/EXE for Windows, AppImage/DEB for Linux).

The externalBin array allows Tauri to embed large binaries (Go binaries are typically 10-30 MB each) without bloating the Tauri runtime or frontend assets. The bundler produces an application package that is larger than a frontend-only app but smaller than bundling a separate installation of the backend.

### Version Compatibility Matrix

The Kubilitics platform involves three major components, each with its own version: frontend, backend, and AI. A specific version of the frontend might require a specific version of the backend, and both might require a specific version of the AI.

The CI/CD system and release documentation maintain a compatibility matrix:
```
Frontend v1.2.0 <-> Backend v1.2.0 <-> AI v1.2.0  [All compatible]
Frontend v1.2.0 <-> Backend v1.1.9 <-> AI v1.1.9  [Frontend-Backend compatible, AI compatible]
Frontend v1.3.0 <-> Backend v1.3.0 <-> AI v1.2.0  [Not recommended - AI missing features]
```

The matrix documents which component versions are compatible with which others. The Tauri updater checks this matrix before applying updates, ensuring users never receive an incompatible bundle. If a component version is incompatible with others, the update is blocked with a message: "A new version of Kubilitics is available but requires an updated system configuration. Please contact support."

### Release Cadence and Independent Updates

Ideally, backend, frontend, and AI release together on a synchronized cadence (e.g., every 2 weeks). However, the architecture accommodates independent updates for critical fixes. If a security vulnerability is discovered in the backend, a patch can be released for backend without waiting for frontend or AI changes. In this case, the release bundle includes the patched backend with the previous frontend and AI versions, provided the compatibility matrix indicates they are compatible.

The Tauri updater system supports rolling out updates to different components on independent schedules. Users might receive a backend update on Monday and an AI feature update on Wednesday, with the frontend unchanged. Each update is applied atomically: all files are downloaded, verified, and installed together, so users never experience a partially-updated state.

For in-cluster deployments using Helm, operators can similarly update backend and AI independently by specifying different image versions in their Helm values. The Kubilitics architecture supports this flexibility while maintaining clear compatibility guidance.

---

## Section 8: Security & Trust Architecture for AI Delivery

### API Key Storage and Encryption

API keys for LLM providers are the crown jewels of the AI integration. A compromised API key allows an attacker to:
- Spend unlimited money on LLM API calls (leading to surprising bills)
- Access the user's organization's cluster context if the key is for a corporate account
- Potentially escalate to access other services if the API key is linked to a corporate identity

API key security is therefore paramount. Kubilitics implements defense in depth across multiple layers.

**Desktop Key Storage**

On desktop, API keys are stored in the native platform keychain:
- **macOS**: Keychain Services, accessible only to the authenticated user and programs they authorize
- **Windows**: Windows Credential Manager, with similar protections
- **Linux**: Secret Service (DBus-backed), or the user's gpg-agent for additional protection

The Tauri runtime interfaces with these native mechanisms through Rust crates that invoke OS-level APIs. The flow is: user enters API key in the Settings UI → Tauri-owned code calls the secure storage API → OS encrypts the key at rest and protects access with user credentials → only the Kubilitics process (running under the user) can retrieve the key.

The key is never written to disk as plaintext. It is never logged. It is never transmitted over the network. When the backend or AI service needs the key, the Tauri frontend retrieves it from the keychain and passes it (securely) to the service at runtime.

**Kubernetes Secret Storage**

In-cluster deployments store API keys as Kubernetes Secrets. The schema is:
```
kind: Secret
metadata:
  name: kubilitics-ai-secrets
type: Opaque
data:
  openai-api-key: <base64-encoded-key>
  anthropic-api-key: <base64-encoded-key>
```

Kubernetes Secrets are encrypted at rest by default (with a cluster-level encryption key). Operators can enhance this by integrating with external secret management systems (HashiCorp Vault, AWS Secrets Manager, etc.) that provide additional layers of encryption and audit logging.

The secret is mounted into the AI pod as environment variables, not as files. Environment variables are less likely to be accidentally exposed in logs or copied to temporary files. The AI service reads the key from the environment at startup.

**Mobile and Web Client**

Mobile and web clients do not store API keys locally. Instead, they rely on the backend to authenticate with LLM providers. The backend securely stores API keys and makes outbound calls to LLM providers on behalf of clients. Clients never see the raw API key; they simply request that the backend process their AI query.

This approach is essential for web and mobile clients where users cannot trust the client environment (a web page running in a browser, a mobile app on a shared device).

### Network Security: Sanitization and Response Filtering

When the frontend requests AI analysis, the request may include sensitive cluster data (pod names, container image digests, log messages containing user data). The backend and AI service must be careful about what is sent to external LLM providers.

**Data Minimization**

The architecture implements data minimization: only the minimum necessary information is included in requests to external LLM providers. For example, if the user asks "Why is pod xyz failing?", the request includes the pod name, its recent events, recent logs, and container image names—but not the full pod spec (which might contain secrets, API keys, or other sensitive config) and not information about unrelated pods.

The backend implements a policy: each request type (analyze logs, investigate pod failure, etc.) has a corresponding data extraction function that retrieves only the relevant data for that analysis type. Engineers review this function to ensure it does not inadvertently include sensitive information.

**Response Sanitization**

When an LLM responds to a query, the response may include generic suggestions that are inappropriate for the context, or it may contain text patterns that should be filtered. The AI service implements response sanitization logic:
- Remove any API keys or credentials from the response (in case the LLM accidentally repeated them from its training data)
- Remove any email addresses or personal information unless explicitly relevant
- Flag any recommendations that would delete or modify resources, requiring user confirmation before execution

The sanitization logic is not foolproof (an advanced attacker could potentially craft an LLM response that bypasses filters), but it provides a reasonable layer of defense against common mistakes.

**Content Security Policy for Frontend**

The frontend implements Content Security Policy (CSP) headers to prevent injection attacks. Even if an LLM response contains malicious JavaScript, the browser will not execute it due to CSP restrictions.

### Data Residency and Compliance

For enterprise customers, data residency (ensuring that sensitive cluster data is not sent outside a specific geographic region or stays within the organization's network) is a critical requirement. The architecture accommodates this through the following mechanisms:

**Local-Only Processing**

Users can choose the Ollama provider, which processes all requests locally without sending data to external services. This satisfies the strongest data residency requirements.

**Private Cloud Deployment**

Organizations can deploy Kubilitics (including kubilitics-ai) within their own Kubernetes cluster, entirely on-premises. All cluster data and AI interactions remain within the organization's network. The only external connection is from the Kubilitics cluster to the LLM provider's API (e.g., OpenAI), and even this can be routed through a corporate proxy if required.

**Data Handling Agreements**

For organizations using cloud-hosted LLM providers, Kubilitics publishes a Data Handling addendum documenting:
- What data is sent to the LLM provider (log excerpts, event data, pod metadata)
- What data is not sent (secrets, full pod manifests)
- How long data is retained by the LLM provider (typically until API response is complete)
- Compliance certifications (GDPR, HIPAA, SOC 2, etc., depending on the provider)

Organizations can review this addendum and make an informed decision about whether using a specific LLM provider aligns with their data residency requirements.

### Audit Trails and Provenance

Every AI action is logged with full provenance: who requested it, what context was included, what LLM provider answered, what response was returned, and any actions taken based on that response.

The audit trail is stored in a structured format (JSON logs or a database) that can be queried to answer questions like:
- "What AI-generated recommendations were made in the past 24 hours?"
- "What cluster data was sent to OpenAI in the past week?"
- "Who triggered this investigation?"

These audit trails are essential for compliance audits and for investigating security incidents. If an AI-generated recommendation caused an outage or data loss, the audit trail allows engineers to reconstruct exactly what happened and whether any user data was inadvertently exposed.

### RBAC Integration: AI Respects Cluster User Permissions

In a shared Kubernetes cluster, different users have different permissions. A developer might be able to view logs and restart pods in their namespace, but not modify RBAC, delete persistent data, or access other namespaces.

When a user requests an AI investigation, the AI service respects the user's RBAC permissions from the Kubernetes cluster. The backend, which knows the user's identity and permissions, provides this context to the AI service. The AI service uses this context to filter available cluster data (only showing the user data they are authorized to see) and to constrain recommendations (not recommending actions the user is not authorized to perform).

For example, if a developer asks "Why is pod X failing?", but they do not have permission to read events in that namespace, the AI service does not retrieve those events. Instead, it might respond: "I cannot access detailed information about that pod due to your permissions. Ask your cluster administrator for access if you need deeper investigation."

This ensures that AI features do not circumvent the cluster's RBAC model.

### Rate Limiting and Cost Control

Unbounded use of external LLM APIs can lead to runaway costs. A user who accidentally leaves a script repeatedly asking the AI for analysis might burn through a month's API budget in an hour.

The architecture implements rate limiting at multiple levels:
- **Per-user rate limiting**: Each user is allowed up to N API requests per day or per hour
- **Per-organization rate limiting**: Each organization is allowed up to M API requests per month
- **Per-request budget**: Each AI investigation has a token budget; if the investigation would exceed the budget, it is rejected

Rate limits are configurable in the AI service's configuration. An operator or admin can adjust limits based on their organization's usage patterns and budget.

When a user hits a rate limit, they receive a clear message: "You have used your daily AI investigation quota. Your quota resets tomorrow at 5 PM UTC." This message is informational, not punitive. The user can contact an admin to request an increase if they regularly need more.

### Content Filtering and Output Validation

Before AI responses are displayed to users or used to drive automated actions, they are validated:
- **Format validation**: The response should be valid JSON or text, not corrupted or truncated
- **Content validation**: The response should not contain patterns indicative of prompt injection or abuse (e.g., repeated special characters, attempts to escape sanitization)
- **Relevance validation**: The response should actually address the user's query (basic sanity check against LLM hallucinations)

If validation fails, the response is rejected and the user is notified: "The AI generated an invalid or incomplete response. Please try again."

---

## Section 9: Performance & Resource Budget

### Desktop Resource Constraints

Desktop users expect Kubilitics to be a lightweight, responsive application that does not consume excessive resources. The resource budgets for kubilitics-ai on desktop are therefore stringent.

**Memory Budget**

At idle (when no AI operations are in progress), kubilitics-ai should consume no more than 200 MB of resident set size (RSS). This includes the Go runtime, loaded libraries, and cached data structures. Achieving this requires careful attention to memory allocation:
- Avoid loading entire LLM models into memory (streaming responses from external providers instead)
- Limit the vector memory cache to a fixed size (e.g., 50 MB)
- Use object pooling or lazy loading for frequently-allocated objects
- Monitor and profile memory usage continuously with pprof

During an active investigation or LLM response, memory may spike to 500 MB temporarily as the service maintains in-flight requests and buffers response data. However, once the operation completes, memory should return to baseline. If memory remains elevated after an operation completes, it indicates a leak.

**CPU Budget**

At idle, kubilitics-ai should consume negligible CPU (<1%). During operation, it should not consume more than 10% of a single CPU core (on multi-core systems, this might represent <3% of total CPU). Investigations should complete within a target latency (see below) rather than trading latency for lower CPU usage.

Achieving this budget requires:
- Avoiding busy-wait loops (using event-driven I/O and channels instead)
- Minimizing goroutine overhead (launching new goroutines only when necessary)
- Caching computation results to avoid redundant calculations

**Battery Impact**

On laptops, resource consumption directly impacts battery life. Background processes that wake the CPU frequently or consume sustained power drain the battery faster. The kubilitics-ai service should minimize wakeups and power consumption when idle.

### In-Cluster Resource Budgets

In Kubernetes deployments, resource budgets are specified in the Pod specification as requests and limits. The recommended defaults for kubilitics-ai are:
- **Memory request**: 256 Mi (the minimum amount guaranteed to the pod)
- **Memory limit**: 1 Gi (the maximum the pod can consume before being evicted)
- **CPU request**: 0.5 CPU (half a core)
- **CPU limit**: 2 CPU (upper bound)

These budgets are tuned based on expected usage:
- A small cluster (10-50 nodes) being monitored by a single kubilitics-ai replica: requests/limits at the conservative end
- A large cluster (100+ nodes) with heavy investigation usage: multiple replicas, higher limits

Operators can adjust these values based on their specific requirements. The Helm chart makes these adjustable via values, allowing operators to optimize for their environment.

### LLM Latency Budgets

LLM providers have variable latency depending on model, load, and network conditions. The architecture must accommodate realistic latencies while keeping user experience responsive.

**Simple Queries**

A simple query ("What is a ReplicaSet?") should receive a response within 1-3 seconds. This includes network latency to the LLM provider, LLM inference time, and any processing by kubilitics-ai. If the response takes longer, the user might see a slight delay before the response appears, but it should feel responsive rather than sluggish.

**Complex Investigations**

A complex investigation (multi-step analysis, fetching cluster context, performing vector searches) might take 10-15 seconds. This is within acceptable bounds for an investigation-type feature; users do not expect instant results from investigative analysis.

**Target Performance SLI**

The architecture defines a Service Level Indicator (SLI) for AI response latency: p99 latency (99th percentile) should be under 20 seconds. This means that 99% of requests complete within 20 seconds. The remaining 1% might timeout (either the LLM provider is slow or the network is congested).

If latency consistently exceeds this SLI, the ops team investigates: Is the LLM provider experiencing issues? Is the kubilitics-ai service overloaded? Is the network bandwidth insufficient?

### Caching Strategy to Minimize LLM Calls

Every call to an external LLM provider incurs latency and cost. The architecture minimizes calls through strategic caching.

**Investigation Result Caching**

If User A investigates "Why is pod X failing?" and receives an analysis, the result is cached. If User B investigates the same pod 5 minutes later, and the pod's status has not changed, the cached result is returned instead of querying the LLM again. The cache is tagged with an expiration time (e.g., 30 minutes) and with dependent entities (if the pod's status changes, the cache is invalidated).

**Tool Result Caching**

When the AI calls a tool (e.g., "fetch pod events for pod X"), the result is cached. Subsequent requests for the same data return the cached result if still fresh. This is especially useful for investigation steps that call the same tools multiple times with different contexts.

**Embedding Caching**

Vector embeddings are computed for log snippets, errors, and other text. Computing embeddings requires a call to an embedding API (either an external service or a local model). Computed embeddings are cached so that identical inputs do not result in duplicate API calls.

**Query Result Caching**

Results of Kubernetes API queries (list of pods, current events, resource usage) are cached for short periods (1-5 minutes), reflecting the fact that cluster state changes relatively slowly. Subsequent investigations can reuse these cached results without hitting the Kubernetes API again.

The caching strategy must balance freshness (cache should not serve stale data for long) with cost (caching saves money and latency). The default cache TTLs are tuned conservatively; operators can adjust them based on their cluster's change rate and their budget.

### Token Budget Management

Many LLM APIs charge per token (units of text, roughly 4 characters per token). A large investigation with lots of context might consume thousands of tokens, translating to significant cost.

The architecture implements token budgeting:
- Each user has a monthly token budget (configurable by admins)
- Each investigation consumes tokens from the user's budget
- When a user approaches their budget (80% consumed), they receive a warning
- When a user exceeds their budget, further AI features are disabled with a clear message

Token counts are tracked in the analytics engine and reported in dashboards so users and admins can see token consumption patterns and adjust budgets accordingly.

---

## Section 10: Migration & Upgrade Strategy

### Upgrading from Non-AI to AI-Enabled Kubilitics

Users who have been running Kubilitics without AI features must be able to upgrade to the AI-integrated version without disruption. The upgrade process must be seamless and maintain backward compatibility.

**Desktop Upgrade Path**

A user running Kubilitics v1.1.0 (pre-AI) receives a notification that v1.2.0 is available. They click "Update". The Tauri updater downloads a bundle containing:
- Updated frontend (React + frontend dependencies)
- Updated backend
- New kubilitics-ai binary

All three components are downloaded, verified, and installed atomically. The application is restarted. When the user relaunches Kubilitics, they see the same interface they're accustomed to, with the addition of "AI Configuration" in Settings. Everything they knew about Kubilitics still works. No data loss. No broken workflows.

The first time they navigate to Settings, they might see a gentle notification: "Kubilitics now includes AI features. Configure AI in the AI Configuration section to get started." They can dismiss this notification and continue using Kubilitics without AI if they choose.

**In-Cluster Upgrade Path**

An operator running Kubilitics v1.1.0 in Kubernetes performs an upgrade by running:
```
helm upgrade kubilitics ./kubilitics-helm -f values.yaml --version 1.2.0
```

The Helm upgrade process:
1. Updates the backend Deployment to the new image version
2. Updates the frontend (if serving from backend)
3. Adds the new kubilitics-ai Deployment and Service

If the operator has set `ai.enabled: false` in their values, the kubilitics-ai Deployment is not created. The operator can enable AI later by updating values and rerunning helm upgrade.

All existing data (in the backend's database, in persistent volumes) remains intact. No data migration is required because the AI service does not depend on or modify existing cluster data; it only reads it.

**Mobile Upgrade Path**

Similar to desktop, mobile users receive an available update notification. They update the app through the App Store or Google Play. The new version includes the same UI enhancements (AI Configuration in Settings) but the backend and AI services are on the server, so no local deployment is required.

### Database Migrations for AI-Specific Tables

The kubilitics-backend database may need new tables or schema changes to support AI features:
- An `ai_investigations` table storing investigation results and metadata
- An `ai_cache` table caching investigation results
- An `ai_audit_log` table recording all AI actions for compliance

Database migrations are implemented using a standard migration tool (e.g., Flyway, Liquibase, Go-Migrate). When the backend starts up in version 1.2.0, it automatically applies any pending migrations.

Migrations are designed to be backward-compatible where possible. If a user downgrades from v1.2.0 to v1.1.0 (e.g., rolling back a buggy release), the existing tables and columns added by v1.2.0 are left in place and simply ignored by v1.1.0 (which does not query them). This allows rollback without needing to drop tables or restore the database from a backup.

### Feature Flags for Gradual Rollout

The AI service is shipped as a feature behind a feature flag, allowing operators to deploy the code without immediately enabling the feature for all users.

The flag hierarchy is:
- **Global flag**: `ai.enabled` (true/false in all deployments)
- **Per-organization flag**: `organizations[X].ai.enabled` (enable AI for Org A but not Org B)
- **Per-user flag**: `users[Y].ai.enabled` (enable AI for a group of beta testers)

As engineers test the AI feature and gain confidence, they gradually increase the percentage of users who can access it: first 1% (internal testing), then 5% (beta), then 50% (staged rollout), then 100% (full release).

If issues are discovered during rollout (high error rates, high API costs, poor response quality), the feature can be rolled back by flipping the global flag to false, disabling AI for all users instantly.

Feature flags are also used for individual AI features. For example, the investigation builder might be behind a flag `ai.features.investigation-builder.enabled`, allowing it to be rolled out independently from the AI assistant.

### Rollback Strategy if AI Causes Issues

If a new version of kubilitics-ai introduces bugs, high API costs, security issues, or other problems, the system must support fast rollback.

**For Desktop**

A user running v1.2.0 experiences issues (frequent crashes, excessive API calls, etc.) and downgrades to v1.1.0. The Tauri updater supports downgrade via the version selection UI or automatic downgrade if the current version is marked as unstable.

**For In-Cluster**

An operator running v1.2.0 detects issues and runs:
```
helm rollback kubilitics 1
```

This reverts to the previous Helm release, restoring the previous image versions of all services. The operation typically completes in seconds. If the issue was caused by a database schema change, the schema is reverted using database rollback scripts.

**For Mobile**

Users running v1.2.0 may experience issues due to a misconfigured backend or AI service. The mobile app itself is less likely to have bugs (since it is just the frontend), but the backend or AI might. Admins can disable AI features server-side by setting `ai.enabled: false`, which takes effect for all connected mobile clients without requiring app updates.

### Backward Compatibility Guarantees

The kubilitics-ai service maintains backward compatibility with older versions of the backend. For example:
- AI v1.2.0 can work with backend v1.1.0 (the AI service uses a subset of backend features)
- Frontend v1.2.0 can work with backend v1.1.0 and backend v1.1.5 (the frontend gracefully degrades if certain endpoints are unavailable)

This compatibility allows operators to upgrade services at their own pace and to maintain mixed-version clusters during staged rollouts.

Compatibility is tested in the CI/CD system: before a release, automated tests verify that the new version is compatible with previous versions within a certain window (e.g., the current and two previous versions).

### Version Communication and Release Notes

When releasing a new version, the change log and release notes clearly document:
- New features (and which ones are behind feature flags)
- Bug fixes
- Breaking changes (if any)
- Upgrade instructions
- Known issues and workarounds
- Performance implications (e.g., increased memory usage, new dependencies)

For AI features, release notes specifically document:
- Which LLM providers are supported in this version
- Changes to the MCP server interface (if any)
- New safety policies or filtering rules
- Cost implications (e.g., if this version makes more LLM API calls than before)

This documentation helps users and operators make informed decisions about whether to upgrade and what to expect.

### Contingency Planning

Despite careful testing and gradual rollout, issues may still occur in production. The contingency plan includes:
1. **Incident response**: On-call engineers are alerted and begin investigating
2. **Immediate mitigation**: Disable the problematic feature via feature flags or environment variables
3. **Temporary workaround**: Revert to a previous version or switch to a different LLM provider
4. **Root cause analysis**: Determine what caused the issue
5. **Fix**: Develop and test a fix
6. **Gradual re-rollout**: Re-enable the feature with the fix in place, starting with a small percentage of users

This process ensures that production issues do not cascade into widespread outages, and that users always have a path to recovery.

---

## Conclusion

The delivery of kubilitics-ai across desktop, mobile, and in-cluster environments requires a sophisticated architecture that accommodates fundamentally different operational models while maintaining a unified feature set and user experience. The central design principle—graceful degradation with AI as a strict superset of core functionality—ensures that Kubilitics remains reliable and usable even when AI components are unavailable or misconfigured.

The architecture's commitment to separation of concerns (kubilitics-ai as an independent service, not embedded in the backend), combined with clear versioning and compatibility guarantees, enables each component to evolve and be deployed independently while the system as a whole maintains coherence and user value.

By following the architectural patterns outlined in this document—resource budgeting, security defense-in-depth, graceful error handling, and comprehensive observability—Kubilitics will successfully integrate AI capabilities that enhance platform value without compromising reliability, security, or user trust.

---

**Document Status**: Ready for Engineering Review
**Next Steps**: Detailed implementation guides, API specifications, and operational runbooks will follow in Documents 2 and 3 of this series.
