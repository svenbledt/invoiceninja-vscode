# Developer Documentation

## Architecture

The extension is split into:

- `src/extension.ts`: activation, command registration, service wiring.
- `src/services/*`: auth/session, task data, timer lifecycle.
- `src/ui/sidebarProvider.ts`: webview controller, state assembly, message handling.
- `src/ui/webview/*`: sidebar HTML template, styles, and client-side UI script.

## Webview Rendering Model

- `SidebarProvider` pushes `{ type: "state", payload: SidebarState }` into the webview.
- The webview script handles two paths:
  - Full render: auth/work view changes, task list updates, edit mode transitions.
  - Timer-only update: on per-second ticks, only timer labels and running button/card states are updated.

This avoids rebuilding the full task list every second.

## Message Flow

UI messages are posted through `vscode.postMessage(...)` and handled in `SidebarProvider.handleMessage`.
Existing message types are preserved, including:

- Auth: `toggleMode`, `login`, `logout`
- Data: `refresh`, `search`, `setStatusFilter`, `setProjectFilter`
- Tasks: `saveTask`, `selectTask`, `editTask`, `saveTaskEdit`, `archiveTask`, `deleteTask`
- Assignments: `assignUser`, `assignProject`, `assignTaskStatus`
- Timer: `startTimer`, `stopTimer`
- Reminders/theme: `taskReminder`, `toggleTheme`

## Styling Guidelines

- Use VS Code theme tokens (`--vscode-*`) to remain native in dark, light, and high-contrast themes.
- Keep controls keyboard-accessible with visible focus states.
- Ensure narrow sidebar widths do not clip controls or text.

## Performance Notes

- `SidebarProvider.updateTicker()` pushes timer updates every second only when a timer is running and a view is active.
- Timer tick pushes use cached state when safe, minimizing data recomputation.
- Webview applies timer-only DOM updates when the payload indicates no structural changes.

## Tests

Tests live in `src/ui/__tests__/`:

- `stateDiff.test.ts`: validates timer-only update detection and task signature behavior.
- `taskElapsedSeconds.test.ts`: validates task duration parsing and time-log fallback.

Run:

```bash
npm test
```

## Manual QA Checklist

1. Verify login UI in cloud and self-host modes.
2. Resize sidebar narrow/wide and confirm no clipping or overlap.
3. Start a timer and confirm second-by-second timer updates remain smooth.
4. Verify task actions: assign, edit, archive, delete, reminders.
5. Verify keyboard access (Tab/Enter/Escape) for menus and actions.
6. Validate dark/light/high-contrast theme readability.
