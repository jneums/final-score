#!/usr/bin/env tsx
/**
 * Setup script: generates bot identities, funds them, approves tokens, creates API keys.
 *
 * Usage:
 *   export ADMIN_IDENTITY_PEM=$(cat ~/.config/dfx/identity/pp_owner/identity.pem | base64 -w0)
 *   export NUM_BOTS=15
 *   npm run setup > bot-identities.json
 *
 * Progress is logged to stderr; clean JSON is written to stdout.
 */
export {};
