export const WORKLOG_SECTION_START = "[InvoiceNinja VSCode Worklog]";
export const WORKLOG_SECTION_END = "[/InvoiceNinja VSCode Worklog]";

const WORKLOG_ENTRY_PATTERN = /^-\s+(\d{4}-\d{2}-\d{2})\s+\|\s+(.+)\s+\|\s+(\d+)s\s*$/;
const DEFAULT_RETENTION_DAYS = 14;

export interface WorklogEntry {
  date: string;
  workspace: string;
  seconds: number;
}

interface ParsedWorklogSection {
  startIndex: number;
  endIndex: number;
  entries: WorklogEntry[];
}

export function worklogMapKey(date: string, workspace: string): string {
  return `${date}|${encodeURIComponent(workspace)}`;
}

export function localDateKey(unixSeconds: number): string {
  const date = new Date(Math.floor(unixSeconds) * 1000);
  return formatLocalDate(date);
}

export function addIntervalToWorklogMap(
  worklog: Record<string, number>,
  workspace: string,
  startUnix: number,
  endUnix: number,
): void {
  const start = Math.floor(startUnix);
  const end = Math.floor(endUnix);
  const label = workspace.trim();
  if (!label || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return;
  }

  let cursor = start;
  while (cursor < end) {
    const dayKey = localDateKey(cursor);
    const nextDayStart = nextLocalDayStartUnix(cursor);
    const segmentEnd = Math.min(end, nextDayStart);
    const seconds = segmentEnd - cursor;
    if (seconds > 0) {
      const key = worklogMapKey(dayKey, label);
      worklog[key] = Math.floor((worklog[key] ?? 0) + seconds);
    }
    cursor = segmentEnd;
  }
}

export function mergeDescriptionWithWorklog(
  existingDescription: string | undefined,
  additions: Record<string, number>,
  nowUnix = Math.floor(Date.now() / 1000),
  retentionDays = DEFAULT_RETENTION_DAYS,
): string {
  const description = typeof existingDescription === "string" ? existingDescription : "";
  const parsed = parseWorklogSection(description);
  const merged = new Map<string, number>();

  if (parsed) {
    for (const entry of parsed.entries) {
      const key = worklogMapKey(entry.date, entry.workspace);
      merged.set(key, Math.floor((merged.get(key) ?? 0) + entry.seconds));
    }
  }

  for (const [key, rawSeconds] of Object.entries(additions)) {
    const parsedKey = parseWorklogMapKey(key);
    const seconds = Math.floor(Number(rawSeconds));
    if (!parsedKey || !Number.isFinite(seconds) || seconds <= 0) {
      continue;
    }
    const normalizedKey = worklogMapKey(parsedKey.date, parsedKey.workspace);
    merged.set(normalizedKey, Math.floor((merged.get(normalizedKey) ?? 0) + seconds));
  }

  pruneWorklogMap(merged, nowUnix, retentionDays);
  const entries = mapToEntries(merged);
  if (entries.length === 0) {
    return description;
  }

  const section = renderWorklogSection(entries);
  if (parsed) {
    return `${description.slice(0, parsed.startIndex)}${section}${description.slice(parsed.endIndex + WORKLOG_SECTION_END.length)}`;
  }

  return appendSection(description, section);
}

function parseWorklogSection(description: string): ParsedWorklogSection | null {
  const startIndex = description.indexOf(WORKLOG_SECTION_START);
  if (startIndex < 0) {
    return null;
  }

  const endIndex = description.indexOf(WORKLOG_SECTION_END, startIndex + WORKLOG_SECTION_START.length);
  if (endIndex < 0) {
    return null;
  }

  const body = description.slice(startIndex + WORKLOG_SECTION_START.length, endIndex);
  const entries: WorklogEntry[] = [];
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    const parsed = parseWorklogLine(line);
    if (parsed) {
      entries.push(parsed);
    }
  }

  return { startIndex, endIndex, entries };
}

function parseWorklogLine(line: string): WorklogEntry | null {
  const match = line.match(WORKLOG_ENTRY_PATTERN);
  if (!match) {
    return null;
  }

  const date = match[1];
  const workspace = match[2].trim();
  const seconds = Number(match[3]);
  if (!workspace || !Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }

  return { date, workspace, seconds: Math.floor(seconds) };
}

function parseWorklogMapKey(key: string): { date: string; workspace: string } | null {
  const separatorIndex = key.indexOf("|");
  if (separatorIndex <= 0) {
    return null;
  }

  const date = key.slice(0, separatorIndex).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return null;
  }

  const encodedWorkspace = key.slice(separatorIndex + 1);
  let workspace = encodedWorkspace;
  try {
    workspace = decodeURIComponent(encodedWorkspace);
  } catch {
    workspace = encodedWorkspace;
  }
  workspace = workspace.trim();
  if (!workspace) {
    return null;
  }

  return { date, workspace };
}

function pruneWorklogMap(entries: Map<string, number>, nowUnix: number, retentionDays: number): void {
  const allowedDays = getRetainedDaySet(nowUnix, retentionDays);
  for (const key of entries.keys()) {
    const parsed = parseWorklogMapKey(key);
    if (!parsed || !allowedDays.has(parsed.date)) {
      entries.delete(key);
    }
  }
}

function getRetainedDaySet(nowUnix: number, retentionDays: number): Set<string> {
  const days = Math.max(1, Math.floor(Number.isFinite(retentionDays) ? retentionDays : DEFAULT_RETENTION_DAYS));
  const today = new Date(Math.floor(nowUnix) * 1000);
  today.setHours(0, 0, 0, 0);

  const retained = new Set<string>();
  for (let offset = 0; offset < days; offset += 1) {
    const date = new Date(today);
    date.setDate(today.getDate() - offset);
    retained.add(formatLocalDate(date));
  }

  return retained;
}

function mapToEntries(values: Map<string, number>): WorklogEntry[] {
  const entries: WorklogEntry[] = [];
  for (const [key, seconds] of values.entries()) {
    const parsed = parseWorklogMapKey(key);
    if (!parsed) {
      continue;
    }
    const normalizedSeconds = Math.floor(seconds);
    if (!Number.isFinite(normalizedSeconds) || normalizedSeconds <= 0) {
      continue;
    }
    entries.push({ date: parsed.date, workspace: parsed.workspace, seconds: normalizedSeconds });
  }

  entries.sort((a, b) => {
    if (a.date !== b.date) {
      return a.date < b.date ? 1 : -1;
    }
    return a.workspace.localeCompare(b.workspace);
  });
  return entries;
}

function renderWorklogSection(entries: WorklogEntry[]): string {
  const lines = entries.map((entry) => `- ${entry.date} | ${entry.workspace} | ${entry.seconds}s`);
  return `${WORKLOG_SECTION_START}\n${lines.join("\n")}\n${WORKLOG_SECTION_END}`;
}

function appendSection(description: string, section: string): string {
  if (!description) {
    return section;
  }

  if (description.endsWith("\n\n")) {
    return `${description}${section}`;
  }
  if (description.endsWith("\n")) {
    return `${description}\n${section}`;
  }
  return `${description}\n\n${section}`;
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function nextLocalDayStartUnix(unixSeconds: number): number {
  const date = new Date(Math.floor(unixSeconds) * 1000);
  date.setHours(24, 0, 0, 0);
  return Math.floor(date.getTime() / 1000);
}
