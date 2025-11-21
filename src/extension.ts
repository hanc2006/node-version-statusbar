import * as vscode from "vscode"
import { NodeVersionProvider } from "./providers/NodeManagerProvider"
import { KubeSecretProvider } from "./providers/KubeSecretProvider"
import { AwsStatusBarProvider } from "./providers/AwsStatusBarProvider"
import { AwsCredentialManager } from "./managers/AwsCredentialManager"
import {
  KUBE_ENVIRONMENTS,
  KubeEnvironment,
} from "./utils/ConfigUtils"
import { verifyRequiredBinaries } from "./utils/RequireUtils"

export async function activate(context: vscode.ExtensionContext) {
  console.log("Node & Kube Dev Companion extension is now active!")

  const requirementsMet = await verifyRequiredBinaries()
  if (!requirementsMet) {
    console.warn("Missing required CLI dependencies. Extension activation halted.")
    return
  }

  const nodeVersionProvider = new NodeVersionProvider()
  const kubeSecretProvider = new KubeSecretProvider()
  const awsCredentialManager = new AwsCredentialManager()
  const awsStatusBarProvider = new AwsStatusBarProvider(awsCredentialManager)

  const refreshCommand = vscode.commands.registerCommand(
    "nodeVersion.refresh",
    () => {
      nodeVersionProvider.refresh()
    },
  )

  const copyVersionCommand = vscode.commands.registerCommand(
    "nodeVersion.copyVersion",
    async () => {
      const version = await nodeVersionProvider.getNodeVersion()
      if (version) {
        await vscode.env.clipboard.writeText(version)
        vscode.window.showInformationMessage(
          `Node.js version ${version} copied to clipboard!`,
        )
      }
    },
  )

  const switchVersionCommand = vscode.commands.registerCommand(
    "nodeVersion.switchVersion",
    async () => {
      await nodeVersionProvider.showVersionPicker()
    },
  )

  const installVersionCommand = vscode.commands.registerCommand(
    "nodeVersion.installVersion",
    async () => {
      await nodeVersionProvider.installNewVersion()
    },
  )

  const awsSwitchCommand = vscode.commands.registerCommand(
    "awsProfile.switch",
    async () => {
      try {
        const profiles = await awsCredentialManager.refreshProfiles(true)
        if (profiles.length === 0) {
          vscode.window.showWarningMessage(
            "No AWS profiles detected. Configure ~/.aws/config or ~/.aws/credentials first.",
          )
          return
        }

        const activeProfile = awsCredentialManager.getActiveProfileName()
        const items = profiles.map((profile) => ({
          label: `${profile.name === activeProfile ? "$(check) " : ""}${profile.name}`,
          description: profile.hasSso ? "SSO profile" : "Static credentials",
          detail: profile.description,
          profile,
        }))

        const selection = await vscode.window.showQuickPick(items, {
          placeHolder: "Select an AWS profile to activate",
          matchOnDescription: true,
          matchOnDetail: true,
        })

        if (!selection) {
          return
        }

        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Switching to AWS profile ${selection.profile.name}...`,
          },
          async () => {
            await awsCredentialManager.setActiveProfile(selection.profile.name, {
              login: true,
            })
          },
        )

        vscode.window.showInformationMessage(
          `AWS profile switched to ${selection.profile.name}.`,
        )
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error ?? "Unknown error")
        vscode.window.showErrorMessage(`Failed to switch AWS profile: ${message}`)
      }
    },
  )

  const awsLoginCommand = vscode.commands.registerCommand(
    "awsProfile.login",
    async () => {
      try {
        const targetProfile = awsCredentialManager.getActiveProfileName()
        if (!targetProfile) {
          vscode.window.showWarningMessage(
            "Select an AWS profile before starting the login flow.",
          )
          return
        }

        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Authenticating AWS profile ${targetProfile}...`,
          },
          async () => {
            await awsCredentialManager.login(targetProfile)
          },
        )

        vscode.window.showInformationMessage(
          `AWS profile ${targetProfile} authenticated.`,
        )
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error ?? "Unknown error")
        vscode.window.showErrorMessage(`AWS login failed: ${message}`)
      }
    },
  )

  const kubeCommands = KUBE_ENVIRONMENTS.map((env) =>
    vscode.commands.registerCommand(
      `kubeSecrets.generateEnv.${env}`,
      async () => {
        await kubeSecretProvider.generateEnvFile(env as KubeEnvironment)
      },
    ),
  )

  context.subscriptions.push(
    refreshCommand,
    copyVersionCommand,
    switchVersionCommand,
    installVersionCommand,
    awsSwitchCommand,
    awsLoginCommand,
    ...kubeCommands,
    nodeVersionProvider,
    kubeSecretProvider,
    awsCredentialManager,
    awsStatusBarProvider,
  )

  nodeVersionProvider.refresh()
}

export function deactivate() {
  console.log("Node & Kube Dev Companion extension deactivated")
}