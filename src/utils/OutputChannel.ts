import * as vscode from "vscode";

type ConsoleMethod = "log" | "info" | "warn" | "error"
type LogLevel = "INFO" | "WARN" | "ERROR"

let outputChannel: vscode.OutputChannel | undefined;
let consolePatched = false;
const originalConsole: Partial<Record<ConsoleMethod, (...args: unknown[]) => void>> = {};

const levelFromMethod: Record<ConsoleMethod, LogLevel> = {
  log: "INFO",
  info: "INFO",
  warn: "WARN",
  error: "ERROR",
};

const formatArg = (arg: unknown): string => {
  if (typeof arg === "string") {
    return arg;
  }
  if (arg instanceof Error) {
    return arg.stack || arg.message;
  }
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
};

const appendLog = (level: LogLevel, args: unknown[]) => {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel("Node & Kube Dev Companion");
  }
  const timestamp = new Date().toISOString();
  const message = args.map(formatArg).join(" ");
  outputChannel.appendLine(`[${timestamp}] [${level}] ${message}`);
};

const patchConsoleMethod = (method: ConsoleMethod) => {
  if (originalConsole[method]) {
    return;
  }

  originalConsole[method] = console[method].bind(console);
  console[method] = (...args: unknown[]) => {
    originalConsole[method]?.(...args);
    appendLog(levelFromMethod[method], args);
  };
};

export const initializeExtensionOutputChannel = (): vscode.OutputChannel => {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel("Node & Kube Dev Companion");
  }

  if (!consolePatched) {
    ; (["log", "info", "warn", "error"] as ConsoleMethod[]).forEach((method) =>
      patchConsoleMethod(method),
    );
    consolePatched = true;
  }

  return outputChannel;
};

export const logDirect = (level: LogLevel, ...args: unknown[]): void => {
  appendLog(level, args);
};

export const disposeExtensionOutputChannel = (): void => {
  if (consolePatched) {
    ; (["log", "info", "warn", "error"] as ConsoleMethod[]).forEach((method) => {
      if (originalConsole[method]) {
        console[method] = originalConsole[method] as (...args: unknown[]) => void;
        delete originalConsole[method];
      }
    });
    consolePatched = false;
  }

  outputChannel?.dispose();
  outputChannel = undefined;
};
