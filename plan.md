# Luma Premium AI Platform — Implementation Plan

## Direction and scope

Restore the original Luma light layout and remove the recently introduced purple mobile dashboard/rail design. Preserve the existing chat, onboarding, project, conversation-history, account, admin, RBAC, persistence, and Manus Google OAuth behavior. Expand the product into a premium AI platform with a landing page, AI workspace, website builder with interactive preview, image/video generation entry points, memberships, searchable support content, resources, and a complete admin content/configuration surface.

The first release will use **Manus Google OAuth** as the only application login provider. Payment integration will use the managed **Stripe** capability, with INR and USD prices represented as separate editable price records. No card data or provider secrets will be stored in application tables.

## Design system

- **Design movement:** Editorial SaaS / quiet luxury utility — the original Luma light interface remains the foundation, with premium restraint rather than a new dark visual identity.
- **Core principles:** calm hierarchy, visible work-in-progress, direct manipulation, and trustworthy controls.
- **Color philosophy:** warm white and ink remain the canvas; teal is the ownable action color for trust and progress; muted lilac and aqua are reserved for AI capability accents and generated previews.
- **Layout paradigm:** asymmetric editorial landing sections and a two-pane AI workspace. The website-builder view uses a persistent prompt/control rail beside an interactive preview frame instead of centered marketing cards.
- **Signature elements:** the Luma orb/wordmark, teal progress rules, and framed live-preview windows with device toggles.
- **Interaction philosophy:** every major tile opens a working flow; empty states explain the next action; long-running AI work shows status and remains recoverable.
- **Animation:** short opacity/translate transitions, subtle preview refresh shimmer, no decorative motion that blocks input; honor reduced-motion preferences.
- **Typography:** Newsreader for editorial headings and Luma identity; system sans for controls, metadata, plans, and admin tables.
- **Brand essence:** a calm command center for turning an idea into a working digital product. Personality: precise, generous, composed.
- **Brand voice:** confident and useful, never inflated. Example lines: “Turn the brief into a working page.” and “See the result before you publish.”
- **Wordmark/logo:** retain the existing Luma wordmark and orb asset; use the orb as the compact product mark in workspace and preview chrome.
- **Signature brand color:** Luma teal, used for primary actions, status, and trust cues.

## Product surfaces

### Public landing page (`/` when logged out)

- Premium hero with clear value proposition, primary “Start creating” CTA, secondary “Explore agents” CTA, and trust/security note.
- Platform overview showing the connected workflow: chat → agent → generated output → interactive preview.
- AI agents section for Website Builder, Research, Image Studio, Video Studio, and Support Copilot.
- Website Builder section with a miniature live preview and a “Try in workspace” CTA.
- Image and Video Studio sections with prompt input affordances and generated-output placeholders that link to the authenticated workspace.
- Membership section with Free, Pro, Max, Team, and Enterprise tiers; prices and currencies are read from editable configuration, not hardcoded in the client.
- Searchable FAQ and resources/documentation/tutorial links.
- Responsive original light layout with accessible focus states and no purple mobile redesign.

### Authenticated workspace

- Preserve existing chat composer, model/mode controls, conversation history, profile/onboarding, and usage behavior.
- Add an agent switcher with the five agents above.
- Add a Website Builder workspace: prompt, starter template, file tree, generation status, responsive device buttons, refresh/reload preview, and a sandboxed iframe preview.
- Add Image Studio and Video Studio request forms with job state, result cards, retry, and save-to-project actions. Route provider calls through the server; never expose server credentials.
- Add projects dashboard with recent projects, status, last updated, preview/open controls, and safe delete/archive behavior.
- Add membership/account page with current plan, usage, billing status, and payment history.
- Add support search and AI support handoff using the existing chat surface.

### Admin console

Preserve existing admin RBAC and add permission-gated sections for:

- Overview and usage.
- Users, roles, plans, memberships, and account status.
- Plans/prices: Free, Pro, Max, Team, Enterprise; per-currency price records for INR/USD; active/archive state; feature bullets; limits; checkout price IDs.
- AI tools/agents: name, description, icon, enabled state, model/provider route, daily limits, and display order.
- FAQ and resources: CRUD, search keywords, published state, categories, and ordering.
- Landing content: hero copy, overview blocks, agent cards, CTA labels, and announcement banner.
- Projects and generated outputs, including preview status.
- Conversations, reports, activity, security, and provider-key metadata using the existing safe-key flow.

## Backend and data model

Extend the current normalized persistence layer and MySQL migration path additively. Keep JSON fallback for local/demo development, but published production state uses managed MySQL when available.

New records/modules:

- `plans` and `plan_prices`: tier metadata, currency, amount, Stripe price ID, feature JSON, limits, active state.
- `memberships`: user, plan, status, Stripe customer/subscription IDs, period dates, cancellation state.
- `payment_events`: event ID, type, status, processed timestamp, linked user/membership; no raw payload.
- `agents`: editable AI tool metadata and enablement.
- `faq_entries`, `resources`, and `landing_content`.
- `ai_jobs`: user, kind, status, prompt metadata, output references, error state, timestamps.
- `website_projects`: project metadata, files, preview token/status, version history, ownership.

Add server routes for public content, membership/checkout/history, agent metadata, AI jobs, website preview/project versions, and admin CRUD. Keep ownership checks on every user resource and permission checks on every admin write.

## Auth, security, and privacy

- Keep Manus OAuth callback/state/nonce/session validation and the `webdev_app_session` contract intact.
- Keep SameSite=None; Secure behavior for public HTTPS Preview sessions.
- Add CSRF/origin checks for mutating browser requests where applicable, strict input length/type validation, rate limits for AI jobs and checkout creation, and safe error messages.
- Keep provider keys encrypted/metadata-only in admin responses; never log prompts containing secrets, raw payment payloads, card numbers, or API keys.
- Website previews render in a sandboxed iframe with an allowlisted asset/runtime policy and project ownership checks.
- Provide privacy controls for conversation retention, generated-output deletion, and account data export where supported by the existing model.

## Payments

Enable managed Stripe through the project configuration. Implement server-side Checkout Session creation with authenticated buyer linkage, promotion-code support, fixed success/cancel paths, and webhook verification using the raw request body. Handle the six registered event types idempotently and grant membership only from persisted webhook fulfillment state. Provide `/payments` history with processing, completed, canceled, and failed states. The admin edits catalog metadata and maps INR/USD Stripe price IDs; it does not edit arbitrary client-side payment state.

## Delivery phases

1. **Foundation and visual restoration:** revert the purple mobile-only redesign, restore original responsive light layout, normalize shared UI primitives, add content/agent/plan schemas and public routes.
2. **Premium landing and workspace:** implement the landing sections, agent switcher, project dashboard, Website Builder shell, interactive preview frame, and generated-job UI.
3. **Admin/content controls:** add editable plans/prices, agents, landing content, FAQs, resources, and moderation/status views with RBAC.
4. **Payments and memberships:** enable Stripe, add checkout/webhooks/entitlements/history, and connect membership UI.
5. **AI service wiring and hardening:** connect available Manus AI services for chat/structured generation and configured image/video providers, add job retries/status, complete mobile/desktop QA, and publish.

## Project structure target

- `server.js` — HTTP routes, auth, API orchestration, security middleware.
- `database.js` — additive MySQL migrations, JSON fallback normalization, persistence adapters.
- `lib/` — auth, permissions, catalog, payments, AI provider, preview, validation helpers.
- `public/index.html` — restored Luma shell and authenticated workspace entry.
- `public/admin.html` or admin sections — admin console surfaces while preserving the existing route contract.
- `public/assets/` — durable logos and UI assets.
- `tests/` — API, RBAC, payment webhook, preview ownership, and content-management regressions.
- `manus-routes.json` — synchronized page-route declarations.

## Acceptance target

The original light layout remains recognizable and responsive; every visible CTA has a working destination or explicit disabled state; the landing page, AI workspace, project/preview flow, membership catalog, admin editing surfaces, FAQ/resources search, Manus OAuth, RBAC, payment lifecycle, and security controls are covered by automated checks and verified in mobile and desktop Preview before publication.
