import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { runCommand, whereis } from "../utils/ProcessUtils";
import { NodeVersion, VersionManager } from "../types";

export async function detectVersionManagers(): Promise<VersionManager[]> {
  const isWindows = os.platform() === "win32";

  const managers: VersionManager[] = [
    {
      name: "nvm",
      command: "nvm",
      listCommand: "nvm list",
      listRemote: isWindows ? "nvm list available" : "nvm ls-remote",
      useCommand: "nvm use",
      isAvailable: false,
    },
  ];

  if (!isWindows) {
    managers.push({
      name: "n",
      command: "n",
      listCommand: "n ls",
      listRemote: "n ls-remote",
      useCommand: "n",
      isAvailable: false,
    });
  }

  for (const manager of managers) {
    manager.isAvailable = await isManagerAvailable(manager, isWindows);
  }

  return managers.filter((m) => m.isAvailable);
}

async function isManagerAvailable(
  manager: VersionManager,
  isWindows: boolean,
): Promise<boolean> {
  const commandToFind =
    isWindows && manager.name === "nvm" ? "nvm.exe" : manager.command;

  try {
    const result = await whereis(commandToFind);
    if (result) {
      return true;
    }
  } catch (error) {
    console.error(`whereis lookup failed for ${manager.name}:`, error);
  }

  return false;
}

export async function getInstalledVersions(
  manager: VersionManager,
): Promise<NodeVersion[]> {
  const versions: NodeVersion[] = [];
  const isWindows = os.platform() === "win32";

  try {
    const execCommand =
      isWindows && manager.name === "nvm"
        ? `cmd /c "${manager.listCommand}"`
        : manager.listCommand;

    const { stdout, stderr, failed } = await runCommand(execCommand);
    if (failed) {
      console.error(`Error getting versions for ${manager.name}:`, stderr);
      return versions;
    }
    const lines = stdout.split("\n").filter((line) => line.trim());

    for (const line of lines) {
      const version = parseVersionLine(line, manager);
      if (version) {
        versions.push(version);
      }
    }
  } catch (error) {
    console.error(`Error getting versions for ${manager.name}:`, error);
  }

  return versions;
}

export async function getRemoteVersions(
  manager: VersionManager,
): Promise<string[]> {
  if (!manager.listRemote) {
    return [];
  }

  const isWindows = os.platform() === "win32";
  const execCommand =
    isWindows && manager.name === "nvm"
      ? `cmd /c "${manager.listRemote}"`
      : manager.listRemote;

  const { stdout, stderr, failed } = await runCommand(execCommand);
  if (failed) {
    console.error(`Error getting remote versions via ${manager.name}:`, stderr);
    return [];
  }
  const versions = new Set<string>();

  stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .forEach((line) => {
      const parsed = parseVersionLine(line, manager);
      if (parsed) {
        versions.add(parsed.version);
        return;
      }

      const fallbackMatch = line.match(/v?\d+\.\d+\.\d+/);
      if (fallbackMatch) {
        const normalized = fallbackMatch[0].startsWith("v")
          ? fallbackMatch[0]
          : `v${fallbackMatch[0]}`;
        versions.add(normalized);
      }
    });

  return Array.from(versions).sort((a, b) =>
    b.localeCompare(a, undefined, { numeric: true }),
  );
}

export function parseVersionLine(
  line: string,
  manager: VersionManager,
): NodeVersion | null {
  const trimmed = line.trim();

  switch (manager.name) {
    case "nvm": {
      const nvmMatch = trimmed.match(/^(\*|\->)?\s*(v?\d+\.\d+\.\d+)/);
      if (nvmMatch) {
        const version = nvmMatch[2].startsWith("v")
          ? nvmMatch[2]
          : `v${nvmMatch[2]}`;
        return {
          version,
          manager,
          isActive: trimmed.includes("->") || trimmed.includes("*"),
          path: undefined,
        };
      }
      break;
    }

    case "n": {
      if (trimmed.startsWith("node/")) {
        return null;
      }
      const nMatch = trimmed.match(/^(=>)?\s*(v?\d+\.\d+\.\d+)/);
      if (nMatch) {
        const parsedVersion = nMatch[2].startsWith("v")
          ? nMatch[2]
          : `v${nMatch[2]}`;
        return {
          version: parsedVersion,
          manager,
          isActive: trimmed.startsWith("=>"),
          path: undefined,
        };
      }
      break;
    }
  }

  return null;
}

export async function resolveNvmPath(): Promise<string | null> {
  if (process.env.NVM_HOME && fs.existsSync(process.env.NVM_HOME)) {
    return path.join(process.env.NVM_HOME, "nvm.exe");
  }

  const appData = process.env.APPDATA;
  if (appData) {
    const defaultNvmPath = path.join(appData, "nvm", "nvm.exe");
    if (fs.existsSync(defaultNvmPath)) {
      return defaultNvmPath;
    }
  }

  try {
    const { stdout, stderr, failed } = await runCommand("where nvm.exe");
    if (failed) {
      console.error("Failed to locate nvm.exe in PATH:", stderr);
      return null;
    }
    const paths = stdout.split("\n").filter((p) => p.trim());
    if (paths.length > 0 && fs.existsSync(paths[0])) {
      return paths[0];
    }
  } catch (error) {
    console.error("Failed to locate nvm.exe in PATH:", error);
  }

  return null;
}
