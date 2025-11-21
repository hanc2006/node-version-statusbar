import * as vscode from "vscode";
import * as os from "os";
import { runCommand } from "./ProcessUtils";

interface RequiredBinary {
  binary: string
  description: string
  docsUrl?: string
}

const CORE_BINARIES: RequiredBinary[] = [
  {
    binary: "node",
    description: "Node.js runtime",
    docsUrl: "https://nodejs.org/en/download",
  },
  {
    binary: "kubectl",
    description: "kubectl CLI (required for Kubernetes env generation)",
    docsUrl: "https://kubernetes.io/docs/tasks/tools/",
  },
  {
    binary: "aws",
    description: "AWS CLI v2 (required for AWS SSO credential refresh)",
    docsUrl: "https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html",
  },
];

const VERSION_MANAGER_BINARIES: RequiredBinary[] = [
  {
    binary: "nvm",
    description: "Node Version Manager (nvm)",
    docsUrl: "https://github.com/nvm-sh/nvm#installing-and-updating",
  },
  {
    binary: "n",
    description: "Node.js version manager 'n' (macOS/Linux)",
    docsUrl: "https://github.com/tj/n",
  },
];

const isWindows = os.platform() === "win32";

const buildCheckCommand = (binary: string): string =>
  isWindows ? `where ${binary}` : `command -v ${binary}`;

const binaryExists = async (binary: string): Promise<boolean> => {
  const result = await runCommand(buildCheckCommand(binary));
  return !result.failed && result.stdout.trim().length > 0;
};

const findMissingBinaries = async (
  binaries: RequiredBinary[],
): Promise<RequiredBinary[]> => {
  const missing: RequiredBinary[] = [];

  for (const requirement of binaries) {
    try {
      const exists = await binaryExists(requirement.binary);
      if (!exists) {
        missing.push(requirement);
      }
    } catch (error) {
      console.warn(`Failed to verify binary '${requirement.binary}':`, error);
      missing.push(requirement);
    }
  }

  return missing;
};

export const verifyRequiredBinaries = async (): Promise<boolean> => {
  const missingCore = await findMissingBinaries(CORE_BINARIES);
  if (missingCore.length > 0) {
    const detail = missingCore
      .map((req) => `${req.binary} – ${req.description}`)
      .join("\n");

    const action = await vscode.window.showErrorMessage(
      `Node & Kube Dev Companion requires additional CLI tools:\n${detail}`,
      "View Setup Guide",
    );

    if (action === "View Setup Guide") {
      const firstDocs = missingCore[0]?.docsUrl;
      if (firstDocs) {
        void vscode.env.openExternal(vscode.Uri.parse(firstDocs));
      }
    }

    return false;
  }

  const missingManagers = await findMissingBinaries(VERSION_MANAGER_BINARIES);
  if (missingManagers.length === VERSION_MANAGER_BINARIES.length) {
    const actionButtons: string[] = [];
    if (VERSION_MANAGER_BINARIES[0].docsUrl) {
      actionButtons.push("Install nvm");
    }
    if (VERSION_MANAGER_BINARIES[1].docsUrl) {
      actionButtons.push("Install n");
    }

    const action = await vscode.window.showWarningMessage(
      "No Node.js version manager detected (nvm or n). Some Node switching features may be unavailable.",
      ...actionButtons,
    );

    if (action === "Install nvm" && VERSION_MANAGER_BINARIES[0].docsUrl) {
      void vscode.env.openExternal(
        vscode.Uri.parse(VERSION_MANAGER_BINARIES[0].docsUrl as string),
      );
    }

    if (action === "Install n" && VERSION_MANAGER_BINARIES[1].docsUrl) {
      void vscode.env.openExternal(
        vscode.Uri.parse(VERSION_MANAGER_BINARIES[1].docsUrl as string),
      );
    }
  }

  return true;
};
