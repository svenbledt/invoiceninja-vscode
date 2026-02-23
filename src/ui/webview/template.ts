import { getSidebarScript } from "./script";
import { getSidebarStyles } from "./styles";

export interface SidebarHtmlInput {
  cspSource: string;
  nonce: string;
  logoUri: string;
}

export function renderSidebarHtml(input: SidebarHtmlInput): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; img-src ${input.cspSource} data:; style-src ${input.cspSource} 'unsafe-inline'; script-src 'nonce-${input.nonce}';"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>${getSidebarStyles()}</style>
  </head>
  <body>
    <section id="auth" class="section" aria-label="Authentication">
      <div class="header">
        <div class="brand">
          <div class="logo"><img src="${input.logoUri}" alt="Invoice Ninja logo" /></div>
          <strong class="brand__name">Invoice Ninja</strong>
        </div>
      </div>
      <div class="row"><input id="email" class="grow" placeholder="E-mail address" aria-label="Email address" /></div>
      <div class="row"><input id="password" type="password" class="grow" placeholder="Password" aria-label="Password" /></div>
      <div class="row"><input id="otp" class="grow" placeholder="One Time Password" aria-label="One time password" /></div>
      <div id="sh" class="section hide">
        <div class="row"><input id="url" class="grow" placeholder="Server URL" aria-label="Server URL" /></div>
        <div class="row"><input id="secret" class="grow" placeholder="API secret or token" aria-label="API secret" /></div>
      </div>
      <div class="row stack-mobile">
        <button id="login" type="button" class="grow">Log in</button>
        <button id="mode" type="button">Use self-host settings</button>
      </div>
      <div id="amsg" class="meta msg" role="status" aria-live="polite"></div>
    </section>

    <section id="work" class="section hide" aria-label="Time tracker workspace">
      <div class="header">
        <div class="brand">
          <div class="logo"><img src="${input.logoUri}" alt="" /></div>
          <strong id="acc" class="brand__name"></strong>
        </div>
        <div class="toolbar">
          <button id="refresh" type="button" aria-label="Refresh tasks">↻</button>
          <button id="logout" type="button" aria-label="Logout">Logout</button>
        </div>
      </div>

      <section id="list" class="section" aria-label="Task list">
        <div class="row stack-mobile">
          <input id="q" class="grow" placeholder="What are you working on?" aria-label="Task search or description" />
          <button id="save" type="button">Save</button>
          <button id="search" type="button">Search</button>
        </div>
        <div class="row stack-mobile">
          <select id="sf" aria-label="Status filter"></select>
          <select id="pf" aria-label="Project filter"></select>
        </div>
        <div class="row">
          <label class="toggle-inline" for="autoWorklog">
            <input id="autoWorklog" type="checkbox" aria-label="Automatically add workspace worklog on timer stop" />
            <span>Auto add workspace worklog on stop</span>
          </label>
        </div>
        <div id="tasks" class="section" role="list" aria-label="Tasks"></div>
        <div id="empty" class="meta empty hide">No tasks found.</div>
      </section>

      <section id="edit" class="section hide" aria-label="Edit task">
        <div class="meta">Home / Tasks / Edit</div>
        <h2 id="enum"></h2>
        <div class="row"><textarea id="edesc" class="grow auto-grow" rows="1" placeholder="Description" aria-label="Task description"></textarea></div>
        <div class="row"><select id="eproj" class="grow" aria-label="Project"></select></div>
        <div class="row"><input id="erate" class="grow" type="number" aria-label="Rate" /></div>
        <div class="row"><select id="euser" class="grow" aria-label="Assigned user"></select></div>
        <div class="row stack-mobile">
          <button id="esave" type="button" class="grow">Save</button>
          <button id="eback" type="button">Back</button>
        </div>
      </section>

      <div id="wmsg" class="meta msg" role="status" aria-live="polite"></div>
    </section>
    <script nonce="${input.nonce}">${getSidebarScript()}</script>
  </body>
</html>`;
}
