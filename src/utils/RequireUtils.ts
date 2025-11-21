import * as vscode from "vscode"
import * as os from "os"
import { runCommand } from "./ProcessUtils"

interface RequiredBinary {
  binary: string
  description: string
  docsUrl?: string
}

const REQUIRED_BINARIES: RequiredBinary[] = [
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
]

const isWindows = os.platform() === "win32"

const buildCheckCommand = (binary: string): string =>
  isWindows ? `where ${binary}` : `command -v ${binary}`

const binaryExists = async (binary: string): Promise<boolean> => {
  const result = await runCommand(buildCheckCommand(binary))
  return !result.failed && result.stdout.trim().length > 0
}

export const verifyRequiredBinaries = async (): Promise<boolean> => {
  const missing: RequiredBinary[] = []

  for (const requirement of REQUIRED_BINARIES) {
    try {
      const exists = await binaryExists(requirement.binary)
      if (!exists) {
        missing.push(requirement)
      }
    } catch (error) {
      console.warn(`Failed to verify binary '${requirement.binary}':`, error)
      missing.push(requirement)
    }
  }

  if (missing.length === 0) {
    return true
  }

  const detail = missing
    .map((req) => `${req.binary} – ${req.description}`)
    .join("\n")

  const action = await vscode.window.showErrorMessage(
    `Node & Kube Dev Companion requires additional CLI tools:\n${detail}`,
    "View Setup Guide",
  )

  if (action === "View Setup Guide") {
    const firstDocs = missing[0]?.docsUrl
    if (firstDocs) {
      void vscode.env.openExternal(vscode.Uri.parse(firstDocs))
    }
  }

  return false
}
