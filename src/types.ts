export interface VersionManager {
  name: string
  command: string
  listCommand: string
  listRemote: string
  useCommand: string
  isAvailable: boolean
}

export interface NodeVersion {
  version: string
  manager: VersionManager
  isActive: boolean
  path?: string
}

export type AwsLoginState = "idle" | "authenticating" | "authenticated" | "error"

export interface AwsProfile {
  name: string
  region?: string
  description?: string
  sourceFiles: Array<"config" | "credentials">
  hasSso: boolean
  hasStaticCredentials: boolean
  ssoStartUrl?: string
  ssoAccountId?: string
  ssoRoleName?: string
  ssoRegion?: string
}

export interface AwsStatusSnapshot {
  profileName: string | null
  state: AwsLoginState
  message?: string
  lastChecked?: Date
  expiresAt?: Date
}
