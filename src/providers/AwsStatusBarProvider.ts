import * as vscode from "vscode";
import { AwsCredentialManager } from "../managers/AwsCredentialManager";
import { AwsStatusSnapshot } from "../types";
import {
  AwsProfileExtensionConfig,
  getAwsProfileConfig,
} from "../utils/ConfigUtils";

export class AwsStatusBarProvider implements vscode.Disposable {
  private readonly manager: AwsCredentialManager;
  private readonly statusBarItem: vscode.StatusBarItem;
  private config: AwsProfileExtensionConfig;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(manager: AwsCredentialManager) {
    this.manager = manager;
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      95,
    );
    this.config = getAwsProfileConfig();

    this.disposables.push(
      this.manager.onStatusChanged((snapshot) => this.updateStatus(snapshot)),
      this.manager.onProfilesChanged(() =>
        this.updateStatus(this.manager.getStatusSnapshot()),
      ),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("awsProfile")) {
          this.config = getAwsProfileConfig();
          this.applyConfiguration();
          this.updateStatus(this.manager.getStatusSnapshot());
        }
      }),
    );

    this.applyConfiguration();
    this.updateStatus(this.manager.getStatusSnapshot());
  }

  dispose() {
    this.statusBarItem.dispose();
    this.disposables.forEach((disposable) => disposable.dispose());
  }

  private applyConfiguration() {
    if (this.config.showSwitchButton) {
      this.statusBarItem.command = "awsProfile.switch";
    } else {
      this.statusBarItem.command = undefined;
    }

    if (this.config.showInStatusBar) {
      this.statusBarItem.show();
    } else {
      this.statusBarItem.hide();
    }
  }

  private updateStatus(snapshot: AwsStatusSnapshot) {
    const profileName = snapshot.profileName ?? this.config.defaultProfile ?? "default";
    const text = this.config.statusBarText
      .replace("{profile}", profileName)
      .replace("{state}", snapshot.state);

    this.statusBarItem.text = text;

    const tooltipLines = [
      `Profile: ${profileName}`,
      `State: ${snapshot.state}`,
    ];

    if (snapshot.message) {
      tooltipLines.push(snapshot.message);
    }

    if (snapshot.expiresAt) {
      tooltipLines.push(
        `Expires: ${snapshot.expiresAt.toLocaleString()} (${snapshot.expiresAt.toISOString()})`,
      );
    }

    if (snapshot.lastChecked) {
      tooltipLines.push(`Last Checked: ${snapshot.lastChecked.toLocaleString()}`);
    }

    this.statusBarItem.tooltip = tooltipLines.join("\n");
  }
}
