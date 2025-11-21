import * as vscode from "vscode";
import { fromIni, fromSSO } from "@aws-sdk/credential-providers";
import { AwsProfile, AwsStatusSnapshot } from "../types";
import {
	AwsProfileExtensionConfig,
	getAwsProfileConfig,
} from "../utils/ConfigUtils";
import { readAwsProfiles } from "../utils/AwsConfigParser";

type SetActiveOptions = {
	login?: boolean
}

export class AwsCredentialManager implements vscode.Disposable {
	private profiles: AwsProfile[] = [];
	private activeProfileName: string | null = null;
	private config: AwsProfileExtensionConfig = getAwsProfileConfig();
	private refreshTimer?: NodeJS.Timeout;
	private readonly profileEmitter = new vscode.EventEmitter<AwsProfile[]>();
	private readonly statusEmitter = new vscode.EventEmitter<AwsStatusSnapshot>();
	private configurationListener: vscode.Disposable;
	private lastStatus: AwsStatusSnapshot = {
		profileName: null,
		state: "idle",
		message: "AWS profile not selected",
	};

	readonly onProfilesChanged = this.profileEmitter.event;
	readonly onStatusChanged = this.statusEmitter.event;

	constructor() {
		this.configurationListener = vscode.workspace.onDidChangeConfiguration(
			(event) => {
				if (event.affectsConfiguration("awsProfile")) {
					this.updateConfiguration();
				}
			},
		);

		void this.refreshProfiles(true);
		this.scheduleRefresh();
	}

	dispose() {
		this.profileEmitter.dispose();
		this.statusEmitter.dispose();
		this.configurationListener.dispose();
		if (this.refreshTimer) {
			clearInterval(this.refreshTimer);
		}
	}

	getProfiles(): AwsProfile[] {
		return this.profiles;
	}

	getActiveProfileName(): string | null {
		return this.activeProfileName;
	}

	getStatusSnapshot(): AwsStatusSnapshot {
		return this.lastStatus;
	}

	async refreshProfiles(forceReload = false): Promise<AwsProfile[]> {
		if (!forceReload && this.profiles.length > 0) {
			return this.profiles;
		}

		try {
			this.profiles = await readAwsProfiles();
			if (!this.profiles.find((profile) => profile.name === this.activeProfileName)) {
				this.activeProfileName = this.determineDefaultProfile();
			}
			this.profileEmitter.fire(this.profiles);
		} catch (error) {
			console.error("Failed to load AWS profiles", error);
			this.profiles = [];
			this.profileEmitter.fire([]);
		}

		return this.profiles;
	}

	async setActiveProfile(
		profileName: string,
		options: SetActiveOptions = {},
	): Promise<void> {
		if (!this.profiles.find((profile) => profile.name === profileName)) {
			await this.refreshProfiles(true);
		}

		const profile = this.profiles.find((p) => p.name === profileName);
		if (!profile) {
			throw new Error(`AWS profile '${profileName}' not found`);
		}

		this.activeProfileName = profile.name;
		process.env.AWS_PROFILE = profile.name;
		this.emitStatus({
			profileName: profile.name,
			state: "idle",
			message: profile.hasSso
				? "Ready for AWS SSO login"
				: "Using static credentials",
		});

		if (options.login) {
			await this.login(profile.name);
		}
	}

	async login(profileName?: string): Promise<AwsStatusSnapshot> {
		if (!profileName && !this.activeProfileName) {
			await this.setActiveProfile(
				this.determineDefaultProfile() ||
					(await this.refreshProfiles(true))[0]?.name ||
					"default",
			);
		}

		const targetName = profileName || this.activeProfileName;
		if (!targetName) {
			throw new Error("No AWS profile selected");
		}

		if (!this.profiles.find((profile) => profile.name === targetName)) {
			await this.refreshProfiles(true);
		}

		const profile = this.profiles.find((p) => p.name === targetName);
		if (!profile) {
			throw new Error(`AWS profile '${targetName}' not found`);
		}

		this.emitStatus({
			profileName: profile.name,
			state: "authenticating",
			message: "Signing in via AWS SDK...",
		});

		try {
			const provider = profile.hasSso
				? fromSSO({ profile: profile.name })
				: fromIni({ profile: profile.name });

			const credentials = await provider();
			const snapshot: AwsStatusSnapshot = {
				profileName: profile.name,
				state: "authenticated",
				lastChecked: new Date(),
				expiresAt:
					"expiration" in credentials && credentials.expiration
						? new Date(credentials.expiration)
						: undefined,
				message: profile.hasSso
					? "AWS SSO credentials loaded"
					: "Static AWS credentials loaded",
			};

			this.emitStatus(snapshot);
			return snapshot;
		} catch (error) {
			const message =
				error instanceof Error ? error.message : String(error ?? "Unknown error");
			const snapshot: AwsStatusSnapshot = {
				profileName: profile.name,
				state: "error",
				message,
				lastChecked: new Date(),
			};
			this.emitStatus(snapshot);
			throw error;
		}
	}

	private emitStatus(snapshot: AwsStatusSnapshot) {
		this.lastStatus = snapshot;
		this.statusEmitter.fire(snapshot);
	}

	private determineDefaultProfile(): string | null {
		const envProfile = process.env.AWS_PROFILE;
		if (envProfile && this.profiles.some((profile) => profile.name === envProfile)) {
			return envProfile;
		}
		if (
			this.config.defaultProfile &&
			this.profiles.some((profile) => profile.name === this.config.defaultProfile)
		) {
			return this.config.defaultProfile;
		}
		return this.profiles[0]?.name ?? null;
	}

	private updateConfiguration() {
		this.config = getAwsProfileConfig();
		this.scheduleRefresh();
		if (this.config.defaultProfile && !this.activeProfileName) {
			void this.setActiveProfile(this.config.defaultProfile).catch((error) => {
				console.warn("Failed to set default AWS profile", error);
			});
		}
	}

	private scheduleRefresh() {
		if (this.refreshTimer) {
			clearInterval(this.refreshTimer);
			this.refreshTimer = undefined;
		}

		if (this.config.refreshInterval > 0) {
			this.refreshTimer = setInterval(() => {
				if (!this.activeProfileName) {
					return;
				}
				void this.login(this.activeProfileName).catch((error) => {
					console.warn("AWS credential refresh failed", error);
				});
			}, this.config.refreshInterval * 1000);
		}
	}
}