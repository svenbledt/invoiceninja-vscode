import * as vscode from "vscode";
import { InvoiceNinjaClient } from "./api/invoiceNinjaClient";
import { AuthService } from "./services/authService";
import { TaskService } from "./services/taskService";
import { TimerService } from "./services/timerService";
import { SidebarProvider } from "./ui/sidebarProvider";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const client = new InvoiceNinjaClient();
  const authService = new AuthService(context, client);
  const taskService = new TaskService(context, client, authService);
  const timerService = new TimerService(context, client);
  const sidebarProvider = new SidebarProvider(context, authService, taskService, timerService);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SidebarProvider.viewId, sidebarProvider),
    vscode.commands.registerCommand("invoiceNinja.openSidebar", () => sidebarProvider.open()),
    vscode.commands.registerCommand("invoiceNinja.configure", () => sidebarProvider.open()),
    vscode.commands.registerCommand("invoiceNinja.startTimer", () => sidebarProvider.startTimerFromCommand()),
    vscode.commands.registerCommand("invoiceNinja.stopTimer", () => sidebarProvider.stopTimerFromCommand()),
    vscode.commands.registerCommand("invoiceNinja.showStatus", () => sidebarProvider.showStatus()),
    vscode.commands.registerCommand("invoiceNinja.refresh", () => sidebarProvider.refresh()),
    vscode.commands.registerCommand("invoiceNinja.logout", () => sidebarProvider.logout()),
    { dispose: () => sidebarProvider.dispose() },
  );

  const existingSession = await authService.getSession();
  const autoResumeTimer = Boolean(vscode.workspace.getConfiguration("invoiceNinja").get("autoResumeTimer", true));
  if (!autoResumeTimer) {
    await timerService.clearActiveTimer();
  }
  if (existingSession) {
    try {
      await taskService.refresh(existingSession);
    } catch {
      await authService.logout();
      void vscode.window.showWarningMessage("Invoice Ninja session expired. Please log in again.");
    }
  }
}

export function deactivate(): void {
  // No-op.
}
