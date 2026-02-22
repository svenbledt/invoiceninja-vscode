export function taskElapsedSeconds(task: { duration?: number | string; time_log?: string }, nowUnix = Math.floor(Date.now() / 1000)): number {
  const durationText = task.duration === undefined || task.duration === null ? "" : String(task.duration).trim();
  if (durationText) {
    if (durationText.includes(":")) {
      const parts = durationText.split(":").map((value) => Number(value));
      if (parts.length === 3 && parts.every((value) => Number.isFinite(value))) {
        return Math.max(0, Math.round(parts[0] * 3600 + parts[1] * 60 + parts[2]));
      }
      if (parts.length === 2 && parts.every((value) => Number.isFinite(value))) {
        return Math.max(0, Math.round(parts[0] * 60 + parts[1]));
      }
    }

    const duration = Number(durationText);
    if (Number.isFinite(duration)) {
      if (durationText.includes(".") || Math.abs(duration - Math.trunc(duration)) > 0) {
        return Math.max(0, Math.round(duration * 3600));
      }
      return Math.max(0, Math.round(duration));
    }
  }

  const segments = parseTimeLog(task.time_log);
  return segments.reduce((sum, segment) => {
    const start = Number(segment[0]) || 0;
    const end = Number(segment[1]) || 0;
    if (!start) {
      return sum;
    }
    return sum + Math.max(0, (end > 0 ? end : nowUnix) - start);
  }, 0);
}

function parseTimeLog(raw: string | undefined): Array<[number, number]> {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    const result: Array<[number, number]> = [];
    for (const segment of parsed) {
      if (!Array.isArray(segment) || segment.length < 2) {
        continue;
      }

      const start = Number(segment[0]);
      const end = Number(segment[1]);
      if (Number.isFinite(start) && Number.isFinite(end)) {
        result.push([Math.floor(start), Math.floor(end)]);
      }
    }
    return result;
  } catch {
    return [];
  }
}
