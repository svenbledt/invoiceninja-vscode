export function getSidebarScript(): string {
  return `
const vscode = acquireVsCodeApi();

const state = {
  mode: "cloud",
  openMenu: "",
  editId: "",
  data: null,
  lastPayload: null,
};
const FILTER_VALUE_ALL = "__all";
const FILTER_VALUE_NONE = "__none";

const $ = (id) => document.getElementById(id);

function esc(value) {
  return String(value ?? "");
}

function optionLabel(value, fallback) {
  const text = esc(value).trim();
  return text || fallback;
}

function userLabel(user) {
  const full = (esc(user.first_name) + " " + esc(user.last_name)).trim();
  return full || esc(user.display_name) || esc(user.email) || esc(user.id);
}

function taskNo(task) {
  const number = esc(task.number).trim();
  if (number) {
    return number;
  }
  return esc(task.id).slice(0, 4).padStart(4, "0");
}

function statusName(task, statuses) {
  const id = esc(task.task_status_id || task.status_id || "");
  const item = statuses.find((entry) => esc(entry.id) === id);
  return item ? optionLabel(item.name, id) : (id || "Backlog");
}

function parseClockText(value) {
  if (typeof value !== "string" || !value.includes(":")) {
    return Number.NaN;
  }

  const parts = value.split(":").map((part) => Number(part));
  if (parts.some((part) => !Number.isFinite(part))) {
    return Number.NaN;
  }

  if (parts.length === 3) {
    return (parts[0] * 3600) + (parts[1] * 60) + parts[2];
  }
  if (parts.length === 2) {
    return (parts[0] * 60) + parts[1];
  }

  return Number.NaN;
}

function parseNumericDuration(raw, decimalMeansHours) {
  if (raw === undefined || raw === null || raw === "") {
    return Number.NaN;
  }

  const fromClock = parseClockText(raw);
  if (Number.isFinite(fromClock)) {
    return fromClock;
  }

  const text = esc(raw).trim();
  const value = Number(text);
  if (!Number.isFinite(value)) {
    return Number.NaN;
  }

  const isDecimal = text.includes(".") || Math.abs(value - Math.trunc(value)) > 0;
  if (decimalMeansHours && isDecimal) {
    return Math.round(value * 3600);
  }
  return Math.max(0, Math.round(value));
}

function totalSeconds(task, payload) {
  if (payload.isTimerRunning && payload.timerTaskId === task.id) {
    return payload.timerElapsedSeconds;
  }

  const fromDuration = parseNumericDuration(task.duration, true);
  if (Number.isFinite(fromDuration) && fromDuration > 0) {
    return fromDuration;
  }

  const raw = task.time_log;
  const direct = parseNumericDuration(raw, true);
  if (Number.isFinite(direct) && direct > 0 && (typeof raw !== "string" || !raw.trim().startsWith("["))) {
    return direct;
  }

  try {
    const parsed = JSON.parse(task.time_log || "[]");
    const now = Math.floor(Date.now() / 1000);
    if (!Array.isArray(parsed)) {
      return 0;
    }
    return parsed.reduce((sum, segment) => {
      if (!Array.isArray(segment) || segment.length < 2) {
        return sum;
      }
      const start = Number(segment[0]) || 0;
      const end = Number(segment[1]) || 0;
      if (!start) {
        return sum;
      }
      return sum + Math.max(0, (end > 0 ? end : now) - start);
    }, 0);
  } catch {
    return 0;
  }
}

function fmt(total) {
  const hours = String(Math.floor(total / 3600));
  const minutes = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const seconds = String(Math.floor(total % 60)).padStart(2, "0");
  return hours + ":" + minutes + ":" + seconds;
}

function autoResizeTextarea(node) {
  if (!node) {
    return;
  }

  node.style.height = "auto";
  node.style.height = node.scrollHeight + "px";
}

function clearChildren(node) {
  while (node.firstChild) {
    node.removeChild(node.firstChild);
  }
}

function setSelectValueState(selectNode) {
  selectNode.classList.toggle("has-value", Boolean(selectNode.value));
}

function setStatusFilterOptions(selectNode, entries, selected) {
  clearChildren(selectNode);
  const allOption = document.createElement("option");
  allOption.value = FILTER_VALUE_ALL;
  allOption.textContent = "All statuses";
  selectNode.appendChild(allOption);

  entries.forEach((entry) => {
    const option = document.createElement("option");
    option.value = esc(entry.id);
    option.textContent = optionLabel(entry.name, esc(entry.id));
    selectNode.appendChild(option);
  });

  const value = (!selected || selected === FILTER_VALUE_NONE) ? FILTER_VALUE_ALL : selected;
  selectNode.value = value;
  if (selectNode.value !== value) {
    selectNode.value = FILTER_VALUE_ALL;
  }
  setSelectValueState(selectNode);
}

function setUserOptions(selectNode, users, selected) {
  clearChildren(selectNode);
  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = "-- Unassigned --";
  selectNode.appendChild(defaultOption);

  users.forEach((user) => {
    const option = document.createElement("option");
    option.value = esc(user.id);
    option.textContent = userLabel(user);
    selectNode.appendChild(option);
  });
  selectNode.value = selected || "";
  setSelectValueState(selectNode);
}

function setProjectOptions(selectNode, projects, selected, placeholder) {
  clearChildren(selectNode);
  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = placeholder;
  selectNode.appendChild(defaultOption);
  projects.forEach((project) => {
    const option = document.createElement("option");
    option.value = esc(project.id);
    option.textContent = optionLabel(project.name, esc(project.id));
    selectNode.appendChild(option);
  });
  selectNode.value = selected || "";
  setSelectValueState(selectNode);
}

function setTaskProjectFilterOptions(selectNode, projects, selected) {
  clearChildren(selectNode);

  const allOption = document.createElement("option");
  allOption.value = FILTER_VALUE_ALL;
  allOption.textContent = "All projects";
  selectNode.appendChild(allOption);

  const noneOption = document.createElement("option");
  noneOption.value = FILTER_VALUE_NONE;
  noneOption.textContent = "No project";
  selectNode.appendChild(noneOption);

  projects.forEach((project) => {
    const option = document.createElement("option");
    option.value = esc(project.id);
    option.textContent = optionLabel(project.name, esc(project.id));
    selectNode.appendChild(option);
  });

  const value = selected || FILTER_VALUE_ALL;
  selectNode.value = value;
  if (selectNode.value !== value) {
    selectNode.value = FILTER_VALUE_ALL;
  }
  setSelectValueState(selectNode);
}

function createActionButton(label, action, taskId, extra = {}) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.dataset.a = action;
  button.dataset.id = taskId;
  Object.entries(extra).forEach(([key, value]) => {
    button.dataset[key] = value;
  });
  return button;
}

function createTaskCard(task, payload) {
  const running = payload.isTimerRunning && payload.timerTaskId === task.id;
  const card = document.createElement("article");
  card.className = "card";
  if (payload.selectedTaskId === task.id) {
    card.classList.add("selected");
  }
  if (running) {
    card.classList.add("running");
  }
  card.dataset.taskId = task.id;

  const title = document.createElement("h3");
  title.className = "card__title";
  title.textContent = optionLabel(task.description, "(no description)");
  card.appendChild(title);

  const metaRow = document.createElement("div");
  metaRow.className = "card__meta";

  const numberLabel = document.createElement("span");
  numberLabel.className = "meta";
  numberLabel.textContent = "#" + taskNo(task);
  metaRow.appendChild(numberLabel);

  const statusButton = createActionButton(statusName(task, payload.statuses), "assign-status", task.id);
  statusButton.className = "badge";
  statusButton.setAttribute("aria-label", "Assign status for " + optionLabel(task.description, "task"));
  metaRow.appendChild(statusButton);

  const actions = document.createElement("div");
  actions.className = "actions";

  actions.appendChild(createActionButton("User", "assign-user", task.id));
  actions.appendChild(createActionButton("Project", "assign-project", task.id));

  const timerText = document.createElement("span");
  timerText.className = "meta timer";
  timerText.dataset.timerFor = task.id;
  timerText.textContent = "Timer " + fmt(totalSeconds(task, payload));
  actions.appendChild(timerText);

  const toggleButton = createActionButton(running ? "Stop" : "Start", "toggle", task.id);
  toggleButton.dataset.running = running ? "1" : "0";
  toggleButton.setAttribute("aria-label", (running ? "Stop timer for " : "Start timer for ") + optionLabel(task.description, "task"));
  actions.appendChild(toggleButton);

  const menuButton = createActionButton("More", "menu", task.id);
  menuButton.setAttribute("aria-expanded", state.openMenu === task.id ? "true" : "false");
  actions.appendChild(menuButton);

  metaRow.appendChild(actions);
  card.appendChild(metaRow);

  if (state.openMenu === task.id) {
    const menu = document.createElement("div");
    menu.className = "menu panel";
    menu.dataset.menuFor = task.id;
    menu.appendChild(createActionButton("Edit", "edit", task.id));
    menu.appendChild(createActionButton("Archive", "archive", task.id));
    menu.appendChild(createActionButton("Delete", "delete", task.id));
    menu.appendChild(createActionButton("Reminder 5 minutes", "rem", task.id, { v: "5 minutes" }));
    menu.appendChild(createActionButton("Reminder 30 minutes", "rem", task.id, { v: "30 minutes" }));
    menu.appendChild(createActionButton("Reminder 2 hours", "rem", task.id, { v: "2 hours" }));
    menu.appendChild(createActionButton("Reminder 24 hours", "rem", task.id, { v: "24 hours" }));
    menu.appendChild(createActionButton("Reminder custom", "rem", task.id, { v: "Custom" }));
    card.appendChild(menu);
  }

  return card;
}

function renderTaskList(payload) {
  const container = $("tasks");
  clearChildren(container);
  const fragment = document.createDocumentFragment();
  payload.tasks.forEach((task) => {
    fragment.appendChild(createTaskCard(task, payload));
  });
  container.appendChild(fragment);
  $("empty").classList.toggle("hide", payload.tasks.length > 0);
}

function applyTimerOnlyUpdate(previous, next) {
  const oldTaskId = previous.timerTaskId || "";
  const newTaskId = next.timerTaskId || "";

  const currentTimer = document.querySelector('[data-timer-for="' + CSS.escape(newTaskId) + '"]');
  if (currentTimer) {
    currentTimer.textContent = "Timer " + fmt(next.timerElapsedSeconds);
  }

  if (oldTaskId && oldTaskId !== newTaskId) {
    const previousButton = document.querySelector('[data-a="toggle"][data-id="' + CSS.escape(oldTaskId) + '"]');
    if (previousButton) {
      previousButton.textContent = "Start";
      previousButton.dataset.running = "0";
      previousButton.setAttribute("aria-label", "Start timer for task");
    }
    const previousCard = document.querySelector('[data-task-id="' + CSS.escape(oldTaskId) + '"]');
    if (previousCard) {
      previousCard.classList.remove("running");
    }
  }

  const currentButton = document.querySelector('[data-a="toggle"][data-id="' + CSS.escape(newTaskId) + '"]');
  if (currentButton) {
    currentButton.textContent = "Stop";
    currentButton.dataset.running = "1";
    currentButton.setAttribute("aria-label", "Stop timer for task");
  }
  const currentCard = document.querySelector('[data-task-id="' + CSS.escape(newTaskId) + '"]');
  if (currentCard) {
    currentCard.classList.add("running");
  }
}

function isTimerOnlyUpdate(previous, next) {
  if (!previous || !next) {
    return false;
  }

  if (!previous.authenticated || !next.authenticated) {
    return false;
  }

  if (!previous.isTimerRunning || !next.isTimerRunning) {
    return false;
  }

  if (previous.timerElapsedSeconds === next.timerElapsedSeconds) {
    return false;
  }

  const sameStatic =
    previous.mode === next.mode &&
    previous.selectedTaskId === next.selectedTaskId &&
    previous.selectedStatusId === next.selectedStatusId &&
    previous.selectedProjectId === next.selectedProjectId &&
    previous.lastSearchText === next.lastSearchText &&
    previous.autoAppendWorkspaceWorklog === next.autoAppendWorkspaceWorklog &&
    previous.errorMessage === next.errorMessage &&
    previous.infoMessage === next.infoMessage &&
    previous.editTask?.id === next.editTask?.id &&
    previous.tasks.length === next.tasks.length &&
    previous.tasks.every((task, index) => task.id === next.tasks[index].id);

  return sameStatic;
}

function updateMessages(payload, auth) {
  const messageNode = auth ? $("wmsg") : $("amsg");
  messageNode.className = "meta msg " + (payload.errorMessage ? "err" : payload.infoMessage ? "ok" : "");
  messageNode.textContent = payload.errorMessage || payload.infoMessage || "";
}

function render(payload) {
  if (!payload) {
    return;
  }

  if (isTimerOnlyUpdate(state.lastPayload, payload)) {
    applyTimerOnlyUpdate(state.lastPayload, payload);
    state.lastPayload = payload;
    state.data = payload;
    return;
  }

  state.data = payload;
  state.lastPayload = payload;

  $("auth").classList.toggle("hide", payload.authenticated);
  $("work").classList.toggle("hide", !payload.authenticated);

  if (!payload.authenticated) {
    $("email").value = payload.authForm.email || "";
    $("url").value = payload.authForm.url || "";
    $("secret").value = payload.authForm.secret || "";
    state.mode = payload.mode;
    $("sh").classList.toggle("hide", state.mode !== "selfhost");
    $("mode").textContent = state.mode === "selfhost" ? "Use hosted settings" : "Use self-host settings";
    updateMessages(payload, false);
    return;
  }

  $("acc").textContent = payload.accountLabel;
  $("q").value = payload.lastSearchText || "";
  $("autoWorklog").checked = Boolean(payload.autoAppendWorkspaceWorklog);

  setStatusFilterOptions($("sf"), payload.statuses, payload.selectedStatusId);
  setTaskProjectFilterOptions($("pf"), payload.projects, payload.selectedProjectId);

  const editing = Boolean(payload.editTask && state.editId === payload.editTask.id);
  $("list").classList.toggle("hide", editing);
  $("edit").classList.toggle("hide", !editing);
  if (editing) {
    $("enum").textContent = "Task #" + taskNo(payload.editTask);
    $("edesc").value = payload.editTask.description || "";
    autoResizeTextarea($("edesc"));
    const hasRate = payload.editTask.rate !== undefined && payload.editTask.rate !== null && esc(payload.editTask.rate).trim() !== "";
    $("erate").value = hasRate ? String(payload.editTask.rate) : "";
    setProjectOptions($("eproj"), payload.projects, payload.editTask.project_id || "", "-- Unassigned --");
    setUserOptions($("euser"), payload.users, payload.editTask.assigned_user_id || "");
  }

  renderTaskList(payload);
  updateMessages(payload, true);
}

function closeMenuPanel() {
  state.openMenu = "";
  if (state.data) {
    render(state.data);
  }
}

$("mode").addEventListener("click", () => {
  state.mode = state.mode === "cloud" ? "selfhost" : "cloud";
  $("sh").classList.toggle("hide", state.mode !== "selfhost");
  $("mode").textContent = state.mode === "selfhost" ? "Use hosted settings" : "Use self-host settings";
  vscode.postMessage({ type: "toggleMode", mode: state.mode });
});

$("login").addEventListener("click", () => {
  vscode.postMessage({
    type: "login",
    payload: {
      mode: state.mode,
      email: $("email").value.trim(),
      password: $("password").value,
      otp: $("otp").value.trim(),
      url: $("url").value.trim(),
      secret: $("secret").value,
    },
  });
});

$("refresh").addEventListener("click", () => vscode.postMessage({ type: "refresh" }));
$("logout").addEventListener("click", () => vscode.postMessage({ type: "logout" }));
$("save").addEventListener("click", () => vscode.postMessage({ type: "saveTask", payload: { description: $("q").value.trim() } }));
$("search").addEventListener("click", () => vscode.postMessage({ type: "search", payload: { text: $("q").value.trim() } }));
$("sf").addEventListener("change", (event) => vscode.postMessage({ type: "setStatusFilter", payload: { statusId: event.target.value } }));
$("pf").addEventListener("change", (event) => vscode.postMessage({ type: "setProjectFilter", payload: { projectId: event.target.value } }));
$("autoWorklog").addEventListener("change", (event) =>
  vscode.postMessage({ type: "setAutoWorklog", payload: { enabled: Boolean(event.target.checked) } }),
);
$("esave").addEventListener("click", () => {
  if (!state.editId) {
    return;
  }
  vscode.postMessage({
    type: "saveTaskEdit",
    payload: {
      taskId: state.editId,
      description: $("edesc").value,
      projectId: $("eproj").value,
      assignedUserId: $("euser").value,
      rate: $("erate").value,
    },
  });
});
$("eback").addEventListener("click", () => {
  state.editId = "";
  if (state.data) {
    render(state.data);
  }
});

$("tasks").addEventListener("click", (event) => {
  const actionTarget = event.target.closest("[data-a]");
  const card = event.target.closest("[data-task-id]");
  if (!actionTarget && card) {
    vscode.postMessage({ type: "selectTask", payload: { taskId: card.dataset.taskId } });
    return;
  }

  if (!actionTarget) {
    return;
  }

  const taskId = actionTarget.dataset.id || (card ? card.dataset.taskId : "");
  const action = actionTarget.dataset.a;

  if (!taskId || !action) {
    return;
  }

  if (action === "assign-status") {
    vscode.postMessage({ type: "assignTaskStatus", payload: { taskId } });
  }
  if (action === "assign-user") {
    vscode.postMessage({ type: "assignUser", payload: { taskId } });
  }
  if (action === "assign-project") {
    vscode.postMessage({ type: "assignProject", payload: { taskId } });
  }
  if (action === "toggle") {
    const running = actionTarget.dataset.running === "1";
    if (running) {
      vscode.postMessage({ type: "stopTimer", payload: { taskId } });
    } else {
      vscode.postMessage({ type: "startTimer", payload: { taskId } });
    }
  }
  if (action === "menu") {
    state.openMenu = state.openMenu === taskId ? "" : taskId;
    if (state.data) {
      render(state.data);
    }
  }
  if (action === "edit") {
    state.editId = taskId;
    state.openMenu = "";
    vscode.postMessage({ type: "editTask", payload: { taskId } });
  }
  if (action === "archive") {
    state.openMenu = "";
    vscode.postMessage({ type: "archiveTask", payload: { taskId } });
  }
  if (action === "delete") {
    state.openMenu = "";
    vscode.postMessage({ type: "deleteTask", payload: { taskId } });
  }
  if (action === "rem") {
    state.openMenu = "";
    vscode.postMessage({ type: "taskReminder", payload: { taskId, value: actionTarget.dataset.v || "Custom" } });
  }
});

document.addEventListener("click", (event) => {
  const menuPanel = event.target.closest("[data-menu-for]");
  const menuButton = event.target.closest('[data-a="menu"]');
  if (!menuPanel && !menuButton && state.openMenu) {
    closeMenuPanel();
  }
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (state.openMenu) {
      closeMenuPanel();
      event.preventDefault();
    }
  }
});

window.addEventListener("message", (event) => {
  if (event.data && event.data.type === "state") {
    render(event.data.payload);
  }
});

["sf", "pf", "eproj", "euser"].forEach((id) => {
  const node = $(id);
  node.addEventListener("change", () => setSelectValueState(node));
});

$("edesc").addEventListener("input", (event) => autoResizeTextarea(event.target));

vscode.postMessage({ type: "ready" });
`;
}
