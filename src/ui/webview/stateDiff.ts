import { InvoiceNinjaTask, SidebarState } from "../../types/contracts";

export function taskSignature(task: InvoiceNinjaTask): string {
  return [
    task.id,
    task.number ?? "",
    task.description ?? "",
    task.project_id ?? "",
    task.assigned_user_id ?? "",
    String(task.task_status_id ?? task.status_id ?? ""),
    String(task.rate ?? ""),
    String(task.duration ?? ""),
    task.time_log ?? "",
  ].join("|");
}

export function isTimerOnlyStateUpdate(previous: SidebarState | null, next: SidebarState): boolean {
  if (!previous || !previous.authenticated || !next.authenticated) {
    return false;
  }

  if (!previous.isTimerRunning || !next.isTimerRunning) {
    return false;
  }

  if (previous.timerElapsedSeconds === next.timerElapsedSeconds) {
    return false;
  }

  if (previous.tasks.length !== next.tasks.length) {
    return false;
  }

  for (let index = 0; index < next.tasks.length; index += 1) {
    if (taskSignature(previous.tasks[index]) !== taskSignature(next.tasks[index])) {
      return false;
    }
  }

  return (
    previous.mode === next.mode &&
    previous.selectedTaskId === next.selectedTaskId &&
    previous.selectedProjectId === next.selectedProjectId &&
    previous.selectedStatusId === next.selectedStatusId &&
    previous.lastSearchText === next.lastSearchText &&
    previous.autoAppendWorkspaceWorklog === next.autoAppendWorkspaceWorklog &&
    previous.errorMessage === next.errorMessage &&
    previous.infoMessage === next.infoMessage &&
    previous.editTask?.id === next.editTask?.id
  );
}
