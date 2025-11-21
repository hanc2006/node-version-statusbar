import * as vscode from "vscode"

const NODE_SECTION = "nodeVersion"
const KUBE_SECTION = "kubeSecrets"
const AWS_SECTION = "awsProfile"

export type PreferredVersionManager = "auto" | "nvm" | "n"

export const KUBE_ENVIRONMENTS = [
	"test",
	"integration",
	"preprod",
	"prod",
] as const

export type KubeEnvironment = typeof KUBE_ENVIRONMENTS[number]

export interface NodeVersionExtensionConfig {
	showInStatusBar: boolean
	statusBarText: string
	refreshInterval: number
	preferredManager: PreferredVersionManager
	showSwitchButton: boolean
}

export interface KubeSecretExtensionConfig {
	envDirectory: string
}

export interface AwsProfileExtensionConfig {
	showInStatusBar: boolean
	statusBarText: string
	defaultProfile: string
	refreshInterval: number
	showSwitchButton: boolean
}

export const DEFAULT_ENV_DIRECTORY = "src/Common/Environment"

export const getNodeVersionConfig = (
	scope?: vscode.ConfigurationScope,
): NodeVersionExtensionConfig => {
	const config = vscode.workspace.getConfiguration(NODE_SECTION, scope)

	return {
		showInStatusBar: config.get<boolean>("showInStatusBar", true),
		statusBarText: config.get<string>(
			"statusBarText",
			"$(symbol-method) Node {version}",
		),
		refreshInterval: config.get<number>("refreshInterval", 0),
		preferredManager: config.get<PreferredVersionManager>(
			"preferredManager",
			"auto",
		),
		showSwitchButton: config.get<boolean>("showSwitchButton", true),
	}
}

export const updateNodeVersionConfig = async <
	K extends keyof NodeVersionExtensionConfig,
>(
	key: K,
	value: NodeVersionExtensionConfig[K],
	target: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Workspace,
	scope?: vscode.ConfigurationScope,
): Promise<void> => {
	await vscode.workspace
		.getConfiguration(NODE_SECTION, scope)
		.update(key, value, target)
}

export const getKubeSecretConfig = (
	scope?: vscode.ConfigurationScope,
): KubeSecretExtensionConfig => {
	const config = vscode.workspace.getConfiguration(KUBE_SECTION, scope)
	return {
		envDirectory: config.get<string>("envDirectory", DEFAULT_ENV_DIRECTORY),
	}
}

export const getAwsProfileConfig = (
	scope?: vscode.ConfigurationScope,
): AwsProfileExtensionConfig => {
	const config = vscode.workspace.getConfiguration(AWS_SECTION, scope)

	return {
		showInStatusBar: config.get<boolean>("showInStatusBar", true),
		statusBarText: config.get<string>(
			"statusBarText",
			"$(cloud) AWS {profile}",
		),
		defaultProfile: config.get<string>("defaultProfile", "default"),
		refreshInterval: config.get<number>("refreshInterval", 0),
		showSwitchButton: config.get<boolean>("showSwitchButton", true),
	}
}

export const updateAwsProfileConfig = async <
	K extends keyof AwsProfileExtensionConfig,
>(
	key: K,
	value: AwsProfileExtensionConfig[K],
	target: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Workspace,
	scope?: vscode.ConfigurationScope,
): Promise<void> => {
	await vscode.workspace
		.getConfiguration(AWS_SECTION, scope)
		.update(key, value, target)
}

export const updateKubeSecretConfig = async <
	K extends keyof KubeSecretExtensionConfig,
>(
	key: K,
	value: KubeSecretExtensionConfig[K],
	target: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Workspace,
	scope?: vscode.ConfigurationScope,
): Promise<void> => {
	await vscode.workspace
		.getConfiguration(KUBE_SECTION, scope)
		.update(key, value, target)
}
