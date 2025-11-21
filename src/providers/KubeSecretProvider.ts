import * as vscode from "vscode"
import { KubeEnvironment } from "../utils/ConfigUtils"
import {
  KUBE_NAMESPACES,
  ServiceName,
  resolveNamespaceForSecret,
  writeEnvLocalFromK8sSecret,
} from "../managers/KubeSecretManager"

const ALL_SERVICE_NAMES = Object.values(KUBE_NAMESPACES).flat() as ServiceName[]
const KNOWN_SERVICES = new Set<ServiceName>(ALL_SERVICE_NAMES)

const normalizePackageName = (packageName: string): string => {
  const trimmed = packageName.trim()
  if (trimmed.startsWith("@")) {
    const parts = trimmed.split("/")
    return parts[1] ?? trimmed
  }
  return trimmed
}

const isKnownService = (value: string): value is ServiceName =>
  KNOWN_SERVICES.has(value as ServiceName)

export class KubeSecretProvider implements vscode.Disposable {
  async generateEnvFile(environment: KubeEnvironment): Promise<void> {
    const serviceName = await this.resolveServiceFromPackage()
    if (!serviceName) {
      return
    }

    try {
      const namespace = resolveNamespaceForSecret(serviceName)
      const filePath = await writeEnvLocalFromK8sSecret(serviceName, environment)

      const action = await vscode.window.showInformationMessage(
        `Created ${environment} env file for ${serviceName} (namespace: ${namespace}).`,
        "Open File",
        "Dismiss",
      )

      if (action === "Open File") {
        const document = await vscode.workspace.openTextDocument(
          vscode.Uri.file(filePath),
        )
        await vscode.window.showTextDocument(document)
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error ?? "Unknown error")
      vscode.window.showErrorMessage(
        `Failed to generate Kubernetes env file: ${message}`,
      )
    }
  }

  private async resolveServiceFromPackage(): Promise<ServiceName | null> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
    if (!workspaceFolder) {
      vscode.window.showErrorMessage(
        "Cannot locate workspace folder. Open a workspace with package.json before running the command.",
      )
      return null
    }

    const packageUri = vscode.Uri.joinPath(workspaceFolder.uri, "package.json")

    let contents: Uint8Array
    try {
      contents = await vscode.workspace.fs.readFile(packageUri)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error ?? "Unknown error")
      vscode.window.showErrorMessage(
        `Unable to read package.json for Kubernetes secret generation: ${message}`,
      )
      return null
    }

    let packageJson: unknown
    try {
      packageJson = JSON.parse(Buffer.from(contents).toString("utf8"))
    } catch (error) {
      vscode.window.showErrorMessage(
        "Failed to parse package.json. Ensure the file contains valid JSON.",
      )
      return null
    }

    const rawName =
      packageJson && typeof packageJson === "object"
        ? (packageJson as { name?: unknown }).name
        : undefined

    if (typeof rawName !== "string" || rawName.trim().length === 0) {
      vscode.window.showErrorMessage(
        "package.json is missing the 'name' field. Define the service name to generate Kubernetes env files.",
      )
      return null
    }

    const normalizedName = normalizePackageName(rawName)

    if (!isKnownService(normalizedName)) {
      const available = ALL_SERVICE_NAMES.join(", ")
      vscode.window.showErrorMessage(
        `Service '${normalizedName}' is not recognized. Update package.json name to match one of the supported services: ${available}.`,
      )
      return null
    }

    return normalizedName
  }

  dispose() {}
}
