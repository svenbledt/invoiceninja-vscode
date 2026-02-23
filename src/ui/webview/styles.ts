export function getSidebarStyles(): string {
  return `
:root {
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --radius-1: 6px;
  --radius-2: 10px;
}

*,
*::before,
*::after {
  box-sizing: border-box;
}

body {
  margin: 0;
  padding: var(--space-3);
  color: var(--vscode-editor-foreground);
  background: var(--vscode-editor-background);
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
  line-height: 1.4;
}

button,
input,
select,
textarea {
  width: 100%;
  min-height: 30px;
  border-radius: var(--radius-1);
  border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  padding: 0 var(--space-2);
}

textarea {
  resize: none;
  overflow: hidden;
  min-height: 64px;
  max-height: min(40vh, 280px);
  padding: var(--space-2);
  line-height: 1.4;
}

select {
  appearance: none;
  -webkit-appearance: none;
  padding-right: 28px;
  background-image:
    linear-gradient(45deg, transparent 50%, var(--vscode-input-foreground) 50%),
    linear-gradient(135deg, var(--vscode-input-foreground) 50%, transparent 50%);
  background-position:
    calc(100% - 14px) calc(50% - 2px),
    calc(100% - 9px) calc(50% - 2px);
  background-size: 5px 5px, 5px 5px;
  background-repeat: no-repeat;
}

select.has-value {
  border-color: var(--vscode-focusBorder);
  background-color: var(--vscode-list-activeSelectionBackground, var(--vscode-input-background));
  color: var(--vscode-list-activeSelectionForeground, var(--vscode-input-foreground));
}

option {
  background: var(--vscode-dropdown-background, var(--vscode-input-background));
  color: var(--vscode-dropdown-foreground, var(--vscode-input-foreground));
}

option:checked {
  background: var(--vscode-list-activeSelectionBackground, var(--vscode-dropdown-background, var(--vscode-input-background)));
  color: var(--vscode-list-activeSelectionForeground, var(--vscode-dropdown-foreground, var(--vscode-input-foreground)));
}

button {
  cursor: pointer;
}

button:hover {
  background: var(--vscode-toolbar-hoverBackground, var(--vscode-list-hoverBackground));
}

button:focus-visible,
input:focus-visible,
select:focus-visible,
textarea:focus-visible {
  outline: 1px solid var(--vscode-focusBorder);
  outline-offset: 1px;
}

input[type="checkbox"] {
  width: auto;
  min-width: 16px;
  min-height: 16px;
  height: 16px;
  padding: 0;
  margin: 0;
}

.toggle-inline {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  width: 100%;
  min-height: 34px;
  border: 1px solid var(--vscode-panel-border);
  border-radius: var(--radius-2);
  background: var(--vscode-editorWidget-background, var(--vscode-sideBar-background));
  padding: var(--space-2) var(--space-3);
  cursor: pointer;
}

.toggle-inline:hover {
  border-color: var(--vscode-focusBorder, var(--vscode-panel-border));
}

.toggle-inline span {
  color: var(--vscode-foreground);
  font-size: 12px;
}

#autoWorklog {
  appearance: none;
  -webkit-appearance: none;
  width: 34px;
  min-width: 34px;
  height: 20px;
  min-height: 20px;
  border-radius: 999px;
  border: 1px solid var(--vscode-input-border, var(--vscode-panel-border));
  background: var(--vscode-input-background);
  position: relative;
  transition: background-color 120ms ease, border-color 120ms ease;
}

#autoWorklog::before {
  content: "";
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  border-radius: 999px;
  background: var(--vscode-input-foreground);
  opacity: 0.72;
  transition: transform 120ms ease, opacity 120ms ease, background-color 120ms ease;
}

#autoWorklog:checked {
  background: var(--vscode-button-background, var(--vscode-focusBorder));
  border-color: var(--vscode-button-background, var(--vscode-focusBorder));
}

#autoWorklog:checked::before {
  transform: translateX(14px);
  background: var(--vscode-button-foreground, var(--vscode-editor-background));
  opacity: 1;
}

.hide {
  display: none !important;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  margin-bottom: var(--space-3);
}

.brand {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.brand__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.logo {
  width: 28px;
  height: 28px;
  border-radius: 999px;
  overflow: hidden;
  border: 1px solid var(--vscode-panel-border);
  flex-shrink: 0;
}

.logo img {
  width: 100%;
  height: 100%;
  display: block;
}

.toolbar {
  display: flex;
  gap: var(--space-1);
}

.toolbar button {
  width: auto;
  min-width: 32px;
  padding: 0 var(--space-2);
}

#refresh {
  width: 32px;
  min-width: 32px;
  padding: 0;
}

.section {
  display: grid;
  gap: var(--space-2);
}

.row {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  min-width: 0;
}

.row > * {
  min-width: 0;
}

.grow {
  flex: 1 1 auto;
}

.meta {
  color: var(--vscode-descriptionForeground, var(--vscode-foreground));
  font-size: 12px;
  overflow-wrap: anywhere;
}

.msg {
  min-height: 18px;
}

.msg.err {
  color: var(--vscode-errorForeground);
}

.msg.ok {
  color: var(--vscode-testing-iconPassed, var(--vscode-charts-green));
}

.panel {
  border: 1px solid var(--vscode-panel-border);
  border-radius: var(--radius-2);
  padding: var(--space-2);
  background: var(--vscode-editorWidget-background, var(--vscode-sideBar-background));
}

.card {
  border: 1px solid var(--vscode-panel-border);
  border-radius: var(--radius-2);
  background: var(--vscode-editorWidget-background, var(--vscode-sideBar-background));
  padding: var(--space-2);
  display: grid;
  gap: var(--space-2);
}

.card + .card {
  margin-top: var(--space-2);
}

.card.selected {
  border-color: var(--vscode-focusBorder);
}

.card.running {
  border-color: var(--vscode-testing-iconPassed, var(--vscode-charts-green));
}

.card__title {
  margin: 0;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card__meta {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  min-width: 0;
  flex-wrap: wrap;
}

.badge {
  width: auto;
  min-width: 0;
  padding: 0 var(--space-2);
  border-radius: 999px;
  text-overflow: ellipsis;
  overflow: hidden;
  white-space: nowrap;
}

.actions {
  margin-left: auto;
  display: flex;
  gap: var(--space-1);
  align-items: center;
  min-width: 0;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.actions button {
  width: auto;
  min-width: 30px;
}

.timer {
  font-variant-numeric: tabular-nums;
}

.menu {
  display: grid;
  gap: var(--space-1);
}

.menu button {
  text-align: left;
}

.empty {
  padding: var(--space-2) 0;
}

@media (max-width: 480px) {
  body {
    padding: var(--space-2);
  }

  .row {
    flex-wrap: wrap;
  }

  .row.stack-mobile > button,
  .row.stack-mobile > input,
  .row.stack-mobile > select,
  .row.stack-mobile > textarea {
    flex: 1 1 100%;
  }

  .actions {
    margin-left: 0;
    width: 100%;
    justify-content: flex-start;
  }
}
`;
}
