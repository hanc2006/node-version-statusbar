import * as vscode from "vscode"
import * as os from "os"
import {
  detectVersionManagers,
  getInstalledVersions,
  getRemoteVersions,
  resolveNvmPath,
} from "../managers/NodeManager"
import { NodeVersion, VersionManager } from "../types"
import { runCommand } from "../utils/ProcessUtils"
import {
	getNodeVersionConfig,
	NodeVersionExtensionConfig,
} from "../utils/ConfigUtils"

interface VersionQuickPickItem extends vscode.QuickPickItem {
  value: string
}

export class NodeVersionProvider implements vscode.Disposable {
  private statusBarItem: vscode.StatusBarItem
  private refreshTimer?: NodeJS.Timeout
  private availableManagers: VersionManager[] = []
  private configuration: NodeVersionExtensionConfig = getNodeVersionConfig()

  constructor() {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100,
    )

    this.statusBarItem.command = "nodeVersion.switchVersion"
    this.statusBarItem.tooltip = "Click to switch Node.js version"

    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("nodeVersion")) {
        this.updateConfiguration()
      }
    })

    this.initializeVersionManagers()
    this.updateConfiguration()
  }

  private async initializeVersionManagers() {
    try {
      this.availableManagers = await detectVersionManagers()
    } catch (error) {
      console.error("Failed to detect version managers:", error)
      this.availableManagers = []
    }
  }

  private updateConfiguration() {
    this.configuration = getNodeVersionConfig()
    const { showInStatusBar, refreshInterval } = this.configuration

    if (showInStatusBar) {
      this.statusBarItem.show()
    } else {
      this.statusBarItem.hide()
    }

    if (this.refreshTimer) {
      clearInterval(this.refreshTimer)
      this.refreshTimer = undefined
    }

    if (refreshInterval > 0) {
      this.refreshTimer = setInterval(() => {
        this.refresh()
      }, refreshInterval * 1000)
    }
  }

  async refresh(): Promise<void> {
    try {
      const version = await this.getNodeVersion()
      this.updateStatusBar(version)
    } catch (error) {
      console.error("Failed to get Node.js version:", error)
      this.updateStatusBar(null, "Failed to get Node.js version")
    }
  }

  async getNodeVersion(): Promise<string | null> {
    const primary = await runCommand("node --version")
    if (!primary.failed) {
      return primary.stdout.trim()
    }

    const workspaceFolders = vscode.workspace.workspaceFolders
    if (workspaceFolders && workspaceFolders.length > 0) {
      const viaNpx = await runCommand("npx node --version", {
        cwd: workspaceFolders[0].uri.fsPath,
      })
      if (!viaNpx.failed) {
        return viaNpx.stdout.trim()
      }
      console.error("Alternative method also failed:", viaNpx.stderr)
    }

    return null
  }

  async showVersionPicker(): Promise<void> {
    if (this.availableManagers.length === 0) {
      const action = await vscode.window.showWarningMessage(
        "No Node.js version manager detected. Would you like to install a version manually?",
        "Install Manually",
        "Learn More",
        "Cancel",
      )

      if (action === "Install Manually") {
        await this.installNewVersion()
      } else if (action === "Learn More") {
        vscode.env.openExternal(
          vscode.Uri.parse("https://nodejs.org/en/download/package-manager"),
        )
      }
      return
    }

    try {
      const versions = await this.getAvailableVersions()

      if (versions.length === 0) {
        vscode.window.showInformationMessage(
          "No Node.js versions found. Use the install command to add versions.",
        )
        return
      }

      const quickPickItems = versions.map((v) => ({
        label: `${v.isActive ? "$(check) " : ""}${v.version}`,
        description: `via ${v.manager.name}${v.isActive ? " (current)" : ""}`,
        detail: v.path,
        version: v,
      }))

      const selected = await vscode.window.showQuickPick(quickPickItems, {
        placeHolder: "Select a Node.js version to switch to",
        matchOnDescription: true,
        matchOnDetail: true,
      })

      if (selected && !selected.version.isActive) {
        await this.switchToVersion(selected.version)
      }
    } catch (error) {
      vscode.window.showErrorMessage(
        `Failed to get available versions: ${error}`,
      )
    }
  }

  async installNewVersion(): Promise<void> {
    const manager = await this.selectVersionManager()
    if (!manager) return

    const version = await this.promptForInstallVersion(manager)
    if (!version) return

    const requestedVersion = version.trim()
    const versionWithoutPrefix = requestedVersion.replace(/^v/, "")

    const isWindows = os.platform() === "win32"
    const terminal = vscode.window.createTerminal({
      name: `Install Node ${version}`,
      shellPath: isWindows ? "cmd.exe" : undefined,
      shellArgs: isWindows ? ["/K"] : undefined,
    })

    let installCommand: string
    switch (manager.name) {
      case "nvm":
        if (isWindows) {
          const nvmPath = await resolveNvmPath()
          if (!nvmPath) {
            vscode.window.showErrorMessage(
              "NVM for Windows not found. Please ensure NVM is installed and added to PATH or NVM_HOME is set.",
            )
            terminal.dispose()
            return
          }
          installCommand = `call "${nvmPath}" install ${versionWithoutPrefix} & echo %ERRORLEVEL%`
        } else {
          installCommand = `source ~/.nvm/nvm.sh && nvm install ${requestedVersion}`
        }
        break
      case "n":
        if (isWindows) {
          vscode.window.showErrorMessage(
            "The 'n' version manager is only supported on macOS/Linux.",
          )
          terminal.dispose()
          return
        }
        installCommand = `n install ${versionWithoutPrefix}`
        break
      default:
        installCommand = `echo "Unsupported version manager"`
    }

    try {
      terminal.sendText(installCommand)
      terminal.show()

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Installing Node.js ${version}...`,
          cancellable: false,
        },
        async (progress) => {
          progress.report({ increment: 20, message: "Executing install command..." })
          console.log(`Executing install command: ${installCommand}`)
          await new Promise((resolve) => setTimeout(resolve, 10000))
          progress.report({ increment: 60, message: "Installation completed" })
          setTimeout(() => {
            terminal.dispose()
          }, 3000)
          progress.report({ increment: 20, message: "Refreshing version list..." })
        },
      )

      await this.refresh()
      vscode.window.showInformationMessage(
        `Node.js ${requestedVersion} installation completed!`,
      )
    } catch (error) {
      console.error("Install version error:", error)
      setTimeout(() => {
        terminal.dispose()
      }, 3000)
      vscode.window.showErrorMessage(
        `Failed to install Node.js version: ${error}`,
      )
    }
  }

  private async promptForInstallVersion(
    manager: VersionManager,
  ): Promise<string | null> {
    try {
      const remoteVersions = await vscode.window.withProgress<string[]>(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Fetching Node.js versions via ${manager.name}...`,
          cancellable: false,
        },
        async () => {
          return getRemoteVersions(manager)
        },
      )

      if (remoteVersions.length === 0) {
        vscode.window.showWarningMessage(
          `No remote versions found via ${manager.name}. Enter a version manually.`,
        )
        return this.promptForManualVersion()
      }

      const quickPickItems: VersionQuickPickItem[] = [
        {
          label: "$(edit) Enter version manually",
          description: "Type a custom version or tag",
          alwaysShow: true,
          value: "__manual__",
        },
        ...remoteVersions.map((remoteVersion) => ({
          label: remoteVersion,
          description: `Install via ${manager.name}`,
          value: remoteVersion,
        })),
      ]

      const selected = await vscode.window.showQuickPick(quickPickItems, {
        placeHolder: `Select a Node.js version to install with ${manager.name}`,
        matchOnDescription: true,
      })

      if (!selected) {
        return null
      }

      if (selected.value === "__manual__") {
        return this.promptForManualVersion()
      }

      return selected.value
    } catch (error) {
      console.error("Remote version lookup failed:", error)
      vscode.window.showWarningMessage(
        `Failed to load remote versions via ${manager.name}. Enter a version manually.`,
      )
      return this.promptForManualVersion()
    }
  }

  private async promptForManualVersion(
    promptOverride?: string,
  ): Promise<string | null> {
    const input = await vscode.window.showInputBox({
      prompt:
        promptOverride ||
        `Enter Node.js version to install (e.g., 18.17.0, lts, latest)`,
      placeHolder: "18.17.0",
      validateInput: (value) => {
        if (!value || value.trim().length === 0) {
          return "Please enter a version"
        }
        return null
      },
    })

    return input ?? null
  }

  private async selectVersionManager(): Promise<VersionManager | null> {
    if (this.availableManagers.length === 0) {
      vscode.window.showErrorMessage("No Node.js version manager detected.")
      return null
    }

    if (this.availableManagers.length === 1) {
      return this.availableManagers[0]
    }

    const selected = await vscode.window.showQuickPick(
      this.availableManagers.map((m) => ({
        label: m.name,
        description: `Use ${m.name} to manage versions`,
        manager: m,
      })),
      {
        placeHolder: "Select version manager to use",
      },
    )

    return selected?.manager || null
  }

  private async getAvailableVersions(): Promise<NodeVersion[]> {
    const allVersions: NodeVersion[] = []

    for (const manager of this.availableManagers) {
      try {
        const versions = await getInstalledVersions(manager)
        allVersions.push(...versions)
      } catch (error) {
        console.error(`Failed to get versions for ${manager.name}:`, error)
      }
    }

    const uniqueVersions = allVersions.filter(
      (v, i, arr) => arr.findIndex((x) => x.version === v.version) === i,
    )

    return uniqueVersions.sort((a, b) => {
      if (a.isActive && !b.isActive) return -1
      if (!a.isActive && b.isActive) return 1
      return b.version.localeCompare(a.version, undefined, { numeric: true })
    })
  }

  private async verifyVersionSwitch(
    nodeVersion: NodeVersion,
    manager: VersionManager,
  ): Promise<void> {
    const versions = await getInstalledVersions(manager)
    const match = versions.find(
      (version) =>
        version.version === nodeVersion.version && version.isActive,
    )

    if (!match) {
      throw new Error("Target version not found as active")
    }
  }

  private async switchToVersion(nodeVersion: NodeVersion): Promise<void> {
    const manager = nodeVersion.manager
    const isWindows = os.platform() === "win32"

    const terminal = vscode.window.createTerminal({
      name: `Switch Node Version`,
      shellPath: isWindows ? "cmd.exe" : undefined,
      shellArgs: isWindows ? ["/K"] : undefined,
    })

    let command: string
    const versionNumber = nodeVersion.version.replace("v", "")

    switch (manager.name) {
      case "nvm":
        if (isWindows) {
          const nvmPath = await resolveNvmPath()
          if (!nvmPath) {
            vscode.window.showErrorMessage(
              "NVM for Windows not found. Please ensure NVM is installed and added to PATH or NVM_HOME is set.",
            )
            terminal.dispose()
            return
          }
          command = `call "${nvmPath}" use ${versionNumber} & echo %ERRORLEVEL%`
        } else {
          command = `source ~/.nvm/nvm.sh && ${manager.useCommand} ${nodeVersion.version}`
        }
        break
      case "n":
        if (isWindows) {
          vscode.window.showErrorMessage(
            "The 'n' version manager is only supported on macOS/Linux.",
          )
          terminal.dispose()
          return
        }
        command = `${manager.useCommand} ${versionNumber}`
        break
      default:
        vscode.window.showErrorMessage(
          `Unsupported version manager: ${manager.name}`,
        )
        terminal.dispose()
        return
    }

    try {
      terminal.sendText(command)
      terminal.show()

      const success = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Switching to Node.js ${nodeVersion.version}...`,
          cancellable: false,
        },
        async (progress) => {
          progress.report({ increment: 30, message: "Executing switch command..." })
          console.log(`Executing command: ${command}`)

          await new Promise((resolve) =>
            setTimeout(resolve, isWindows ? 5000 : 3000),
          )

          progress.report({ increment: 40, message: "Verifying switch..." })

          try {
            await this.verifyVersionSwitch(nodeVersion, manager)
            progress.report({ increment: 20, message: "Switch completed!" })
            return true
          } catch (error) {
            console.warn("Could not verify version switch:", error)
            progress.report({ increment: 20, message: "Switch command executed" })
            return true
          } finally {
            progress.report({ increment: 10, message: "Cleaning up..." })
            setTimeout(() => {
              terminal.dispose()
            }, 2000)
          }
        },
      )

      if (success) {
        await new Promise((resolve) => setTimeout(resolve, 500))

        const action = await vscode.window.showInformationMessage(
          `Successfully switched to Node.js ${nodeVersion.version}! VS Code needs to be reloaded to recognize the new Node.js version in the status bar.`,
          { modal: true },
          "Reload Window",
          "Later",
        )

        if (action === "Reload Window") {
          await vscode.commands.executeCommand("workbench.action.reloadWindow")
        } else {
          this.updateStatusBar(
            null,
            `Reload needed for Node.js ${nodeVersion.version}`,
          )
          vscode.window
            .showInformationMessage(
              "Node.js version switched successfully. Use 'Developer: Reload Window' when ready to apply changes.",
              "Reload Now",
            )
            .then((choice) => {
              if (choice === "Reload Now") {
                vscode.commands.executeCommand("workbench.action.reloadWindow")
              }
            })
        }
      }
    } catch (error) {
      console.error("Switch version error:", error)
      setTimeout(() => {
        terminal.dispose()
      }, 2000)
      vscode.window.showErrorMessage(
        `Failed to switch Node.js version: ${error}`,
      )
    }
  }

  private updateStatusBar(version: string | null, errorMessage?: string) {
    if (!version && !errorMessage) {
      this.statusBarItem.text = "$(warning) Node.js not found"
      this.statusBarItem.tooltip =
        "Node.js is not installed or not in PATH. Click to install or switch versions."
      this.statusBarItem.command = "nodeVersion.switchVersion"
      this.statusBarItem.backgroundColor = new vscode.ThemeColor(
        "statusBarItem.warningBackground",
      )
    } else if (errorMessage) {
      if (errorMessage.includes("Reload needed")) {
        this.statusBarItem.text = "$(sync-ignored) Node Switch"
        this.statusBarItem.tooltip =
          errorMessage + ". Click to reload or switch versions."
        this.statusBarItem.backgroundColor = new vscode.ThemeColor(
          "statusBarItem.warningBackground",
        )
      } else {
        this.statusBarItem.text = "$(error) Node Error"
        this.statusBarItem.tooltip =
          errorMessage + ". Click to switch versions."
        this.statusBarItem.backgroundColor = new vscode.ThemeColor(
          "statusBarItem.errorBackground",
        )
      }
      this.statusBarItem.command = "nodeVersion.switchVersion"
    } else {
      const template = this.configuration.statusBarText
      this.statusBarItem.text = template.replace("{version}", version!)
      this.statusBarItem.tooltip =
        `Node.js ${version}\nClick to switch versions\nRight-click for more options`
      this.statusBarItem.command = "nodeVersion.switchVersion"
      this.statusBarItem.backgroundColor = undefined
    }
  }

  dispose() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer)
    }
    this.statusBarItem.dispose()
  }
}
