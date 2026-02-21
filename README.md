# Invoice Ninja Time Tracker (VS Code/Cursor)

Track Invoice Ninja tasks directly in VS Code/Cursor from a sidebar UI.

## Features

- Login form with:
  - Email/password/OTP
  - Self-host mode toggle (URL + secret)
- Work panel with:
  - Task input (`Save` creates task only)
  - Search button
  - Status + project filters (single-select)
  - Start/stop timer
  - Account menu (theme toggle + logout)
- Command palette actions:
  - `Invoice Ninja: Open Sidebar`
  - `Invoice Ninja: Start Timer`
  - `Invoice Ninja: Stop Timer`
  - `Invoice Ninja: Refresh`
  - `Invoice Ninja: Logout`

## Setup

1. Install dependencies:
   - `npm install`
2. Build:
   - `npm run compile`
3. Launch extension host in VS Code (`F5`).

## Configuration

Available settings:

- `invoiceNinja.defaultBaseUrl` (default: `https://invoicing.co`)
- `invoiceNinja.defaultClientId`
- `invoiceNinja.defaultProjectId`
- `invoiceNinja.requestTimeoutMs` (default: `15000`)
- `invoiceNinja.autoResumeTimer` (default: `true`)

## Notes

- Google OAuth is intentionally not implemented in v1.
- The extension stores auth secrets in VS Code `SecretStorage`.
- Non-secret UI preferences are persisted per account key (`baseUrl|email`).
