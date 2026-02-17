# Kubilitics Frontend AI Integration Design Document

## Document 2 of 3: Comprehensive Frontend AI Design Specification

**Version:** 1.0
**Date:** February 2025
**Status:** Design Specification Ready for Implementation

---

## Executive Summary

This document provides an exhaustive design specification for integrating artificial intelligence capabilities throughout the Kubilitics frontend application. The integration follows the principle that AI is not a single feature but rather an intelligence overlay that enriches every page, every resource view, and every user interaction in the application.

The design ensures that the application remains fully functional and valuable without AI (when no API key is configured), while simultaneously providing dramatically enhanced capabilities when AI is enabled. Users are never forced to use AI features; instead, AI surfaces opportunities for deeper understanding, faster diagnosis, and more informed decision-making.

This specification covers the global infrastructure components that make AI accessible from any page, the detailed enhancements to each resource type, the state management approach, API communication patterns, the complete component library that will be built, and a phased implementation roadmap that brings AI capabilities to the frontend in a structured, testable way.

---

## Section 1: Design Philosophy — AI as a Layer, Not a Feature

### 1.1 The Core Principle: AI as an Intelligence Overlay

The fundamental design principle guiding this entire integration is that artificial intelligence should function as an **invisible intelligence layer** woven throughout the application, rather than as a discrete feature or isolated section. Just as the Kubilitics backend communicates with the Kubernetes API, the frontend should communicate with the kubilitics-ai service as a natural extension of information gathering and interpretation.

This philosophy stands in stark contrast to how many applications bolt on AI as an afterthought—a "Chat with AI" button that exists separately from the main user experience. Instead, every page, every resource view, and every data table should be enhanced with AI intelligence that appears naturally and contextually.

The intelligence should manifest in different ways depending on the context:
- On a dashboard, AI provides a natural-language summary of cluster health
- On a pod detail page, AI explains what the logs mean and suggests fixes
- On a resource list, AI highlights anomalies and unusual patterns
- In the search bar, AI understands queries like "show me overprovisioned deployments" instead of requiring exact filter syntax
- In a topology view, AI can explain blast radius and dependency relationships

Critically, none of this should feel forced or intrusive. When AI is not configured (no API key), the entire application remains visually and functionally complete. The UI simply omits AI-powered sections entirely, or shows graceful "Configure AI in Settings" prompts for advanced features that benefit from AI.

### 1.2 The Dual Mode Principle: 100x vs. 1000x Better

This design establishes what we call the "dual mode principle." The application operates in two distinct modes, each valuable in its own way:

**Mode 1: Without AI Configuration (100x Better than Competitors)**

When no AI API key is configured, Kubilitics provides genuine value that substantially exceeds what users get from other Kubernetes management tools. Specifically:
- Complete visibility into all Kubernetes resources with deterministic, factual data straight from the API
- Real-time filtering and searching across resources
- Multi-step resource detail views with YAML, events, logs, and relationships
- Topology visualization showing how resources connect
- Role-based access controls with fine-grained permissions
- Historical event tracking and audit trails

This mode should never feel incomplete. Every dashboard is fully populated with meaningful data. Every table is sortable and filterable. Every detail page shows everything a user needs to understand and manage that resource. Users can operate the entire application productively without ever needing to enable AI features.

**Mode 2: With AI Configuration (1000x Better than Competitors)**

When an AI API key is configured and the user has enabled AI features, the same application transforms into something far more intelligent:
- Multi-step investigation capabilities that explain root causes, not just symptoms
- Natural language understanding that eliminates complex filter syntax
- Proactive anomaly detection and recommendations
- Automated root cause analysis of failures and issues
- Cross-resource pattern analysis identifying systemic problems
- Predictive capabilities forecasting resource exhaustion or scaling needs
- Confidence indicators showing when AI is certain vs. speculating
- Approval workflows for AI-suggested actions with full transparency into reasoning

The dual mode principle means that adding AI doesn't improve the 100x-better experience by 10x. It improves it by 10x again, creating something that is multiple orders of magnitude more capable. A user familiar with other tools feels like they're using something from the future when they enable Kubilitics AI integration.

### 1.3 Progressive Disclosure: Discovery Over Prescription

Users should discover AI capabilities naturally as they explore the application, rather than being directed toward them. This principle, called progressive disclosure, prevents new users from feeling overwhelmed by AI features while ensuring that power users who spend time exploring find increasingly sophisticated AI-powered capabilities.

The implementation of progressive disclosure means:
- AI capabilities appear contextually relevant to what the user is currently viewing
- Insight cards appear naturally below resource details, not as modal popups
- Quick action menus show AI options alongside traditional options, not separate
- The global AI Assistant Panel is accessible but not intrusive (keyboard shortcut, floating button)
- Advanced features like "autonomy level" and "safety policies" are in settings, not on every page
- Historical data and investigation patterns become more useful the longer the user engages with AI

A new user might not even notice AI features at first. They use the application exactly as they would without AI. But over time, as they click "Diagnose this pod" or expand an insight card, they realize they have an intelligent assistant that understands Kubernetes deeply.

A power user who enables AI discovers sophisticated capabilities: bulk resource analysis, natural language investigation, topology-based blast radius analysis, and predictive capacity planning. These advanced features don't appear until explicitly enabled or discovered.

### 1.4 Never Force AI; Always Allow Manual Operation

This principle is absolute: AI must be entirely optional, and the ability to work without AI must never be compromised.

Specifically:
- No modal popup saying "Configure AI for full functionality"
- No disabled buttons that only work with AI enabled
- No pages that are incomplete without AI insights
- No mandatory approval workflows powered by AI
- No search that switches to AI when exact match fails without user intent

Instead, AI features should be presented as enhancements, not requirements:
- "Configure AI in Settings" appears as a link, not a blocking dialog
- Insight cards are dismissible and don't reappear unless the user chooses
- Quick actions include both AI-powered and traditional options
- Search behavior is consistent with or without AI; AI just understands more natural language phrasing
- Resource detail pages work perfectly without AI tabs; AI tabs are additions

Users should never feel punished for not using AI. A user who has never enabled AI and never will should experience a fully complete, fully functional application.

### 1.5 AI Enhances but Never Replaces Deterministic Data

A critical safeguard built into this design: AI insights and recommendations never replace actual data from the Kubernetes API. Pod status always comes directly from the API, never from AI opinion. Resource counts are always accurate API values, never AI estimates. Events are always from the audit trail, never AI inferences.

AI adds layers of interpretation, explanation, and intelligence *on top* of deterministic data:
- The API says a pod has 5 container restarts; AI explains why that pattern suggests an OOMKill issue
- The API says CPU utilization is 45%; AI suggests that based on growth trends, it will exceed the limit in 3 days
- The API shows a failed deployment; AI explains that the image pull failed and suggests checking image availability

This principle prevents the dangerous situation where a user trusts AI's explanation over the actual data. The actual data is always the source of truth. AI is the interpreter, not the source.

Users can see this distinction clearly in the UI through visual hierarchy and labeling:
- Factual data (pod status, resource counts) appears with standard styling
- AI interpretations appear labeled as "AI Analysis" or "AI Insight" with visual distinction
- Recommendations appear with confidence indicators ("High confidence", "Speculative")
- Predictions are explicitly marked as forecasts, not current state

---

## Section 2: Global AI Infrastructure Components

These foundational components enable AI intelligence across the entire application. Unlike resource-specific features that appear on particular pages, these components exist globally and can be accessed from anywhere in the application.

### 2.1 The AI Assistant Panel (Global Sliding Panel)

The AI Assistant Panel is the primary interface for direct AI engagement. It's a persistent, context-aware sliding panel that provides chat-like investigation capabilities, remembers previous conversations, and can take actions on the user's behalf (subject to approval and autonomy settings).

#### 2.1.1 Physical Appearance and Behavior

The AI Assistant Panel occupies the right side of the application window, sliding in from the right edge when activated. On desktop screens, it consumes approximately 350 to 400 pixels of horizontal space, allowing the main content to remain visible and usable behind it. The panel has a semi-transparent backdrop behind it so users can still see what's happening in the main application while the panel is open.

The panel can be opened through multiple input methods:
- **Keyboard shortcut:** Cmd+K (macOS) or Ctrl+K (Windows/Linux), consistent with modern application design conventions
- **Floating button:** A persistent floating action button located in the bottom-right corner of the screen, showing a speech bubble or assistant icon with a pulse animation when investigations are in progress
- **Quick action menus:** Right-click or long-press on any resource to reveal a context menu with AI actions; selecting "Diagnose" or "Investigate" opens the panel with context pre-filled
- **Header badge:** Click the AI status indicator in the app header to open the panel
- **Deep linking:** URL parameter or keyboard navigation that launches the panel programmatically

When opened, the panel displays:
1. **Header section:** Showing "AI Assistant" or "Kubilitics AI", with a close button (X) on the right
2. **Context indicator:** Brief text showing what resource the AI is focused on (e.g., "Analyzing: pod-name in namespace-name" or "General investigation mode")
3. **Investigation history sidebar:** A scrollable list on the left showing previous investigations, with timestamps, titles, and a visual indicator of completion status
4. **Main chat area:** The central section showing the current conversation, supporting both user messages and AI responses
5. **Input area:** At the bottom, a text input field with placeholder text like "Ask about your cluster, a resource, or a problem you're investigating"

The panel uses the same design language as the rest of the application (Tailwind CSS, Lucide icons) and maintains visual consistency with existing UI patterns.

#### 2.1.2 Context Awareness

The AI Assistant Panel is deeply context-aware. When the user opens the panel while viewing a specific resource, that resource becomes the default subject of investigation. This context is indicated to the user and persists throughout the conversation.

For example:
- User is viewing the detail page for pod "app-backend-7d8f9c3b"; they open the AI panel with Cmd+K. The context indicator shows "Analyzing: app-backend-7d8f9c3b in namespace: production"
- User types "Why has this pod restarted so many times?" AI understands the question refers to the current pod without needing the user to repeat its name
- If the user then navigates away from the pod detail page, the panel indicates the shift in context

Context-aware functionality includes:
- **Resource binding:** When the panel is opened from a resource detail page, that resource's ID and type are automatically included in API calls to AI
- **Namespace scoping:** If the user is viewing resources in a specific namespace, AI by default limits analysis to that namespace (though the user can request cross-namespace analysis)
- **Historical continuity:** When the panel is reopened later, it remembers the last resource being analyzed and can ask questions about it
- **Implicit references:** If the user asks "What are the dependencies?" while viewing a service, AI understands they mean dependencies of that service, not dependencies in general

#### 2.1.3 Natural Language Input Interface

The input area supports free-form natural language questions and commands. Users aren't constrained by filter syntax, predefined actions, or CLI-like command structures. Instead, they can ask questions the way they would ask another engineer:

**Example investigations a user might type:**

- "What's causing the high CPU usage on this deployment?"
- "Show me all pods that have restarted more than 5 times in the last hour"
- "Why is this service not receiving traffic?"
- "Which nodes are running out of disk space?"
- "Are there any RBAC misconfigurations in this cluster?"
- "What happens if I delete this configmap?"
- "Recommend optimal replica counts for each deployment based on current usage"
- "Find all services that have endpoints from multiple nodes"
- "Is there any pod that's using significantly more memory than it requested?"
- "Which statefulsets haven't been updated in the past 7 days?"

The AI system should handle:
- **Vague questions:** "Why is everything slow?" — AI asks clarifying questions or makes reasonable assumptions based on context
- **Multi-part questions:** "Show me all unhealthy pods and then explain what's causing the issues" — AI breaks this into steps
- **Command-like queries:** "Drain this node safely" — AI explains what would happen before proposing an action
- **Diagnostic requests:** "Investigate why this deployment is in a stuck state" — AI performs multi-step analysis
- **Comparative queries:** "Which deployment is most resource-efficient?" — AI performs analysis across all deployments

Input validation and error handling should be forgiving:
- Typos and informal language are understood ("wats using all the cpu" → "What's using all the CPU?")
- The AI should ask for clarification if the question is ambiguous, rather than guessing
- Empty input or just hitting Enter doesn't submit or error; the input field simply awaits a real question

#### 2.1.4 Response Rendering

AI responses are rendered in a flexible format that supports multiple content types:

**Text responses:** Markdown-formatted text allowing bold, italics, lists, code blocks, and links. Code blocks should be syntax-highlighted for clarity, and inline code should use monospace fonts matching the application's code styling.

**Resource links:** When the AI mentions a resource in the response, the resource name should be rendered as a clickable link that navigates to that resource's detail page. For example, if AI mentions "pod: app-backend-7d8f9c3b", clicking that link navigates to the pod's detail page.

**Metric visualizations:** When discussing metrics or trends, the response can include embedded charts:
- **Sparklines:** Simple inline charts showing CPU or memory trends over time
- **Bar charts:** Comparing resource usage across multiple resources
- **Time series graphs:** Showing how metrics evolved during an incident
- **Gauge charts:** Showing current utilization percentage

These charts should be small and embedded naturally in the response text, not taking up excessive space.

**Action buttons:** When AI proposes an action, it appears as a button that the user can click:
- **Approve button:** Accept the proposed action and execute it (subject to autonomy settings)
- **Reject button:** Dismiss the action
- **Explain button:** Get more detail about why the action is being proposed
- **Modify button:** Adjust parameters before approving (e.g., "I want to scale to 5 replicas, not 3")

**Tables:** When presenting structured data (e.g., "Here are the 5 most resource-hungry deployments"), the AI can render a scrollable table within the chat. Tables support sorting by column (for the most recent message) but remain static for older messages in the history.

**Related resources section:** At the end of AI responses discussing a specific issue, a section can appear showing related resources that might be relevant:
- Events related to the resource
- Pods managed by a deployment
- Endpoints of a service
- These appear as clickable chips or a compact list

Response formatting should use the same design language as the rest of the application. Text should use the application's primary font. Emphasis colors should match the Tailwind color palette. Links should use the same color as navigation links elsewhere in the app.

#### 2.1.5 Investigation Mode and Multi-Step Reasoning

For complex investigations, the AI system can enter "investigation mode" where it breaks down a complex problem into explicit steps. This is particularly valuable for diagnostic queries that require multiple analyses.

When in investigation mode, the user sees:
1. **Investigation timeline:** A vertical timeline showing each step of the investigation, numbered (1, 2, 3, etc.)
2. **Step status:** Each step shows:
   - **Active step:** Currently being investigated, with a loading spinner or "Thinking..." text
   - **Completed steps:** Show a checkmark and a summary of what was investigated
   - **Failed steps:** Show a warning icon and an explanation of what couldn't be determined
3. **Visible reasoning:** For each step, brief text explains what the AI is looking into: "Step 2: Analyzing pod logs for error patterns"
4. **Interactive exploration:** User can click on any completed step to expand its findings or ask follow-up questions about that specific step

Example investigation flow for "Why is my deployment in a stuck rollout state?":

```
Step 1: ✓ Retrieving deployment status
  Deployment: my-app, Replicas: 3/5, Waiting for 2 replicas

Step 2: ✓ Analyzing replica sets
  Found 2 replica sets: old version and new version

Step 3: ⏳ Investigating pod scheduling issues
  Examining why new version pods aren't starting...

Step 4: (Waiting for step 3)
  Will check for resource constraints once pods identified
```

The investigation timeline remains visible while the user can continue asking questions. If the user asks a follow-up question ("Can you check if there's an image pull issue?"), the timeline pauses and a new focused investigation begins, then the timeline resumes.

#### 2.1.6 Streaming Responses

AI responses use streaming where tokens appear in real-time as the AI generates them, rather than waiting for the entire response to complete. This provides immediate feedback and makes the interaction feel more conversational.

Implementation details:
- **Token appearance:** Tokens appear character by character or word by word, flowing naturally into the chat area
- **Thinking indicators:** Before tokens start appearing, a brief "Thinking..." message appears with an animated ellipsis or spinner
- **Interruptibility:** Users can stop/interrupt a response that's still streaming by clicking an "X" button or pressing Escape
- **Formatting:** As markdown content streams in, formatting (bold, italics, links) is rendered in real-time, not as plain text that's later converted

The streaming behavior should feel responsive and dynamic, creating a sense that the AI is actively thinking and communicating, not just fetching a pre-written response.

#### 2.1.7 Investigation History

The left sidebar of the AI Assistant Panel shows investigation history, providing quick access to previous conversations and findings.

**History display:**
- Each investigation appears as a single row/item in the list
- Shows a brief title extracted from the user's first message (auto-truncated to fit)
- Shows a timestamp (e.g., "2 hours ago", "Yesterday at 3:47 PM")
- Shows a visual indicator: checkmark if completed successfully, warning if partially successful, spinner if in progress
- Optionally shows relevant resource icons (a pod icon if investigating a pod, a deployment icon if investigating a deployment)

**Interacting with history:**
- Click any history item to load that investigation
- Long-press or right-click to reveal options: "Pin to top", "Copy investigation link", "Delete"
- Search the history: a search field at the top of the sidebar filters history by title or date
- Clear all: a button to clear all history (with a confirmation dialog)

**Persistence:**
- History persists across browser sessions using the application's state management (Zustand store with localStorage or IndexedDB backing)
- History is limited to, for example, the last 50 investigations or the last 30 days (configurable in settings)
- Sensitive investigations can be marked as "private" and aren't stored in history

**History value:**
The history list is more than convenience; it's a learning tool. Users can:
- Review how similar issues were diagnosed in the past
- Share investigation links with colleagues ("Run the same analysis I ran yesterday on pod XYZ")
- Build muscle memory of good investigation practices
- See patterns in recurring issues ("We've diagnosed this exact OOMKill pattern 4 times this month")

### 2.2 AI Status Indicator (Header Bar)

The application header contains a small but informative AI status indicator that shows at a glance whether AI is configured, connected, and available.

#### 2.2.1 Visual Design

The indicator is a compact status badge appearing in the top-right area of the header, near other system status indicators. It consists of:
- **Status dot:** A small circular indicator that's green (ready), yellow (connecting/busy), orange (degraded), or red (error)
- **Text label:** Shows one of "Not Configured", "Connecting...", "Ready", or "Error"
- **Interaction:** Clicking the badge opens a quick panel with more details and settings access

The status dot uses a subtle pulse animation when AI is actively investigating (the dot pulses green), providing non-intrusive feedback that something is happening.

#### 2.2.2 Status States

**Not Configured:**
- Dot is gray
- Label shows "Not Configured"
- Clicking opens a quick panel with a link to AI settings and an explanation that AI requires an API key
- This state indicates the user hasn't set up an AI provider yet

**Connecting:**
- Dot is yellow
- Label shows "Connecting..."
- The dot has a loading animation
- This state appears when the application is first initializing the AI connection or after a reconnection attempt
- This state should be brief; if it persists more than 10 seconds, it likely means there's a connectivity issue

**Ready:**
- Dot is solid green
- Label shows "Ready"
- The dot has a subtle idle pulse when AI is not actively working
- When AI is actively investigating, the pulse becomes more pronounced
- Clicking opens a quick panel showing: current LLM provider, estimated monthly token usage, and a link to AI settings

**Degraded:**
- Dot is orange
- Label shows "Degraded" or "Slow"
- This state indicates the AI service is responding but slowly, or recent requests have failed but the service might recover
- Clicking shows details about the issue and a "Retry" button

**Error:**
- Dot is red
- Label shows "Error"
- This state indicates the AI service is completely unavailable or the API key is invalid
- Clicking opens a quick panel showing the error message and troubleshooting options:
  - If API key is invalid: "Your AI API key appears to be invalid. Check your settings."
  - If service is unreachable: "The AI service is unavailable. Check your connection and try again."
  - "Retry" button to attempt reconnection
  - Link to AI settings
  - Link to help documentation

#### 2.2.3 Quick Panel Content

Clicking the status indicator opens a small panel (similar to a user menu dropdown) showing:
- **Current provider:** "OpenAI GPT-4" or "Anthropic Claude 3 Opus", etc.
- **Token usage:** Shows current month's token usage and the limit if one is configured (e.g., "12,450 / 50,000 tokens this month")
- **Usage trend:** Simple visual indicator of whether usage is increasing or stable
- **Quick settings:** Links to open full AI Settings page
- **Documentation:** Link to AI integration help docs

The quick panel is dismissible by clicking elsewhere or pressing Escape.

#### 2.2.4 Accessibility and Non-Intrusive Design

The status indicator should be:
- **Visible but not dominant:** Should not draw attention away from the main content or cluster management
- **Meaningful without hovering:** The label should be clear without needing a tooltip
- **Keyboard accessible:** Tab navigation should include the status indicator; Enter should open the quick panel
- **Color-meaningful but not color-only:** Status should be indicated by text label and icon shape, not just color (for colorblind users)

### 2.3 AI Insight Cards (Contextual Intelligence)

Insight cards are small, non-intrusive cards that appear on resource pages with AI-generated observations and recommendations. They appear naturally within the page layout, typically below the main resource details or in a dedicated insights section.

#### 2.3.1 Card Structure and Content

Each insight card contains:
1. **Title/summary:** A brief (one to two sentence) observation (e.g., "Pod restart pattern suggests memory pressure")
2. **Insight text:** A short paragraph explaining the observation in human-readable language
3. **Confidence indicator:** Visual + text showing how confident the AI is in this insight
4. **Severity indicator:** Visual indicator (color badge) showing the importance: "Info" (blue), "Warning" (yellow), "Critical" (red)
5. **Action buttons:**
   - **"Investigate" button:** Opens the AI Assistant Panel with this specific insight as the investigation focus
   - **"Dismiss" button:** Removes the card from the current view (doesn't suppress future insights)
   - **"..." menu:** Additional options like "Never show this type of insight", "Send to team", or "Pin to dashboard"
6. **Visual elements:** An icon matching the insight type (memory icon for memory-related insights, network icon for network issues, etc.)

#### 2.3.2 Examples of Insight Cards

**Pod Restart Pattern Analysis:**
```
Title: Pod restart pattern suggests memory pressure
Insight: This pod has restarted 3 times in the last 4 hours.
Each restart occurs after approximately 30 minutes of runtime.
This pattern is consistent with Out-Of-Memory (OOMKill) events.
Current memory limit: 256Mi. Memory usage typically reaches 85% before restart.
Confidence: 92%
Severity: Critical
Action: "Investigate" or "Dismiss"
```

**Deployment Configuration Issue:**
```
Title: Deployment replicas underutilized
Insight: This deployment has 5 replicas but traffic is consistently
low, with each pod receiving <100 requests/minute. Cost optimization
analysis suggests 2-3 replicas would provide the same reliability
with 50% resource savings.
Confidence: 78%
Severity: Warning
Action: "Investigate" or "Dismiss"
```

**Network Topology Issue:**
```
Title: Service has unhealthy endpoints
Insight: 3 of this service's 6 endpoints are not responding to
health checks. The 3 healthy endpoints are on the same node,
creating a single point of failure.
Confidence: 100%
Severity: Critical
Action: "Investigate" or "Dismiss"
```

**Resource Configuration Warning:**
```
Title: Resource requests appear too conservative
Insight: This deployment's pods are requesting 100m CPU and 128Mi memory,
but consistently use 500m CPU and 256Mi memory. Adjusting resource requests
will improve pod placement efficiency and prevent unnecessary evictions.
Confidence: 85%
Severity: Info
Action: "Investigate" or "Dismiss"
```

#### 2.3.3 Card Styling and Presentation

Insight cards use a clean, non-alarming design:
- **Background:** Slightly tinted based on severity (light red for critical, light yellow for warning, light blue for info)
- **Border:** Thin left border in color matching severity
- **Typography:** Clear hierarchy with title, insight text, and metadata in distinct sizes
- **Icons:** Lucide icons matching the insight type, positioned at the top-left of the card
- **Spacing:** Cards are grouped together in a "Insights" section on resource detail pages, with space between cards

Cards should feel like helpful suggestions, not alarms. Even "Critical" severity cards should be calmly presented, not flashy or alarming.

#### 2.3.4 Loading and Empty States

**Loading state:** When the AI is analyzing a resource and generating insights, a skeleton shimmer card appears in the insights section. This indicates that insights are being generated without requiring the user to wait for completion.

The skeleton card shows placeholder blocks of text (shimmer animation) and disappears when the actual insight cards load. If an error occurs during insight generation, the skeleton is replaced with an empty state card explaining the issue.

**Empty state:** When no insights are available for a resource, either:
- No insight section appears at all (cleanest approach for resources with no issues)
- A subtle empty state message appears: "No issues detected by AI" with an icon and optional link to "Run manual analysis" or "Configure AI for insights"

The empty state should not be alarming. It should feel positive—the resource is healthy.

#### 2.3.5 Insight Generation and Caching

Insights are generated asynchronously in the background as the user views a resource. They don't block the page load or navigation.

**Caching strategy:**
- Insights are cached in the Zustand store with a time-to-live (TTL) of, for example, 5 minutes
- If the user navigates away from a resource and returns within 5 minutes, cached insights are shown immediately
- After TTL expires, new insights are generated on the next view
- For resources that are actively changing (pods, recent deployments), the TTL is shorter (2-3 minutes)
- For stable resources (static ConfigMaps, old ReplicaSets), the TTL is longer (30 minutes)

**Automatic refresh:**
When a resource's state changes (detected via API updates or WebSocket events), cached insights for that resource are invalidated, and new insights are generated on the next view.

#### 2.3.6 Dismissal and Suppression

Users can dismiss individual insight cards without affecting future insight generation. This is useful when an insight is old news or not relevant to the user.

Users can also suppress specific types of insights:
- Right-click or use the "..." menu on a card to access suppression options
- Options include: "Don't show this type of insight again", "Don't show for this resource", "Don't show this specific insight again"
- Suppressions are stored in the application state and respected in future insight generation

Users can manage all suppressions in the AI Settings page, where they can review and re-enable suppressed insight types.

### 2.4 AI Quick Actions Menu

Right-clicking on any resource in a list view, or long-pressing on mobile, reveals a context menu that includes AI-powered actions alongside traditional options.

#### 2.4.1 Menu Structure

The context menu appears with standard options like:
- Edit (for editable resources)
- Delete (with confirmation)
- Copy name/ID
- View YAML
- View events

And adds new AI options like:
- **"Diagnose":** Opens the AI Assistant Panel with this resource as the focus for investigation
- **"Explain this resource":** AI generates a plain-English explanation of what this resource does and its current state
- **"Find related issues":** AI analyzes this resource and related resources to identify any problems
- **"Suggest optimizations":** AI recommends configuration changes or improvements for this resource
- **"Ask about this":** Opens the AI Assistant Panel with free-form input for questions about this resource

#### 2.4.2 Visual Distinction

AI actions appear in the context menu with:
- **AI icon:** A small icon (e.g., a brain or sparkle icon) next to AI action items, distinguishing them from traditional actions
- **Section separation:** If there are many menu items, AI actions might appear in a separate section (e.g., "AI Analysis") below traditional actions
- **Keyboard shortcut:** Optionally, if the user uses AI frequently, a keyboard shortcut could be assigned (e.g., Alt+D for Diagnose)

#### 2.4.3 Action Execution

Selecting an AI action:
- **"Diagnose":** Immediately opens the AI Assistant Panel with the resource context and a pre-filled request like "Diagnose this pod"
- **"Explain this resource":** AI generates an explanation that appears as a modal dialog or inline expansion, without opening the full panel
- **"Find related issues":** Similar to diagnose but with a focus on identifying problems affecting this resource
- **"Suggest optimizations":** Opens a results panel showing optimization recommendations with brief explanations
- **"Ask about this":** Opens the AI Assistant Panel with the input field focused and ready for the user's question

None of these actions are blocking; the user can continue using the application while AI analysis happens in the background.

### 2.5 AI-Enhanced Search (Global Search Bar)

The existing global search bar is enhanced to understand natural language queries, in addition to exact-match searching.

#### 2.5.1 Dual Search Modes

The search functionality operates in two modes:

**Exact Search (Default):** Works like traditional resource search—finds resources by name, label, or exact string matching. This is fast, deterministic, and doesn't require AI. When the user types "pod-123", the search finds that exact pod immediately.

**AI Search (Optional):** When the user phrasing suggests a complex query or uses natural language, the search switches to AI mode. For example:
- "Pods using more than 80% memory" → AI Search
- "Deployments without endpoints" → AI Search
- "Services in the production namespace" → Exact Search (could be either)
- "Which nodes will run out of disk in 7 days" → AI Search

The switch between modes should be seamless. The user doesn't click a toggle or select a mode; the application determines the appropriate mode based on query syntax.

#### 2.5.2 Query Examples and Interpretation

**Memory and CPU Queries:**
- "Pods using more than 500m CPU"
- "Deployments with memory requests less than 256Mi"
- "Nodes approaching capacity"
- AI interprets these as queries about resource utilization and returns ranked results

**Health and Status Queries:**
- "Show me all failing pods"
- "Which services have no endpoints?"
- "Deployments with pending replicas"
- AI interprets these as queries about current state and returns relevant resources

**Temporal Queries:**
- "Pods restarted in the last hour"
- "Events in the last 2 days"
- "Deployments updated more than 30 days ago"
- AI interprets time-based constraints and returns resources matching those criteria

**Relationship Queries:**
- "Pods managed by this deployment"
- "Services served by this ingress"
- "Secrets used by this deployment"
- AI interprets relationship syntax and traverses the resource graph to find related resources

**Predictive Queries:**
- "Which PVCs will be full in 7 days?"
- "Which nodes should be scaled up?"
- "Deployments that should be auto-scaled"
- AI performs trend analysis and returns resources with predictions

#### 2.5.3 Search Results Presentation

**Exact Search Results:**
Appear in a dropdown below the search bar, organized by resource type:
- Matching pods, deployments, services, etc. listed with quick icons and names
- Click to navigate to the resource's detail page

**AI Search Results:**
Appear in a results panel (modal or expanded view) showing:
- **Ranked results:** Results ordered by relevance (how well they match the query)
- **Result cards:** Each result shows:
  - Resource name and type
  - Current state (pod status, deployment replicas, etc.)
  - Why it matches the query (brief explanation)
  - Click to navigate to the resource
- **Explanation:** Top of results shows an explanation of how the AI interpreted the query
- **Refinement options:** Suggestions for narrower queries if results are too broad

Example AI search result for "Pods using more than 80% memory":
```
Query interpreted as: Show pods where current memory usage exceeds 80% of their memory request

Results (5 pods matching):

1. pod-app-backend-7d8f9c3b (production)
   Memory usage: 442Mi / 512Mi (86.3%)
   Status: Running
   Match: Exceeds 80% threshold

2. pod-cache-redis-2k9f3 (production)
   Memory usage: 234Mi / 256Mi (91.4%)
   Status: Running
   Match: Exceeds 80% threshold
   [more results...]
```

#### 2.5.4 Search Bar Design

The search bar's appearance shouldn't change significantly:
- Still shows a search icon on the left
- Still has placeholder text "Search resources..."
- Now optionally shows a small AI icon when in AI mode or when AI mode is available
- Results dropdown now accommodates both exact and AI results, clearly separated

When AI is not configured, exact search works normally, and AI search mode doesn't appear.

---

## Section 3: Page-by-Page AI Integration

Every page in the Kubilitics application benefits from AI integration. This section details the specific enhancements to each major page category.

### 3.1 Dashboard Page

The dashboard is the landing page most users see first. It provides an overview of cluster health, resource counts, and critical issues. AI enhances the dashboard by providing intelligent summaries, anomaly detection, and proactive recommendations.

#### 3.1.1 AI Summary Widget

At the top of the dashboard, a new "Cluster Health Summary" widget (or section) presents an AI-generated natural-language overview of cluster state. This is different from existing metric widgets that show raw numbers; instead, it tells a story about cluster health.

**Widget content:**
The AI generates a 2-4 sentence paragraph that intelligently summarizes the cluster's current state. For example:

```
"Your cluster is operating normally with 87 running pods across 3 nodes.
However, the frontend-cache deployment has been restarting frequently,
and node-3 is approaching capacity. I recommend investigating the cache
pod crashes and planning a node upgrade."
```

The paragraph focuses on what actually matters: Are there problems? Are there optimization opportunities? What should the user pay attention to right now?

**Key aspects:**
- Updates periodically (e.g., every 2-5 minutes) so users see current information
- Can be expanded to show more detail or contracted to show just a summary
- Includes one or two actionable insights (problems that have been detected)
- Written in conversational, non-technical language wherever possible
- Never uses jargon without explanation

**Widget styling:**
- Appears as a card with a light background color
- Uses a readable font size and line height for easy scanning
- Optionally includes an icon (brain, sparkle, or assistant icon)
- May have an "Investigate" button to open the AI Assistant Panel with the summary as context

#### 3.1.2 Anomaly Alerts Section

Below the cluster summary, a new section called "Anomaly Alerts" or "AI-Detected Issues" shows cards for each anomaly the AI has detected. This section only appears if there are anomalies; it's hidden when the cluster is healthy.

**Anomaly cards:** Each anomaly appears as a priority card showing:
- **Issue title:** Clear, concise description of the anomaly (e.g., "High pod restart rate in payments service")
- **Affected resources:** Which resources are involved (e.g., "5 pods in the payments namespace")
- **Severity indicator:** Visual badge (red for critical, yellow for warning)
- **Brief explanation:** One or two sentences explaining why this is an issue
- **Recommended action:** Suggested next step (e.g., "Investigate pod logs for OOMKill patterns")
- **"Investigate" button:** Opens the AI Assistant Panel focused on this anomaly

**Example anomaly alerts:**

```
Pod Restart Storm Detected [Critical]
Affected: 8 pods in the payment-service namespace
25 pod restarts in the last 60 minutes. This is unusual and suggests
a systemic issue like resource exhaustion or a failing dependency.
Recommended: Investigate pod logs for error patterns
```

```
Node Capacity Alert [Warning]
Affected: node-3
node-3 is 84% memory utilized. Based on current pod scheduling trends,
it will reach capacity in approximately 18 hours.
Recommended: Plan node scaling or consider pod migrations
```

**Ordering:** Anomalies appear ordered by severity (critical first) and recency (newer issues before older ones).

#### 3.1.3 Predictive Insights Section

A section called "Predictive Insights" or "Forecasts" shows AI predictions about future cluster state. These are non-alarming suggestions that help users plan ahead.

**Predictive cards:** Each prediction shows:
- **Forecast title:** What will happen (e.g., "PVC approaching capacity")
- **Timeframe:** When this is expected to happen (e.g., "In 5-7 days")
- **Affected resource:** Which resource this applies to
- **Reasoning:** Brief explanation of how the prediction was made
- **Recommended action:** What to do about it

**Example predictions:**

```
PVC 'data-backups' Approaching Capacity [Info]
Timeframe: 5-7 days
Growth rate: 12GB per day, current capacity: 80GB (70% used)
Recommended: Increase PVC size or implement retention policies
```

```
Consider Deploying Auto-Scaling [Info]
Timeframe: Planning
2 deployments show consistent scaling patterns. Deployment 'api-server'
needs ~5 replicas during peak hours and 2 during off-peak.
Recommended: Configure Horizontal Pod Autoscaling for these workloads
```

These predictions help proactive cluster management. Users can see issues coming and plan for them.

#### 3.1.4 Cost Optimization Summary

A new card called "Cost Optimization Opportunities" shows AI analysis of resource efficiency across the cluster.

**Card content:**
- **Savings estimate:** "You could save approximately 30% of compute resources by rightsizing these 5 deployments"
- **Quick breakdown:** Shows what types of savings are available:
  - "3 overprovisioned deployments (could scale down replicas)" — 15% savings
  - "2 deployments with request mismatches (requests exceed actual usage)" — 15% savings
- **"View details" or "Optimize" button:** Shows a detailed breakdown or recommendations for each identified opportunity

**Example optimization summary:**

```
Cost Optimization Opportunities [Info]
Potential savings: ~30% of current resource allocation

Overprovisioned Deployments (15% savings):
- deployment-1: 6 replicas, avg load 2
- deployment-2: 4 replicas, avg load 1.5

Memory Request Mismatches (10% savings):
- deployment-3: requests 1Gi, uses avg 256Mi
- deployment-4: requests 512Mi, uses avg 150Mi

Unused Storage (5% savings):
- 3 PVCs not mounted in any pod
- 2 old ReplicaSets still occupying storage

View Details → Investigate with AI
```

Users can click through to get AI recommendations for each optimization opportunity.

#### 3.1.5 Quick Actions Widget

A card titled "Quick Actions" or "AI Recommendations" shows buttons for common AI-powered investigations:
- **"Fix 3 Critical Issues"** — Highlights the most critical issues and suggests fixes
- **"Optimize Cluster"** — Runs a cluster-wide optimization analysis
- **"Investigate Recent Incidents"** — Analyzes recent events and failures
- **"Plan Capacity Upgrade"** — Projects resource needs and recommends scaling

Each button opens the AI Assistant Panel with a pre-filled investigation focused on that goal.

#### 3.1.6 Dashboard Layout and Responsive Behavior

These new AI widgets integrate into the existing dashboard without overwhelming it:
- **Desktop:** AI summary appears prominently at the top, anomalies and predictions stack below existing metric cards
- **Mobile:** Widgets stack vertically in full-width cards
- **Responsiveness:** Widgets adapt to screen size; on small screens, detailed explanations collapse and can be expanded

The dashboard should feel like a holistic view of cluster health, with AI enhancements providing intelligence on top of existing metrics.

### 3.2 Resource List Pages (Pods, Deployments, Services, etc.)

Resource list pages show tables or card layouts of all resources of a type within a namespace or cluster. AI enhances these pages in several ways.

#### 3.2.1 AI Health Column

An optional new column in resource tables shows an AI health assessment for each resource. The column header shows a checkbox; users can toggle this column on/off based on preference.

**Column content:**
- **Health indicator dot:** A colored dot showing health status:
  - **Green:** Resource is healthy, no issues detected
  - **Yellow:** Resource has minor issues or warnings (frequent restarts, warnings in events, etc.)
  - **Red:** Resource has critical issues (failing, unable to start, resource exhaustion, etc.)
  - **Gray:** AI couldn't analyze the resource (not enough data, AI not configured, etc.)
- **Hover tooltip:** When the user hovers over the dot, a tooltip appears with brief explanation:
  - "Healthy" (green)
  - "3 restarts in last hour; check logs for errors" (yellow)
  - "CrashLoopBackOff; image pull failed" (red)

**Implementation note:** The health assessment is generated by AI but is lightweight enough to be displayed in a table cell. It's not a full investigation, but a quick health score.

**Caching:** Health scores are cached per resource with a short TTL (1-2 minutes), so the table doesn't become sluggish as it loads.

#### 3.2.2 Bulk Analysis Feature

A new button labeled "Analyze all resources" or "AI Bulk Analysis" appears above the table. Clicking this button triggers AI analysis of all visible resources in the list.

**During analysis:**
- A loading progress bar appears below the button showing progress (e.g., "Analyzing 23 of 45 resources...")
- As analysis completes for each resource, the AI health column updates with results
- Users can continue using the page; analysis happens in the background

**After analysis:**
- A summary appears: "Analysis complete. Found 3 critical issues, 7 warnings, 35 healthy resources"
- A button "View Issues" opens the AI Assistant Panel with a summary of findings
- Alternatively, the health column is now populated with visual indicators

This bulk analysis is especially useful for users who want a comprehensive health check of all resources in a namespace.

#### 3.2.3 Smart Filtering

The existing filter controls are enhanced with AI-powered filter suggestions. When the user clicks the filter dropdown or filter field, in addition to traditional filters (by label, status, namespace), they see AI-powered filter suggestions:

- **"Unhealthy resources":** Shows resources with issues detected by AI
- **"Recently restarted pods":** Shows pods that have restarted in the last N minutes (AI identifies the threshold)
- **"Overprovisioned deployments":** Shows deployments requesting more resources than they use
- **"High memory usage":** Shows resources using more than X% of their limit
- **"No resource requests/limits":** Shows resources without resource definitions

Users can click any suggestion to apply that filter instantly, or modify suggestions and save custom filters.

**Implementation:** These suggestions are generated by AI based on cluster state and patterns it detects. They're context-aware; for example, "Recently restarted pods" only appears on pod list pages, and "No resource requests/limits" only for deployments.

#### 3.2.4 Resource Grouping Suggestions

For list pages with many resources, AI can suggest logical groupings:
- **By service:** "These 8 pods all belong to the checkout service"
- **By application:** "These resources are all part of the payments application"
- **By status:** "Group by health status (healthy, warning, critical)"
- **By resource consumption:** "Group by memory usage (high, medium, low)"

These suggestions appear as a "Group by" dropdown, letting users reorganize the view intelligently.

#### 3.2.5 Context Menu Integration

Right-clicking on any resource row reveals the context menu with AI quick actions (see Section 2.4), allowing quick access to diagnosis and investigation directly from the list.

### 3.3 Resource Detail Pages

Every resource in Kubilitics has a detail page showing comprehensive information about that resource. AI enhancement of detail pages is substantial and varies by resource type.

#### 3.3.1 Pod Detail Page

Pods are fundamental to Kubernetes and one of the most frequently debugged resources. AI integration on pod detail pages is extensive.

**Pod page structure (existing):**
- Header: Pod name, namespace, status indicators
- Tabs: Overview, YAML, Events, Logs
- Overview tab: Containers, environment, mounts, resource allocation, events, metrics

**Pod page enhancements (AI integration):**

**New "AI Diagnosis" Tab:** Appears alongside existing tabs (Overview, YAML, Events, Logs). This tab contains AI-generated analysis of the pod.

Tab content includes:
- **Health assessment:** Top section showing overall pod health and any issues detected
- **Container analysis:** For each container in the pod:
  - AI summary of what the container does (inferred from image name, environment, or actual analysis)
  - Memory trend analysis: Is memory usage stable, growing, or spiking?
  - CPU pattern analysis: Is CPU usage consistent or variable?
  - Restart analysis: Has this container restarted? How many times? What's the pattern?
  - Any detected issues (memory leaks, CPU throttling, image pull errors, etc.)
- **Logs insight:** AI reads pod logs and highlights:
  - Error patterns detected
  - Warnings that might indicate problems
  - Count of error types: "24 'connection timeout' errors, 8 'permission denied' errors"
  - Recommended actions based on logs
- **Environmental factors:** AI analyzes environment variables and mounts:
  - Configuration issues (conflicting settings, incomplete configuration)
  - Security concerns (dangerous environment variables, world-readable mounts)
  - Missing dependencies (environment variable references that don't exist)
- **Restart analysis:** If the pod has restarted multiple times:
  - Timeline of restarts with timestamps
  - Pattern analysis: Is it restarting at regular intervals? Random intervals?
  - Probable root cause: OOMKill, CrashLoopBackOff, dependency failure, etc.
  - Recommendation: Increase memory, fix configuration, etc.
- **Related insights:** Links to related resources that might be relevant:
  - The deployment or daemonset that manages this pod
  - ConfigMaps and Secrets mounted in the pod
  - Services that route traffic to this pod
  - Events related to this pod

**Memory and CPU Insights:**
Below the basic metrics, AI provides:
- **Memory analysis:** "This container is using 450Mi out of 512Mi requested. The memory usage has been steadily increasing over the past hour. At the current rate, it will exceed the limit in approximately 3 hours, triggering an OOMKill."
- **CPU analysis:** "This container is using an average of 120m CPU. Requests are 100m, so it's being throttled. Consider increasing the request."

**Log Analysis Features:**
- **Error highlighting:** Lines in the log containing errors are highlighted in the AI tab (without showing full raw logs)
- **Error summaries:** "Found 47 error lines in the last 500 lines of logs:
  - 'Connection timeout' (23 occurrences)
  - 'Unable to reach database' (15 occurrences)
  - 'Permission denied' (9 occurrences)"
- **Severity indicators:** Errors are grouped by severity (critical, warning, info) and types
- **Recommended investigation:** "The 'Unable to reach database' errors suggest the database dependency is failing. Check if the database pod is running and check database pod logs."

**Logs tab enhancement:**
The existing Logs tab now includes AI features:
- **Intelligent scrolling:** When you open the logs tab for a pod with many logs, AI can summarize different sections and jump to interesting parts ("Jump to first error", "Jump to most recent activity")
- **Search assistance:** Natural language search within logs ("Show me lines related to database connection")
- **Pattern detection:** "These logs contain a repeating error pattern indicating a retry loop"

**Recommendations Widget:**
At the bottom of the AI Diagnosis tab, a "Recommended Actions" section shows:
- **Increase memory limit:** "Based on usage patterns, increase from 256Mi to 512Mi"
- **Investigate database connectivity:** "Multiple 'unable to reach DB' errors; check database pod and network policies"
- **Check image configuration:** "Failed to pull image multiple times; verify image URL and pull secrets"

Each recommendation includes an "Investigate" button that opens the AI Assistant Panel for deeper analysis.

#### 3.3.2 Deployment Detail Page

Deployments manage replica sets and pods. AI enhances the deployment detail page with understanding of rollout state, scaling patterns, and configuration best practices.

**Deployment page structure (existing):**
- Header: Deployment name, replicas, status, image version
- Tabs: Overview, YAML, Events, Related Resources
- Overview tab: Replica set history, pod list, strategy configuration

**New "AI Analysis" tab additions:**

**Rollout Analysis:**
- **Current rollout status:** AI explains the current deployment state in human language: "Deployment is rolling out version 1.23.5. 3 of 5 new replicas are ready. The rollout will be complete in approximately 2 minutes."
- **Rollout history analysis:** Shows previous rollouts and identifies patterns:
  - "Last 3 rollouts had increasing duration (5 min → 7 min → 10 min). Investigate why rollouts are slowing."
  - "This is the 5th rollout in the past 24 hours. Check if there's an automated trigger causing excessive deployments."
- **Rollout problems:** Identifies stuck or failing rollouts:
  - "Rollout is stuck. 2 pods are unable to start. Check pod logs for image pull errors."
  - "Rollout progressed 80% but stopped. Check pod status for CrashLoopBackOff or other failures."

**Scaling Recommendation:**
- **Current capacity analysis:** "Deployment has 3 replicas. Average pod load is approximately 2. One replica is underutilized."
- **Traffic-based recommendations:** "Based on request rates over the past 7 days, traffic peaks at 5 replicas needed and drops to 1. Consider HPA configuration or manual scaling."
- **Resource efficiency:** "Current replicas use 1.2Gi memory total. Estimated cost for this deployment: $X/month. Reducing to 2 replicas would save $Y while maintaining 99.9% availability."
- **Scaling action proposal:** If autonomy is enabled, AI may propose: "Scale to 5 replicas to meet peak demand" with an "Approve" button

**Configuration Review:**
- **Resource requests/limits:** "Requests are set correctly, but limits are very tight (256Mi memory). Recommend increasing to 512Mi to avoid evictions."
- **Liveness/readiness probes:** "Readiness probe timeout is 1 second. This is aggressive; pods take 5 seconds to be ready. Increase timeout to prevent constant restarting."
- **Image configuration:** "Using ':latest' tag which is not recommended. Recommend pinning to specific version '1.23.5' for reproducibility."
- **Environment configuration:** "Environment variable DB_URL is not set. This deployment expects a database connection but it's not configured."
- **Security analysis:** "Image runs as root. For security, consider using a non-root user."

**History Analysis:**
- **Rollout timeline:** "Shows a visual timeline of rollouts with timestamps and versions"
- **Pattern detection:** "This deployment is rolled out every 12 hours. This is a very frequent rollout schedule. Check if there's an automated CI/CD trigger."
- **Recommendations:** Based on history, AI suggests optimizations or identifies patterns

**Related Insights:**
- Links to the pods managed by this deployment
- Links to the ConfigMaps and Secrets used
- Links to the HPA if one is configured for this deployment
- Links to services that route traffic to this deployment

#### 3.3.3 Service Detail Page

Services provide stable network endpoints for groups of pods. AI enhances service detail pages with endpoint health analysis and traffic understanding.

**Service page structure (existing):**
- Header: Service name, type (ClusterIP, NodePort, LoadBalancer), cluster IP
- Tabs: Overview, YAML, Events, Related Resources
- Overview tab: Endpoints, selectors, ports, external traffic policy

**New "AI Analysis" tab content:**

**Endpoint Health Analysis:**
- **Current status:** "This service has 4 healthy endpoints from the 'payments' deployment. All endpoints are responding to health checks."
- **Endpoint distribution:** "Endpoints are distributed across 2 nodes. If node-2 fails, 50% of endpoints are lost. Consider spreading endpoints across 3 nodes for better resilience."
- **Endpoint problems:** "1 endpoint is not responding to health checks. The associated pod may be failing. Check pod logs."
- **Load distribution:** "Traffic is distributed roughly evenly across 4 endpoints, each receiving 25% of traffic. Load is balanced."
- **Recomm endpoints:** "Currently 4 endpoints. With peak traffic patterns, you need approximately 6 endpoints for 99.9% availability. Consider scaling the deployment."

**Traffic Pattern Analysis:**
- **Historical traffic:** Shows estimated traffic patterns based on request logs: "Traffic peaks at 500 requests/sec during 9am-5pm UTC, drops to 50 requests/sec overnight."
- **Current traffic:** "Current traffic: 120 requests/sec. This is moderate; endpoints have room for growth."
- **Predicted scaling:** "Based on growth trends, traffic will increase to 300 requests/sec within 30 days. Plan scaling accordingly."
- **Endpoint sizing:** "If each pod can handle 200 requests/sec and peak traffic is 500 requests/sec, you need at least 3 pods for 100% availability, or 2 pods for 60% availability. Current deployment has 2 pods."

**Network Topology Insights:**
- **Service dependencies:** "This service is referenced by 12 pods in the cluster making an average of 100 requests/sec."
- **Traffic sources:** "Traffic comes from these services/namespaces: checkout (60%), user-api (30%), internal-tools (10%)."
- **Routing analysis:** "Traffic is routed correctly. All endpoints are receiving requests."
- **Network policy analysis:** "1 network policy affects this service. It allows traffic from the checkout namespace only."

**Configuration Review:**
- **Service type:** "This service is type ClusterIP, but it's accessed from outside the cluster. Consider using LoadBalancer or Ingress."
- **Session affinity:** "Session affinity is not configured. Each request may route to a different pod. For stateful services, consider enabling session affinity."
- **Port configuration:** "Service exposes port 80 and 8080. Port 8080 is not receiving traffic; consider removing it."
- **External traffic policy:** "For NodePort services, local mode is recommended to preserve source IP and reduce hops. Current policy is 'Cluster'."

#### 3.3.4 Node Detail Page

Nodes are the physical (or virtual) infrastructure resources. AI enhances node detail pages with capacity planning and workload analysis.

**Node page structure (existing):**
- Header: Node name, status, capacity indicators
- Tabs: Overview, YAML, Events
- Overview tab: Status conditions, resource usage, pod list

**New "AI Analysis" tab content:**

**Capacity Planning:**
- **Current utilization:** "This node is 84% CPU utilized and 72% memory utilized. It has 16% CPU and 28% memory capacity remaining."
- **Utilization forecast:** "Based on pod scheduling trends, this node will reach CPU capacity in approximately 2 days and memory capacity in 5-7 days."
- **Scaling recommendation:** "Recommend adding a new node within the next 2 days to prevent resource exhaustion. The cluster is growing at an average rate of 12% per week."
- **Cost implications:** "Adding a node would cost approximately $X/month. Current trajectory suggests it's necessary."

**Workload Distribution:**
- **Pod placement efficiency:** "This node has 24 pods from 8 different deployments. Pod placement is well-distributed with no single deployment dominating."
- **Resource distribution:** "Pods on this node request a total of 4.8 CPUs (80% of node capacity) and 12Gi memory (75% of node capacity). Requests are balanced."
- **Fragmentation analysis:** "Memory allocation is fragmented; largest available chunk is 512Mi. This may prevent scheduling of pods requesting > 512Mi memory."
- **Recommendations:** "Consider rebalancing pods or adding a node to prevent scheduling failures."

**Workload Stacking:**
- **Critical workloads:** "This node has 3 pods from the payments-api deployment. If this node fails, payment processing is impacted. Consider spreading replicas across 3 nodes."
- **Dependency analysis:** "This node has 15 pods that depend on the database-primary pod (on node-1). Network latency to the database will affect all 15 pods."

**Drain Impact Analysis:**
If the user is considering draining this node for maintenance:
- **Pod count affected:** "Draining this node will evict 24 pods."
- **Workload impact:** "The payments-api deployment has 3 pods on this node. After drain, it will have 2 pods. This may impact availability during peak traffic."
- **Timing recommendation:** "Current traffic is low (50 requests/sec). Now is a good time to drain. Avoid draining during peak hours (9am-5pm UTC)."
- **Drain duration estimate:** "Based on pod startup times, the drain will take approximately 5-10 minutes. All pods will be back to ready state within 10 minutes."
- **Drain action proposal:** "Execute drain during low-traffic window? With one-click approval [Approve] [Cancel]"

**Hardware analysis:**
- **Node capacity specs:** "CPU: 8 cores, Memory: 32Gi, Storage: 100Gi"
- **Disk usage:** "Disk is 45% utilized. Growing at 2% per day. Will reach 90% in approximately 100 days."
- **Network analysis:** "No network saturation detected. Network bandwidth has room for growth."

#### 3.3.5 Other Resource Detail Pages

Every other resource type gets AI enhancements tailored to its function:

**ConfigMap and Secret Detail Pages:**
- **Usage analysis:** "This ConfigMap is referenced by 3 deployments (api-server, web-frontend, worker). Changes will affect all 3."
- **Data analysis:** "ConfigMap contains database connection settings, API keys (should be a Secret, not ConfigMap), and feature flags."
- **Impact assessment:** "If you delete this ConfigMap, the 3 dependent deployments will fail to start (they mount this ConfigMap)."
- **Recommendations:** "Move API keys to a Secret. Consider if all 40 keys are necessary; some might be unused."
- **Version history:** For Secrets, show when the secret was last updated and what changed

**PVC and PV Detail Pages:**
- **Capacity analysis:** "This PVC is 90% full (45Gi / 50Gi). Growth rate is 500Mi per day. It will reach 100% in approximately 10 days."
- **Storage recommendation:** "Increase size to 100Gi to provide 6 months of growth at current rate."
- **Reclamation policy:** "PVC reclaim policy is 'Delete'. Data will be lost if the PVC is deleted. Confirm this is intentional."
- **Performance analysis:** "PVC is on a slow storage class. If latency is an issue, consider migrating to faster storage."
- **Related workloads:** "This PVC is mounted by 2 statefulsets and 1 job. All are writing to it."

**HPA Detail Pages:**
- **Scaling behavior:** "HPA is scaling based on CPU > 80%. Current CPU is 45%. Deployment has 3 replicas (min: 2, max: 10)."
- **Scaling effectiveness:** "HPA has scaled up 4 times in the past week, scaling from 2 to 8 replicas. Scaling is reactive; consider increasing target CPU to reduce frequency."
- **Recommendation:** "Consider preemptive scaling based on time-of-day patterns. Traffic peaks at 9am and 2pm; scale up 30 minutes before peaks."
- **Effectiveness analysis:** "Scaling is working as configured, but consider if the target metric is optimal. Request-per-second might be a better metric than CPU."

**NetworkPolicy Detail Pages:**
- **Current policy:** Shows the policy rules in human language: "This policy allows ingress from pods in the checkout namespace on port 8080, and allows egress to any destination on port 443."
- **Impact analysis:** "This policy blocks traffic from 5 pods in other namespaces that are currently trying to access this workload. Some of these pods may be failing due to network policies."
- **Violation detection:** "This policy is blocking traffic from the monitoring system. Monitoring will not have metrics. Consider allowing monitoring traffic."
- **Recommendation:** "This policy is very restrictive. Verify it's intentional and that all necessary traffic is allowed."
- **Testing:** "Test this policy before deployment to verify it doesn't block legitimate traffic."

**RBAC Roles and ClusterRole Detail Pages:**
- **Permission analysis:** "This role grants the following permissions: get/list/watch pods, create/delete pods, get secrets."
- **Principle of least privilege:** "This role grants excessive permissions. ServiceAccount using this role can delete any pod. Recommend restricting to specific namespaces or resources."
- **Security concerns:** "This ClusterRole grants 'create secrets' permission, which is a significant security risk. Consider if this is necessary."
- **Usage:** "This role is used by 2 service accounts in the cluster. Both are for operational purposes."
- **Recommendations:** "Create a more restrictive role with only necessary permissions."

**Events Detail Page or Events List:**
- **Correlation:** "These events are correlated. Pod crash events, followed by HPA scale-up events, followed by new pod pending events. This indicates the pod is crashing, triggering scaling, but new pods can't be scheduled."
- **Timeline:** Shows a visual timeline of related events
- **Root cause:** AI analyzes event sequences to identify root causes: "Root cause: pod crash due to OOMKill → HPA scales up → insufficient memory to schedule new pods → cascading scale failures"
- **Recommendations:** "Increase memory limits to stop crashes, which will stop the scale cascade."

**CRD (Custom Resource Definition) Pages:**
- **Purpose:** AI explains what the custom resource does
- **Configuration analysis:** Shows whether the CRD is properly configured
- **Usage:** Shows which custom resources are defined and how many instances exist
- **Validation:** Shows whether the CRD has proper validation rules

### 3.4 Topology Page

The topology page shows resources as nodes in a graph, with edges representing relationships (service → pods, deployment → pods, etc.). This page is already a visualization; AI enhances it with interactive insights and analysis.

#### 3.4.1 AI-Enhanced Topology

**Topology visualization enhancements:**
- **Hover insights:** When the user hovers over any node in the topology graph, an AI insight tooltip appears showing:
  - Basic information (pod count, status for deployments; endpoint count for services, etc.)
  - Any detected issues (unhealthy pods, unbalanced load, etc.)
  - Health indicator (green/yellow/red dot)
- **Color coding:** Nodes are color-coded by health status, with AI contributing to the health assessment
- **Node sizing:** Node size can represent resource consumption, making resource usage visible at a glance
- **Edge labels:** Edges (connections) can be labeled with relationship type or traffic flow information

#### 3.4.2 Blast Radius Visualization

When the user selects a node or hovers over it with the right context, AI can show blast radius:
- **Visual highlighting:** Connected nodes are highlighted to show dependencies
- **Cascade indication:** If a service is deleted, all downstream services that depend on it are highlighted in red
- **Explanation:** A tooltip or sidebar shows: "If this service goes down, these 15 resources in the checkout and payment flows are affected. Estimated impact: 40% of cluster traffic."
- **Risk assessment:** "High risk. This service is a critical dependency. Ensure high availability."

Users can click a node and request "Show blast radius" to see the full dependency tree affected by that node.

#### 3.4.3 Dependency Analysis

AI analyzes the topology to identify and highlight:
- **Critical paths:** Nodes that are critical dependencies for many other resources. These are high-risk nodes that require careful management.
- **Circular dependencies:** If any exist (unusual in Kubernetes but possible with advanced setups), they're highlighted as potential issues.
- **Isolated nodes:** Resources that have no connections (either healthy resources that are standalone, or potentially orphaned resources)
- **Bottlenecks:** Services that have high traffic throughput; failure would impact many resources

The topology page can show a "Critical Paths" visualization highlighting the most important resource chains.

#### 3.4.4 Ask About Topology

A button or panel titled "Ask about topology" or "Investigate topology" allows users to ask questions about the topology:
- "Why is traffic not reaching my frontend service?"
- "Which resources would be affected if the database pod fails?"
- "Show me all dependencies of the payments service"
- "Are there any circular dependencies in my topology?"

These questions open the AI Assistant Panel with topology-focused investigation mode.

### 3.5 Settings Page — AI Configuration Section

The Settings page is where users configure various application settings. A new section is dedicated entirely to AI configuration, allowing users to set up AI integration and control how AI features behave.

#### 3.5.1 LLM Provider Selection

A dropdown or list showing available LLM providers:
- **OpenAI:** Requires API key, supports models like GPT-4, GPT-4 Turbo, GPT-3.5 Turbo
- **Anthropic:** Requires API key, supports Claude models (Claude 3 Opus, Claude 3 Sonnet, Claude 3 Haiku)
- **Ollama:** Open source, runs locally, requires URL (default localhost:11434)
- **Custom OpenAI-compatible:** For any LLM service with OpenAI-compatible API (e.g., custom Ollama instance, vLLM, LocalAI)
- **Other providers:** Additional providers can be added over time (Cohere, Mistral, etc.)

When the user selects a provider, the UI shows provider-specific configuration fields.

#### 3.5.2 API Key Input and Validation

For cloud-based providers (OpenAI, Anthropic):
- **API key input field:** A secure text input field (input type="password" or with show/hide toggle)
- **Show/hide toggle:** Button next to the input to show the key as plain text (for verification) or hide it
- **Validation indicator:** As the user types, the input shows:
  - Red indicator with "Invalid format" if the key doesn't match expected format
  - Yellow indicator with "Validating..." while checking with the provider
  - Green indicator with "Valid" once the key is confirmed valid
- **Save behavior:** Key is saved to persistent storage (localStorage, IndexedDB, or backend secure storage)
- **Secure display:** After saving, the key is not displayed in plain text; instead a masked version is shown (e.g., "sk-...7j3k")
- **Clear button:** Button to clear the saved key and set it again

#### 3.5.3 Model Selection

A dropdown populated with available models from the selected provider:
- **For OpenAI:** Shows available models (gpt-4, gpt-4-turbo, gpt-3.5-turbo, etc.) with pricing information and capability descriptions
- **For Anthropic:** Shows Claude models with pricing and information
- **For Ollama:** Shows models available in the local Ollama instance, auto-discovered from the configured URL
- **Model details:** Selecting a model shows:
  - Price per token (if applicable)
  - Estimated monthly cost based on cluster analysis (Kubilitics can estimate token usage)
  - Context window size
  - Capabilities (ability to process images, long contexts, etc.)
  - Recommended use cases

Users should select the most capable model their budget allows, as better models provide better analysis.

#### 3.5.4 Ollama Configuration

If the user selects Ollama as the provider:
- **Ollama URL input:** Text field with default value "http://localhost:11434"
- **Model discovery:** "Discover models" button that:
  - Connects to the Ollama instance at the provided URL
  - Fetches the list of installed models
  - Populates the model dropdown with discovered models
  - Shows an error if Ollama is not running or not reachable
- **Model management:** Link to Ollama documentation for installing and managing models locally

Ollama allows users to run AI locally without sending data to cloud providers, which may be important for some organizations.

#### 3.5.5 Token Budget Configuration

Users can set limits on token usage to control costs:

**Monthly token limit:**
- Text input field for the maximum number of tokens allowed per month
- Default: No limit (unlimited)
- Display: Current month's token usage and remaining tokens
- Progress bar: Visual indicator of usage relative to limit
- Alert: If usage exceeds 80% of limit, show a warning

**Daily token limit (optional):**
- Text input for a daily hard limit
- Useful for controlling usage spikes
- When daily limit is reached, AI features are disabled until the next day
- Users should be warned before reaching the limit

**Cost estimation:**
- Based on the selected model and pricing, show estimated monthly cost if current usage continues
- Example: "At current usage (500 tokens/day), estimated monthly cost: $X"

#### 3.5.6 Autonomy Level Configuration

A slider controlling how autonomously AI can take actions without explicit user approval:

**Slider levels (1-5):**

**Level 1 - "Recommend Only":**
- AI never takes actions
- AI only makes observations and recommendations
- User must approve every action
- Safest mode, requires most manual interaction

**Level 2 - "Low Risk Only":**
- AI can take safe actions that don't modify resources:
  - Create/modify labels and annotations
  - Restart individual pods (with approval for critical workloads)
- User must approve risky actions:
  - Scaling deployments
  - Modifying configurations
  - Deleting resources
- Default mode, balances automation with safety

**Level 3 - "Medium Autonomy":**
- AI can take moderate-risk actions:
  - Scale deployments up to 50% of max replicas
  - Modify resource requests/limits within reason
  - Restart deployments
- User must approve:
  - Deletion of resources
  - Modifications to RBAC or network policies
  - Large scaling changes

**Level 4 - "High Autonomy":**
- AI can take most actions:
  - Scale deployments
  - Modify configurations
  - Perform remediation actions
- User must approve only:
  - Deletion of resources
  - Major topology changes (e.g., deleting services)

**Level 5 - "Full Autonomy":**
- AI can take any action it recommends
- Least safe mode, most automated
- User can still reject proposed actions after the fact (if it's allowed, like undoing a scale action)
- Only recommended for very confident, experienced users

For each level, the UI shows a description of what actions AI can take autonomously.

#### 3.5.7 Safety Policies

Checkboxes for safety rules that AI should follow regardless of autonomy level:

**Production namespace protection:**
- If checked: AI never takes risky actions in production namespace without explicit approval
- Example: Won't scale down production deployments even at autonomy level 5

**Never delete without approval:**
- If checked: AI never deletes resources; always requires approval
- Recommended to leave this enabled

**Replica scaling limits:**
- If checked: AI never scales a deployment beyond a safe range (e.g., max 10x current replicas)
- Prevents accidental massive scaling

**Resource modification limits:**
- If checked: AI never increases resource limits by more than 2x or decreases by more than 50% without approval
- Prevents wild resource modifications

**Network policy changes:**
- If checked: AI never modifies NetworkPolicies; always requires approval
- NetworkPolicy changes can break applications, so caution is warranted

**RBAC modification limits:**
- If checked: AI never grants new permissions to service accounts; always requires approval

These toggles help users set up safety guardrails appropriate for their organization's risk tolerance.

#### 3.5.8 AI History Management

**Clear investigation history:**
- Button to clear all investigation history
- Confirmation dialog: "Clear all investigations? This cannot be undone."
- After clearing, the AI Assistant history sidebar is empty
- Users can still use AI; it just won't have access to past investigations

**Export history (optional):**
- Button to download all investigation history as a JSON file or Markdown document
- Useful for sharing findings with colleagues or archiving

**Privacy settings:**
- Toggle: "Don't store sensitive data in history"
- When enabled, sensitive information (API keys, database passwords, etc.) in responses are not stored
- AI investigations still work normally; the history just doesn't retain sensitive details

#### 3.5.9 Test Connection

**Test Connection button:**
- Validates that the AI configuration is correct
- Runs a simple test query to the AI service
- Shows a loading indicator while testing
- Results:
  - Success: "Connected successfully. Model: GPT-4. Tokens available: Unlimited"
  - Failure: Shows specific error (API key invalid, service unreachable, etc.) with suggestions for fixing

This button helps users verify their configuration before relying on AI features.

#### 3.5.10 Settings Page Layout

The AI Settings section should be organized logically:
1. **Provider Configuration** (provider, API key, model selection)
2. **Ollama Configuration** (if Ollama is selected)
3. **Usage and Limits** (token budget, cost estimation)
4. **Autonomy and Safety** (autonomy level, safety policies)
5. **Data and Privacy** (history management, privacy settings)
6. **Validation** (test connection button)

Each section should be clearly labeled with a description of what it controls. Settings should save automatically or have a clear "Save" button, with confirmation that changes were saved.

---

## Section 4: State Management for AI

The application needs a dedicated Zustand store to manage all AI-related state. This store maintains global state for AI configuration, ongoing investigations, insights, and usage tracking.

### 4.1 useAIStore Structure

The `useAIStore` is a new Zustand store created in `src/stores/useAIStore.ts` that manages:

**Configuration state:**
- `provider`: Current LLM provider (enum: 'openai' | 'anthropic' | 'ollama' | 'custom')
- `apiKey`: Encrypted/hashed API key (never stored in plain text in localStorage)
- `modelName`: Selected model (string, e.g., "gpt-4")
- `ollamaUrl`: Ollama instance URL if using Ollama
- `isConfigured`: Boolean indicating if AI is properly configured and ready to use
- `autonomyLevel`: Integer 1-5 controlling autonomous action level
- `safetyPolicies`: Object containing boolean flags for each safety policy

**Status state:**
- `status`: AI connection status (enum: 'not-configured' | 'connecting' | 'ready' | 'degraded' | 'error')
- `statusMessage`: Human-readable explanation of current status
- `lastHealthCheck`: Timestamp of last successful connection test
- `isHealthy`: Boolean indicating if AI is currently operational

**Investigation state:**
- `currentInvestigation`: Object containing active investigation details:
  - `id`: Unique investigation ID
  - `title`: User's initial question or investigation title
  - `status`: (enum: 'starting' | 'in-progress' | 'complete' | 'failed')
  - `messages`: Array of messages in this investigation (user messages and AI responses)
  - `resourceContext`: Object with resource type and ID if investigation is focused on a resource
  - `startTime`: Timestamp when investigation started
  - `steps`: Array of investigation steps (if in multi-step mode) with status and findings
- `previousInvestigations`: Array of past investigations (last 50 or 30 days) with metadata for history

**Insights state:**
- `insights`: Object with resource IDs as keys, mapping to arrays of insights for that resource
- `insightCache`: Store of generated insights with TTL, allowing quick retrieval of cached insights
- `insightGenerationStatus`: Map of resource ID to generation status ('idle' | 'generating' | 'complete' | 'error')

**Token usage state:**
- `tokenUsage`: Object containing:
  - `currentMonth`: Tokens used in current month
  - `daily`: Tokens used today
  - `monthlyLimit`: Configured monthly limit (0 for unlimited)
  - `dailyLimit`: Configured daily limit (0 for unlimited)
  - `lastResetDate`: Date of last monthly/daily reset
- `estimatedMonthlyCost`: Calculated cost based on tokens and model pricing
- `tokenTrend`: Array of daily token usage for the past 30 days (for graphing)

**WebSocket connection state:**
- `wsConnection`: Reference to active WebSocket connection
- `wsConnected`: Boolean indicating if WebSocket is connected
- `wsReconnectAttempts`: Number of reconnection attempts
- `wsLastError`: Error message from last WebSocket failure

**UI state:**
- `isPanelOpen`: Boolean indicating if AI Assistant Panel is open
- `panelMode`: Current mode of the panel (enum: 'chat' | 'investigation' | 'insights' | 'settings')
- `selectedHistoryItem`: Currently selected item from investigation history (or null)

### 4.2 Store Actions

The store should provide these main action creators:

**Configuration actions:**
- `setProvider(provider)`: Set the LLM provider
- `setApiKey(key)`: Store the API key securely
- `setModelName(model)`: Set the selected model
- `setOllamaUrl(url)`: Set Ollama URL
- `setAutonomyLevel(level)`: Set autonomy level (1-5)
- `setSafetyPolicy(policyName, enabled)`: Enable/disable a specific safety policy
- `resetConfiguration()`: Clear all AI configuration

**Status actions:**
- `setStatus(status, message)`: Update AI status
- `checkHealth()`: Async action that tests AI connection
- `clearError()`: Clear error status

**Investigation actions:**
- `startInvestigation(title, resourceContext?)`: Begin a new investigation
- `addMessage(role, content)`: Add a message to current investigation
- `completeInvestigation()`: Mark investigation as complete
- `failInvestigation(reason)`: Mark investigation as failed
- `clearCurrentInvestigation()`: Clear active investigation without saving
- `saveInvestigation()`: Save current investigation to history
- `selectHistoryItem(id)`: Load a past investigation
- `clearHistory()`: Delete all investigation history

**Insight actions:**
- `setInsights(resourceId, insights)`: Update insights for a resource
- `getInsights(resourceId)`: Retrieve cached insights for a resource
- `invalidateInsights(resourceId)`: Mark insights as expired for a resource
- `setInsightGenerationStatus(resourceId, status)`: Update generation status

**Token actions:**
- `trackTokenUsage(tokensUsed)`: Add tokens to current usage
- `resetDailyUsage()`: Called daily to reset daily token counter
- `resetMonthlyUsage()`: Called monthly to reset monthly token counter
- `setTokenLimits(monthly, daily)`: Update token limits
- `recordTokenTrend()`: Record current daily usage for trending

**WebSocket actions:**
- `connectWebSocket()`: Establish WebSocket connection to kubilitics-ai
- `disconnectWebSocket()`: Close WebSocket connection
- `handleWebSocketMessage(message)`: Process incoming WebSocket messages
- `reconnectWebSocket()`: Attempt to reconnect after failure

**UI actions:**
- `togglePanel()`: Open/close AI Assistant Panel
- `setPanelMode(mode)`: Change panel display mode
- `selectHistoryItem(id)`: Load an investigation in the panel

### 4.3 Persistence and Hydration

The store uses Zustand's middleware for persistence:

**Persisted data:**
- Configuration (provider, model, autonomy level, safety policies)
- Investigation history
- Suppressed insight types
- Token usage trends
- User preferences (panel position, theme)

**Non-persisted data:**
- Current investigation state (lost on page refresh)
- Real-time status
- WebSocket connection status

**API key handling:**
The API key is a sensitive piece of data. Options for storage:
1. **Memory only:** Store key in memory, lose on refresh (most secure but least convenient)
2. **localStorage with encryption:** Encrypt the key before storing in localStorage (medium security, convenient)
3. **Backend storage:** Send key to backend for secure storage, don't store on client (most secure but requires backend work)

Recommended approach: Store encrypted in localStorage with the encryption key derived from user's browser. On app load, decrypt to memory. On logout, clear memory.

### 4.4 Selectors and Computed Values

Zustand allows creating selectors to compute derived values:

**Key selectors:**
- `selectIsAIConfigured()`: Boolean, is AI ready to use?
- `selectAIStatus()`: Current status with message
- `selectCurrentInvestigationTitle()`: Title of active investigation
- `selectTokenUsagePercent()`: Current monthly usage as percentage
- `selectIsTokenLimitExceeded()`: Boolean, are we over quota?
- `selectResourceInsights(resourceId)`: Get insights for a specific resource
- `selectHistoryCount()`: How many past investigations?
- `selectEstimatedCost()`: Estimated monthly cost

### 4.5 Integration with API Client

The store integrates with the AI API client (see Section 5) to:
- Trigger API calls for investigations
- Handle streaming responses and update store in real-time
- Track token usage reported by API
- Update status based on API health
- Manage WebSocket connections for streaming responses

When the API client receives a streaming token, it dispatches store actions to add the token to the current investigation's response. This allows real-time UI updates as tokens arrive.

---

## Section 5: AI Communication Layer

The application communicates with the kubilitics-ai service on port 8081 using REST API and WebSocket. A dedicated API client handles all AI-related communication.

### 5.1 New API Client: aiApiClient

A new file `src/api/aiApiClient.ts` provides functions for all AI-related API calls. This client follows the same patterns as the existing `apiClient.ts` but is specialized for AI communication.

### 5.2 REST Endpoints

The AI client implements these REST endpoint calls:

**Configuration endpoints:**

`POST /api/v1/ai/config/validate` - Validate AI configuration
- Request: { provider, apiKey, modelName, ollamaUrl }
- Response: { valid: boolean, message: string, remainingQuota?: number }
- Used by: Settings page test connection button

`GET /api/v1/ai/config/models` - Get available models for a provider
- Query: { provider }
- Response: Array of model objects with { name, displayName, pricing, contextWindow, capabilities }
- Used by: Settings provider selection

`POST /api/v1/ai/config/ollama-models` - Discover models from Ollama instance
- Request: { url }
- Response: Array of model names available in Ollama
- Used by: Ollama configuration

**Investigation endpoints:**

`POST /api/v1/ai/investigations/start` - Begin an investigation
- Request: { title, resourceType?, resourceId?, namespace? }
- Response: { investigationId: string, status: string }
- Used by: AI Assistant Panel, quick actions, insight "Investigate" buttons

`POST /api/v1/ai/investigations/{id}/message` - Send a message in an investigation
- Request: { role: 'user' | 'assistant', content: string }
- Response: Not used (streaming response returned via WebSocket)
- Used by: AI Assistant Panel input

**Insight endpoints:**

`GET /api/v1/ai/insights/{resourceType}/{resourceId}` - Get AI insights for a resource
- Response: Array of insight objects with { id, title, insight, confidence, severity, timestamp }
- Used by: Resource detail pages loading insights
- Cached: Yes, with TTL-based invalidation

`POST /api/v1/ai/insights/{resourceType}/{resourceId}/dismiss` - Dismiss an insight
- Request: { insightId }
- Response: { success: boolean }
- Used by: Insight card dismiss button

**Analysis endpoints:**

`POST /api/v1/ai/analysis/bulk` - Analyze multiple resources
- Request: { resourceType, namespace?, limit?: number }
- Response: { investigationId, count, progressEndpoint }
- Used by: Resource list "Analyze all" button

`GET /api/v1/ai/analysis/{investigationId}/progress` - Poll for bulk analysis progress
- Response: { complete: number, total: number, issues: [...], status: 'in-progress' | 'complete' }
- Used by: Polling during bulk analysis

**Search endpoints:**

`POST /api/v1/ai/search` - Natural language search
- Request: { query: string, resourceType?: string, namespace?: string }
- Response: { interpretation: string, results: [...], confidence: number }
- Used by: Global search bar with natural language

**Token usage endpoint:**

`GET /api/v1/ai/usage` - Get token usage
- Response: { currentMonth: number, today: number, monthlyLimit: number, lastReset: date }
- Used by: Settings page, header status bar

### 5.3 WebSocket/SSE for Streaming

For long-running operations and streaming responses, the client uses WebSocket or Server-Sent Events (SSE):

**WebSocket connection:**
- Endpoint: `wss://kubilitics-backend:8081/ws/ai`
- Authenticated: Include auth token in connection header
- Purpose: Bidirectional streaming for investigations

**Message format (investigation response streaming):**
```
{
  "type": "investigation-response",
  "investigationId": "inv_123",
  "delta": "The ",  // Streamed token
  "messageId": "msg_456",
  "isComplete": false
}
```

Final message:
```
{
  "type": "investigation-response",
  "investigationId": "inv_123",
  "delta": null,
  "messageId": "msg_456",
  "isComplete": true,
  "tokensUsed": 487,
  "metadata": { ... }
}
```

**Server-sent events (alternative to WebSocket):**
If WebSocket is not feasible, SSE can be used for streaming:
- Endpoint: `GET /api/v1/ai/investigations/{id}/stream`
- Streaming format: Standard server-sent events

### 5.4 Error Handling

The AI client implements comprehensive error handling:

**Network errors:**
- No connection to AI service: Graceful fallback, show "AI service unavailable" message
- Timeout: Retry with exponential backoff up to 3 times
- 5xx server errors: Retry with falloff

**API errors:**
- 401 Unauthorized: Invalid or expired API key, prompt to reconfigure
- 403 Forbidden: API key lacks permissions or quota exceeded
- 400 Bad request: Log error, show user-friendly message

**Validation errors:**
- Invalid query format: Show helpful error message and suggestion
- Missing required fields: Catch client-side before API call

**Streaming errors:**
- WebSocket disconnect during streaming: Attempt to reconnect and resume
- Partial response: Still consider investigation complete, but note that response was truncated

The client should implement retry logic with exponential backoff:
1. First retry: 1 second
2. Second retry: 2 seconds
3. Third retry: 4 seconds
4. Then give up and show error to user

### 5.5 Request Queuing

To prevent overwhelming the AI service with concurrent requests, the client implements a request queue:

**Queue behavior:**
- Multiple investigations can be in progress (user-initiated in different tabs)
- But bulk analysis requests queue behind other requests
- Very high priority: Direct user questions in the AI panel
- High priority: Quick action investigations
- Normal priority: Resource list bulk analysis
- Low priority: Background insight generation

**Queue size limits:**
- Max 3 concurrent user-initiated requests
- Max 1 bulk analysis in progress
- Background insight generation is throttled (max 1 per resource per 5 minutes)

This prevents the client from overwhelming the backend with requests.

### 5.6 Token Tracking

Every successful API call returns token usage information:

**Response header:**
```
X-Tokens-Used: 487
X-Tokens-Remaining: 9513
```

The client extracts this and:
1. Calls `trackTokenUsage()` in the AI store
2. Updates the status indicator with remaining tokens
3. Checks if monthly/daily limits are exceeded
4. Disables AI features if limits are reached

### 5.7 Caching Strategy

The client implements smart caching to reduce API calls:

**Insight caching:**
- Insights for a resource are cached with TTL based on resource type:
  - Stable resources (ConfigMaps, old ReplicaSets): 30 minutes
  - Dynamic resources (Pods, running deployments): 5 minutes
- Cache key: `${resourceType}:${resourceId}`
- Invalidated when: Resource state changes, user navigates to resource detail, resource events occur

**Search result caching:**
- Search queries are cached for 10 minutes
- Cache key: sha256(query)
- Useful if user searches for the same thing multiple times

**Configuration caching:**
- Provider models list cached for 1 hour
- Ollama models list cached for 5 minutes (refreshed frequently in case models are added)

---

## Section 6: AI Component Library (src/components/ai/)

The AI components are organized in the `src/components/ai/` directory. Each component is focused, reusable, and follows the application's design patterns.

### 6.1 Component Overview

**Core components:**

`AIAssistantPanel.tsx` - Main sliding chat interface
- Manages the full panel lifecycle
- Contains chat history, input field, and response area
- Handles context awareness and message display
- Integrates with the investigation history sidebar

`AIAssistantPanel/` directory:
- `ChatArea.tsx` - Renders conversation messages
- `InputArea.tsx` - User input field with send button
- `HistorySidebar.tsx` - Investigation history list
- `ContextIndicator.tsx` - Shows current resource context

`AIInsightCard.tsx` - Individual insight card
- Displays title, insight text, confidence, severity
- Handles dismiss and investigate actions
- Shows loading skeleton while insights are generating

`AIStatusBadge.tsx` - Header status indicator
- Shows AI status with color and text
- Clickable for quick settings access
- Displays token usage and provider info

`AIConfigurationForm.tsx` - Settings page form
- Provider selection dropdown
- API key input with validation
- Model selection
- Autonomy level slider
- Safety policy checkboxes
- Test connection button

`AIInvestigationTimeline.tsx` - Multi-step investigation progress
- Shows numbered steps in an investigation
- Indicates completion status of each step
- Allows expanding steps to see details
- Clickable to ask follow-up questions on a step

`AIActionProposal.tsx` - Action approval interface
- Shows proposed action with explanation
- "Approve" and "Reject" buttons
- "Explain more" or "Modify" buttons for refinement
- Shows autonomy level and safety policy constraints

`AIStreamingResponse.tsx` - Real-time token rendering
- Renders tokens as they arrive from WebSocket
- Handles markdown formatting
- Renders embedded charts and resource links
- Shows "Thinking..." indicator before first token

`AIConfidenceIndicator.tsx` - Visual confidence display
- Shows percentage with visual indicator (gauge, bar, etc.)
- Text label ("High confidence", "Speculative", etc.)
- Color coded based on confidence level

`AIResourceHealthDot.tsx` - Small health indicator
- Colored dot showing resource health
- Hover tooltip with brief explanation
- Used in resource tables and list views

`AIQuickActionMenu.tsx` - Context menu with AI actions
- Integrates with existing context menu
- Shows AI actions with icons
- Triggers appropriate panel modes

`AINaturalLanguageSearch.tsx` - Enhanced search input
- Replaces or extends global search bar
- Shows AI search vs exact search
- Renders results in appropriate format

`AIEmptyState.tsx` - "Configure AI" placeholder
- Shows when AI is not configured
- Link to settings with explanation
- Graceful fallback for missing configuration

`AILoadingState.tsx` - Skeleton and shimmer states
- Insight card skeleton
- Investigation timeline skeleton
- Generic loading placeholders

`AIErrorBoundary.tsx` - Error handling wrapper
- Catches AI component errors
- Shows user-friendly error message
- Prevents errors from breaking entire app
- Logs errors for debugging

`AITokenUsageBar.tsx` - Budget visualization
- Shows used vs limit visually
- Percentage and actual numbers
- Color warning when approaching limit

`AIAutonomySlider.tsx` - Autonomy level selector
- Interactive slider (1-5)
- Shows description of current level
- Instant feedback as user adjusts

`AIInvestigationHistory.tsx` - Collapsible history panel
- Renders history sidebar
- Searchable history list
- Options menu for each item

`AIResourceLinks.tsx` - Renders linked resource references
- Clickable links to resources mentioned in AI responses
- Shows resource type icon
- Navigates to resource detail page on click

`AIMetricChart.tsx` - Embedded metric visualization
- Sparklines for single metrics
- Bar charts for comparisons
- Time series for trends
- Gauge charts for utilization

`AIExplanationPanel.tsx` - Detailed explanation view
- Shows expanded explanation of AI recommendations
- Used in modals or expanded views
- Includes supporting data and reasoning

### 6.2 Component Props and Interfaces

Each component is defined with clear TypeScript interfaces for its props. Examples:

```typescript
interface AIAssistantPanelProps {
  isOpen: boolean;
  onClose: () => void;
  resourceType?: string;
  resourceId?: string;
}

interface AIInsightCardProps {
  insight: AIInsight;
  resourceType: string;
  resourceId: string;
  onDismiss: (insightId: string) => void;
  onInvestigate: () => void;
  isLoading?: boolean;
}

interface AIStatusBadgeProps {
  status: AIStatus;
  message?: string;
  onClick: () => void;
  tokenUsage?: { current: number; limit: number };
}
```

### 6.3 Styling Consistency

All AI components follow the application's design system:
- Use Tailwind CSS for styling (no CSS-in-JS or external stylesheets)
- Use Lucide icons for all iconography
- Follow existing color palette and spacing
- Use application's typography settings
- Responsive design using Tailwind breakpoints
- Dark mode support (if application supports it)

AI components use subtle visual cues to indicate they're powered by AI:
- Subtle sparkle or brain icon in component headers
- Slightly different background tint (if applicable)
- AI branding in status indicators
- Confidence and severity indicators throughout

### 6.4 Accessibility

Every AI component implements accessibility best practices:
- Semantic HTML (use appropriate elements)
- ARIA labels for interactive elements
- Keyboard navigation support
- Screen reader friendly
- Color not the only indicator (use text labels and icons)
- High contrast for text
- Focus indicators for keyboard navigation

**Specific requirements:**
- `AIAssistantPanel` is keyboard navigable (Tab to next element, Shift+Tab previous, Enter to select, Escape to close)
- `AIInsightCard` has accessible buttons (proper labels, focus states)
- `AIStatusBadge` has descriptive title attribute
- `AIConfidenceIndicator` includes text label, not just color
- All modals have proper focus management

### 6.5 Performance Optimizations

AI components are optimized to prevent performance regressions:

**Code splitting:**
- AI components are lazy-loaded (only imported when needed)
- Component bundle is separate from main app bundle
- Loads only when AI is configured

**Memoization:**
- Components that receive complex props are memoized (React.memo)
- Prevents unnecessary re-renders

**Virtual scrolling:**
- Investigation history with many items uses virtual scrolling
- Long message lists use virtual scrolling

**Streaming optimization:**
- Streaming responses render incrementally, not in one update
- Large response rendered in chunks to prevent blocking UI

**Insight generation:**
- Runs in background without blocking main thread
- Uses web workers if heavy computation is needed
- Debounced to prevent excessive analysis

---

## Section 7: Responsive Design & Mobile Considerations

The AI integration maintains full responsiveness across device sizes while adapting to mobile's unique constraints.

### 7.1 Mobile AI Assistant Panel

On mobile screens (< 768px width), the AI Assistant Panel adapts:

**Desktop behavior:**
- Panel slides in from right side
- Fixed width (350-400px)
- Main content remains visible behind panel
- Multiple windows can coexist

**Mobile behavior:**
- Panel expands to full-screen modal
- Slides up from bottom or covers entire screen
- Takes 100% of available width and height
- Cannot keep main content visible
- Only one modal at a time

**Mobile-specific UI:**
- Close button is prominent and easy to tap
- Input area is optimized for mobile keyboards (stays above keyboard)
- Message text is larger for readability
- Buttons are larger (minimum 44x44 point touch target)
- Horizontal scrolling is prevented

### 7.2 Insight Cards on Mobile

On mobile, insight cards adapt:

**Desktop:**
- Cards appear in a sidebar or dedicated insights section
- Multiple cards visible simultaneously
- Horizontal layout possible

**Mobile:**
- Cards stack vertically
- Full width of screen (with padding)
- Swipeable to dismiss or dismiss button
- One card prominently displayed at a time
- Navigation between cards (arrows or dots)

### 7.3 Touch Interactions

Mobile-specific touch affordances:

**Long-press context menu:**
- On mobile, long-pressing a resource row shows context menu
- Menu includes AI quick actions
- Resolves the hover/click distinction that doesn't work on touch

**Swipe gestures (optional):**
- Swipe left on insight card to dismiss
- Swipe left on investigation history item to see options menu
- Swipe down on modal to close

**Tap target sizing:**
- All buttons and interactive elements are at least 44x44 points
- Prevents accidental mis-taps

### 7.4 Reduced AI Features on Mobile

Some resource-intensive AI features are reduced or disabled on mobile:

**Disabled on mobile:**
- Topology page AI overlays (hover tooltips don't work on mobile)
- Real-time chart rendering in responses (too much data)
- Bulk resource analysis (can cause UI stuttering)
- Some streaming features (causes keyboard flickering)

**Adapted on mobile:**
- Navigation is simplified (less nested information)
- Charts are smaller or simplified
- Long explanations are truncated with "Read more" buttons
- Multi-step investigation timeline is condensed

### 7.5 Push Notification UI for AI Alerts

On mobile, AI alerts can be delivered as push notifications:

**When enabled:**
- User grants browser notification permission
- Critical AI alerts appear as push notifications
- Example: "Pod restart storm detected in production namespace"
- Clicking notification opens the AI panel focused on that alert

**Notification content:**
- Brief title (fits mobile notification)
- Alert badge showing severity
- Link to investigate further
- Action buttons (Approve/Reject for time-sensitive actions)

### 7.6 Mobile Network Optimization

Mobile networks are often slower/less reliable:

**Optimizations:**
- Larger batch requests (fewer requests, more data per request)
- Request compression enabled
- Reduce real-time updates (poll less frequently)
- Queue investigations during network outages
- Cache more aggressively on mobile
- Reduce image sizes in charts
- Disable animations on slower connections

---

## Section 8: Accessibility & UX Standards

Accessibility is not an afterthought; it's built into every component and interaction.

### 8.1 Screen Reader Support

All AI features are fully accessible via screen reader:

**Semantic HTML:**
- Use proper heading hierarchy (h1, h2, h3)
- Use semantic elements (nav, main, section, article)
- Use button elements for buttons, not divs styled as buttons

**ARIA labels:**
- `AIAssistantPanel` has aria-label="AI Assistant Chat Panel"
- Status indicator has aria-label="AI Status: Ready"
- Insight cards have aria-label describing the insight
- Buttons have descriptive aria-labels if icon-only

**Live regions:**
- Streaming responses use aria-live="polite" so screen readers announce new tokens
- Investigation progress updates use aria-live="assertive" for important updates
- Insight card loading uses aria-busy="true" to indicate loading state

**Descriptions:**
- Complex visualizations have aria-describedby linking to text descriptions
- Charts have accessible tables as alternatives

### 8.2 Keyboard Navigation

All AI features are fully keyboard navigable:

**Global shortcuts:**
- Cmd+K (Mac) / Ctrl+K (Windows/Linux): Open AI Assistant Panel
- Esc: Close AI Assistant Panel or modal
- Tab: Navigate to next interactive element
- Shift+Tab: Navigate to previous interactive element
- Enter: Activate button or link, send message in chat

**AI Panel navigation:**
- Tab moves focus through history items, then to main chat area, then to input field
- Arrow keys can navigate history items (up/down)
- Inside chat area, arrow keys can navigate messages
- Shift+Tab reverses navigation

**Insight cards:**
- Tab to reach card
- Arrow keys navigate between multiple insight cards
- Enter or Space activates "Investigate" button
- Enter on "Dismiss" dismisses the card

**Settings:**
- Tab navigates through all form fields
- Space toggles checkboxes
- Arrow keys adjust sliders
- Tab focus is always visible

### 8.3 High Contrast and Color Blindness

Colors are never the only indicator:

**Confidence indicators:**
- Not just "green means high confidence"
- Include text labels: "92% confident"
- Use different shapes or patterns in addition to color

**Severity indicators:**
- Not just "red means critical"
- Include text labels: "Critical", "Warning", "Info"
- Use different icons for each severity level

**Status indicators:**
- AI status not just shown by dot color
- Always includes text label: "Ready", "Error", etc.
- Icons include visual distinction beyond color

**High contrast mode:**
- All text meets WCAG AA contrast ratio (4.5:1 for normal text)
- Borders and UI elements are visible in high contrast
- No text with color being the only distinguisher

### 8.4 Loading and Error States

Loading states use accessible patterns:

**Loading states (avoid "loading..."):**
- Use semantic `aria-busy="true"` on loading container
- Show skeleton UI (shimmer animation) instead of spinner
- Skeleton UI uses high contrast placeholder blocks
- Screen readers understand skeleton represents loading content

**Error messages:**
- Human-readable, non-technical language
- Screen readers announce errors (role="alert")
- Error messages link to help documentation
- Errors suggest next steps for recovery

**Empty states:**
- Clear message explaining why there's no content
- Link to next action ("Enable AI in settings")
- Not just empty space

### 8.5 Focus Management

Proper focus management across all interactions:

**Panel opening:**
- When AI panel opens, focus moves to close button or chat input
- Trap focus inside panel (Tab stays within panel)
- When panel closes, focus returns to triggering element

**Modal dialogs:**
- Focus moves to modal on open
- Focus trapped inside modal
- Escape key closes and restores focus
- Focus moves to the most relevant element (usually "primary" button)

**Toast notifications:**
- When new investigation completes, aria-live announces it
- User can tab to notification and interact with it

---

## Section 9: Performance Considerations

AI features are added without degrading application performance.

### 9.1 Code Splitting and Lazy Loading

AI components are not loaded until needed:

**Lazy loading strategy:**
- AI component library is in a separate chunk
- Chunk only loads when user enables AI (when API key is configured)
- Global AI components (panel, status badge) load on demand
- Resource-specific AI features (insights, tabs) load with the resource

**Implementation:**
- Use React.lazy() and Suspense for component code-splitting
- Use dynamic imports for the AI API client
- Use webpack code-splitting with meaningful chunk names

**Benefit:**
- For users not using AI, no AI code is downloaded
- Faster initial page load
- Smaller JavaScript bundle

### 9.2 Store Optimization

The Zustand store is optimized to prevent unnecessary re-renders:

**Selector specificity:**
- Components use specific selectors (selectTokenUsagePercent) not entire store
- Components only re-render when their selected values change
- Prevents unnecessary re-renders of unrelated component

**Subscription patterns:**
- Components subscribe to specific store slices
- Shallow comparison prevents re-renders on reference changes

### 9.3 Debouncing and Throttling

API calls are debounced/throttled to reduce overhead:

**Debounced operations:**
- Natural language search: 500ms debounce (don't search on every keystroke)
- Insight regeneration: 2s debounce (don't regenerate on every resource state change)
- Token usage sync: 5s debounce (don't sync token usage on every API call)

**Throttled operations:**
- Health check: Minimum 30s between checks (don't ping AI service constantly)
- History polling: Maximum once per 10s

**Queue management:**
- Bulk analysis requests queue, don't execute in parallel
- Background insight generation is throttled to 1 resource per 5 minutes

### 9.4 Virtual Scrolling for Lists

Lists with many items use virtual scrolling:

**Applied to:**
- Investigation history (could have 50+ items)
- Long message lists in the chat (could have 100+ messages)
- Investigation timeline with many steps

**Benefit:**
- Only visible items are DOM nodes
- Scrolling is smooth even with thousands of items
- Memory usage is constant regardless of list size

### 9.5 Image Optimization

Charts and visualizations are optimized:

**Optimization techniques:**
- Charts are rendered as SVG (scalable, small size)
- Static charts are cached/memoized (don't re-render on every message)
- Large data visualizations are simplified (aggregate data, reduce points)
- Charts use efficient animation (CSS transforms vs. re-renders)

### 9.6 WebSocket Connection Pooling

WebSocket connections are pooled efficiently:

**Connection management:**
- Single shared WebSocket connection to kubilitics-ai
- Multiple investigations multiplexed over single connection
- Automatic reconnection on disconnect
- Connection idle timeout: 5 minutes (closes unused connections)
- Automatic heartbeat: Keep-alive pings every 30 seconds

### 9.7 IndexedDB for Offline Access

Insights and investigation history are cached in IndexedDB:

**Offline capabilities:**
- Investigation history is persisted locally
- Recent insights are cached locally
- If AI service is unavailable, cached insights still show
- Syncs back to AI when connection is restored

**Storage limits:**
- Last 50 investigations stored
- Insights for 100 resources
- Automatic cleanup of old data beyond these limits

---

## Section 10: Implementation Roadmap

The AI integration is implemented in five phases over 20 weeks, delivering value incrementally while building a solid foundation.

### 10.1 Phase 1: AI Infrastructure (Weeks 1-4)

**Goal:** Build the foundation that all other AI features depend on.

**Tasks:**

**Week 1: State Management and API Client**
- Create `src/stores/useAIStore.ts` with full state structure
- Create `src/api/aiApiClient.ts` with REST and WebSocket communication
- Implement local storage persistence for configuration
- Write tests for store and API client
- Deliverable: Core infrastructure is tested and working

**Week 2: Global AI Components - Part 1**
- Create `AIStatusBadge.tsx` component showing AI status in header
- Create `AIConfigurationForm.tsx` for Settings page
- Implement form validation and API key encryption
- Add "Test Connection" functionality
- Deliverable: Users can configure AI in Settings

**Week 3: Global AI Components - Part 2**
- Create `AIAssistantPanel.tsx` main component structure
- Create `AIAssistantPanel/ChatArea.tsx` for rendering messages
- Create `AIAssistantPanel/InputArea.tsx` for user input
- Create `AIAssistantPanel/HistorySidebar.tsx` for investigation history
- Implement keyboard shortcut (Cmd+K) to open panel
- Deliverable: Users can open the AI panel and send basic messages

**Week 4: Streaming and WebSocket**
- Implement WebSocket connection logic in API client
- Create `AIStreamingResponse.tsx` for real-time token rendering
- Test streaming responses with mock server
- Implement reconnection logic and error handling
- Deliverable: AI responses stream in real-time with markdown formatting

**End of Phase 1 deliverable:** Users can configure AI, open the assistant panel, ask questions, and see streaming responses.

### 10.2 Phase 2: Dashboard and Search Integration (Weeks 5-8)

**Goal:** Bring AI intelligence to the dashboard and make search smarter.

**Tasks:**

**Week 5: Dashboard AI Features**
- Design and implement `AISummaryWidget` component for cluster health overview
- Implement `AnomalyAlerts` component showing detected issues
- Implement `PredictiveInsights` component with forecasts
- Connect dashboard to useAIStore for real-time updates
- Deliverable: Dashboard shows AI summary, anomalies, and predictions

**Week 6: Dashboard Features - Part 2**
- Implement `CostOptimizationSummary` component
- Implement `QuickActionsWidget` with common AI investigations
- Add dashboard-level bulk analysis capability
- Test on various cluster states (healthy, problematic, etc.)
- Deliverable: Dashboard is fully AI-enhanced

**Week 7: Natural Language Search**
- Create `AINaturalLanguageSearch.tsx` component
- Implement AI search vs. exact search logic
- Create search result renderer with explanations
- Integrate with global search bar
- Deliverable: Global search understands natural language queries

**Week 8: Search Testing and Refinement**
- Test search with various query types
- Refine interpretation logic based on testing
- Add search result caching
- Optimize performance for large result sets
- Deliverable: Natural language search is robust and performant

**End of Phase 2 deliverable:** Dashboard shows AI intelligence, and global search understands natural language.

### 10.3 Phase 3: Resource Pages AI Integration (Weeks 9-12)

**Goal:** Add AI features to resource list and detail pages.

**Tasks:**

**Week 9: Resource List AI Features**
- Implement `AIResourceHealthDot` column for resource tables
- Create `AIHealthColumn` component rendering health indicators
- Implement "Analyze all resources" bulk analysis button
- Implement health dot tooltips and caching
- Deliverable: Resource lists show AI health assessment

**Week 10: Insight Cards and Smart Filtering**
- Create `AIInsightCard.tsx` component
- Implement insight display on resource detail pages
- Implement "Dismiss" and "Investigate" actions on cards
- Create `AISmartFilterSuggestions` component
- Deliverable: Resource detail pages show insights, list pages have smart filters

**Week 11: Pod Detail Page AI Tab**
- Create "AI Diagnosis" tab for pod detail pages
- Implement container analysis with memory/CPU insights
- Implement log analysis and error highlighting
- Implement restart pattern analysis
- Deliverable: Pods have comprehensive AI analysis tab

**Week 12: Other Resource Detail Pages**
- Implement AI tabs for Deployment, Service, Node, ConfigMap/Secret, PVC/PV detail pages
- Each tab shows resource-specific AI analysis
- Implement related resources links
- Test across different resource types
- Deliverable: All major resource types have AI analysis tabs

**End of Phase 3 deliverable:** Resource pages throughout the app show AI insights and analysis.

### 10.4 Phase 4: Advanced Features (Weeks 13-16)

**Goal:** Add sophisticated AI features: topology visualization, action proposals, and autonomy controls.

**Tasks:**

**Week 13: Topology Page Enhancement**
- Add AI hover tooltips to topology graph
- Implement "Show blast radius" visualization
- Implement critical path highlighting
- Create "Ask about topology" investigation mode
- Deliverable: Topology page shows AI-enhanced relationships and analysis

**Week 14: Action Proposals and Approval Workflows**
- Create `AIActionProposal.tsx` component
- Implement approval/rejection workflow
- Implement autonomy level enforcement
- Implement safety policy checks
- Deliverable: AI can propose actions with user approval

**Week 15: Autonomy Controls**
- Create `AIAutonomySlider.tsx` for settings
- Implement autonomy levels 1-5 with appropriate permissions
- Implement safety policy checkboxes
- Test autonomy enforcement across all features
- Deliverable: Users can control AI autonomy level

**Week 16: Quick Actions and Context Menu**
- Implement `AIQuickActionMenu` in resource context menus
- Add "Diagnose", "Explain", "Find Issues", "Optimize" actions
- Integrate quick actions with AI panel
- Test context menu on all resource types
- Deliverable: Users can quickly trigger AI analysis from any resource

**End of Phase 4 deliverable:** AI can take actions (with appropriate guardrails), and users have fine-grained control over AI autonomy.

### 10.5 Phase 5: Polish, Accessibility, and Optimization (Weeks 17-20)

**Goal:** Refine the entire feature, ensure accessibility, optimize performance, and adapt for mobile.

**Tasks:**

**Week 17: Accessibility Audit and Fixes**
- Audit all AI components for accessibility
- Add missing ARIA labels and semantic HTML
- Implement keyboard navigation across all features
- Test with screen readers (NVDA, JAWS)
- Fix color-only indicators (add text labels and icons)
- Deliverable: All AI features are accessible

**Week 18: Performance Optimization**
- Implement code-splitting for AI components
- Optimize rendering with React.memo and selectors
- Implement virtual scrolling for long lists
- Implement image/chart optimization
- Profile and optimize hot paths
- Deliverable: AI features add negligible overhead to app performance

**Week 19: Mobile Adaptation and Testing**
- Test all AI features on mobile devices (iOS and Android)
- Adapt AI panel for mobile (full-screen modal instead of side panel)
- Simplify or disable resource-intensive features on mobile
- Test touch interactions (long-press, swipe)
- Implement push notifications for alerts
- Deliverable: AI works great on mobile

**Week 20: Bug Fixes, Testing, and Documentation**
- Comprehensive testing (unit, integration, e2e)
- Bug fixes discovered during testing
- Write user documentation and help articles
- Create troubleshooting guides for common issues
- Final quality assurance and polish
- Deliverable: Ready for production release

**End of Phase 5 deliverable:** Full feature is polished, tested, accessible, performant, and documented.

### 10.6 Parallel Work and Dependencies

Some tasks can run in parallel:
- Dashboard and search work (Phase 2) can run in parallel with infrastructure setup completion
- Different resource page enhancements (Phase 3) can be parallelized
- Accessibility work (Phase 5) can start during Phase 4

**Critical dependencies:**
- Phase 1 must complete before Phase 2 (infrastructure needed first)
- API client WebSocket implementation (Phase 1, Week 4) must complete before streaming features can work

### 10.7 Testing Strategy

Throughout all phases, testing is built in:

**Unit tests:**
- Store logic (reducers, selectors)
- API client functions
- Component rendering with various props

**Integration tests:**
- Zustand store with components
- API client with mock server
- Workflow tests (configure AI → ask question → get response)

**E2E tests:**
- Critical workflows on real app:
  - Configure AI and test connection
  - Ask question in AI panel
  - Analyze pod from detail page
  - Run bulk resource analysis
  - Test on mobile viewport

**Performance tests:**
- Rendering performance of large message lists
- WebSocket streaming performance
- Insight generation doesn't block UI

**Accessibility tests:**
- Screen reader testing (NVDA, JAWS, VoiceOver)
- Keyboard navigation testing
- Color contrast verification
- Focus management testing

---

## Conclusion

This design document provides an exhaustive specification for integrating artificial intelligence throughout the Kubilitics frontend. The integration follows core principles:

1. **AI as an overlay, not a feature** - Intelligence enriches every page naturally
2. **Complete functionality without AI** - The app works great with or without AI enabled
3. **Progressive discovery** - Users discover AI capabilities as they explore
4. **Never force AI** - Manual operation is always available as an alternative
5. **Deterministic data always wins** - AI interprets, but API data is truth

The implementation is structured in five phases bringing value incrementally, with careful attention to performance, accessibility, mobile adaptation, and user experience. By the end of Phase 5, Kubilitics will offer AI-powered intelligence on every page, in every resource view, and across every interaction—making Kubernetes management dramatically more intelligent and accessible.

The result: A Kubernetes management tool that is already 100x better than competitors without AI, and becomes 1000x better when AI is enabled. Users never feel forced to use AI but quickly discover it makes them dramatically more productive and gives them insights they couldn't get any other way.

---

**Document Status:** Complete
**Ready for Implementation:** Yes
**Estimated Total Effort:** 20 weeks with parallel work across teams
**Next Steps:** Begin Phase 1 infrastructure work immediately

