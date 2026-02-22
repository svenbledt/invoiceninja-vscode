# Invoice Ninja Time Tracker

Track your Invoice Ninja task timers directly from VS Code or Cursor.

## What You Can Do

- Sign in with your Invoice Ninja account
- Search and select tasks
- Start and stop timers without leaving your editor
- Filter tasks by status and project
- Keep your active timer state after restarting VS Code/Cursor

## Install

1. Open VS Code or Cursor.
2. Install the extension:
   - From Marketplace (when published), or
   - From `.vsix`: open Extensions view, click `...` > `Install from VSIX...`
3. Open the `Invoice Ninja` view in the activity bar.

## Sign In

For hosted Invoice Ninja:
1. Enter your email and password.
2. Add OTP if your account requires it.
3. Keep `Self-host mode` disabled.

For self-hosted Invoice Ninja:
1. Enable `Self-host mode`.
2. Enter your instance URL.
3. Enter your API token/secret (if required by your setup).
4. Sign in with your account credentials.

## Daily Use

1. Open the Invoice Ninja sidebar.
2. Search for an existing task or create one.
3. Click `Start` to begin tracking time.
4. Click `Stop` when done.

Command palette shortcuts:
- `Invoice Ninja: Open Sidebar`
- `Invoice Ninja: Start Timer`
- `Invoice Ninja: Stop Timer`
- `Invoice Ninja: Refresh`
- `Invoice Ninja: Logout`

## Extension Settings

- `invoiceNinja.defaultBaseUrl`: Default API base URL (`https://invoicing.co` by default)
- `invoiceNinja.defaultClientId`: Default client ID for new tasks (optional)
- `invoiceNinja.defaultProjectId`: Default project ID for new tasks (optional)
- `invoiceNinja.requestTimeoutMs`: API request timeout in milliseconds (default: `15000`)
- `invoiceNinja.autoResumeTimer`: Restore active timer after restart (default: `true`)

## Privacy and Security

- Credentials/tokens are stored in VS Code `SecretStorage`.
- UI preferences are stored locally per account.

## Known Limitation

- Google OAuth sign-in is not available in this version.

## For Developers

For development details, see `docs/DEVELOPER.md`.
