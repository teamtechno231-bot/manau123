# Luma Premium AI Platform — Implementation Checklist

## Restore original experience

- Restore the original Luma light responsive layout and remove the recently introduced purple mobile dashboard and floating mobile rail; preserve the existing chat composer, model/mode controls, onboarding, account menu, chat history, projects, admin console, and Manus Google OAuth.
- Keep desktop and mobile layouts usable at phone and desktop widths with no horizontal overflow, clipped controls, or hidden primary actions.

## Landing page and platform discovery

- Add a premium hero with working primary and secondary CTAs, a platform overview, AI agents section, Website Builder preview section, Image Studio section, Video Studio section, membership tiers, searchable FAQ, and resources/documentation/tutorials.
- Ensure all public content is read from editable content/catalog records where appropriate and every CTA has a working destination or explicit disabled state.

## AI workspace and previews

- Preserve direct chat and add Website Builder, Research, Image Studio, Video Studio, and Support Copilot agent entry points.
- Add a Website Builder flow with prompt input, starter/template selection, generation status, project files, responsive preview controls, refresh/reload, and an interactive sandboxed preview tied to an owned project.
- Add job status, retry, output saving, and project linking for image/video generation requests without exposing server credentials.
- Make every created website previewable interactively inside Luma with ownership checks and safe iframe/runtime boundaries.

## Memberships and payments

- Add Free, Pro, Max, Team, and Enterprise plans with editable features, limits, active/archive state, and separate INR/USD price records.
- Add authenticated membership state, billing status, payment history, processing/canceled/failed states, and server-side Stripe Checkout with buyer linkage.
- Implement idempotent raw-body-verified Stripe webhook handling for the registered event types; grant entitlements only from persisted fulfillment state and never store card data.

## Admin and content controls

- Extend the existing RBAC admin console with permission-gated plan/price, AI-agent, landing-content, FAQ, resource, membership, and website-project management.
- Preserve existing user, conversation, settings, API-key metadata, activity, security, reports, and usage controls.
- Add searchable/published/order fields for FAQs and resources, safe validation, audit events, and no secret values in responses.

## Persistence and security

- Extend the JSON fallback and managed MySQL migrations additively for plans, prices, memberships, payment events, agents, content, AI jobs, and website projects.
- Preserve Manus OAuth state/nonce/session validation and the `webdev_app_session` contract; keep cross-site Preview cookie behavior correct.
- Add ownership checks, role checks, input limits, rate limits, CSRF/origin protections for mutations, privacy controls, safe error responses, and secure generated-preview boundaries.

## Validation and delivery

- Add regression coverage for public content, plan catalog, membership permissions, checkout/webhook idempotency, project preview ownership, admin CRUD permissions, mobile layout, and existing RBAC/auth flows.
- Verify JavaScript diagnostics, automated tests, phone and desktop Preview, public health, route manifest, and production deployment before delivery.

## Current hardening request

- Fix all UI errors and make the website fully responsive on mobile, tablet, and Windows desktop.
- Fix and connect all admin and user sections, dashboards, buttons, and features.
- Implement secure login, signup, logout, and role-based access.
- Add a premium 3D animated logo loading screen lasting 5–10 seconds on initial load.
- Add a floating + New Chat button that starts a separate conversation without deleting chat history.
- Fix all frontend, backend, API, database, and authentication errors.
- Improve the design with smooth animations and a premium modern UI.
- Test every screen and feature after fixing, while preserving existing data and working features.
