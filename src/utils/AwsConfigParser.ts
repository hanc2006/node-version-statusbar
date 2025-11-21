import { promises as fs } from "fs"
import * as os from "os"
import * as path from "path"
import { parseINI } from "confbox"
import { AwsProfile } from "../types"

const AWS_SHARED_CREDENTIALS =
  process.env.AWS_SHARED_CREDENTIALS_FILE ||
  path.join(os.homedir(), ".aws", "credentials")
const AWS_CONFIG =
  process.env.AWS_CONFIG_FILE || path.join(os.homedir(), ".aws", "config")

const PROFILE_PREFIX = "profile "

const readIniFile = async (
  filePath: string,
): Promise<Record<string, Record<string, string>>> => {
  try {
    const raw = await fs.readFile(filePath, "utf8")
    const parsed = parseINI(raw)
    return parsed as Record<string, Record<string, string>>
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`Failed to parse ${filePath}:`, error)
    }
    return {}
  }
}

const normalizeSectionName = (section: string): string => {
  if (section.startsWith(PROFILE_PREFIX)) {
    return section.slice(PROFILE_PREFIX.length)
  }
  return section
}

const gatherSourceFiles = (
  configSections: Set<string>,
  credentialSections: Set<string>,
  profileName: string,
): Array<"config" | "credentials"> => {
  const sources: Array<"config" | "credentials"> = []
  if (configSections.has(profileName)) sources.push("config")
  if (credentialSections.has(profileName)) sources.push("credentials")
  return sources
}

export const readAwsProfiles = async (): Promise<AwsProfile[]> => {
  const configRaw = await readIniFile(AWS_CONFIG)
  const credentialsRaw = await readIniFile(AWS_SHARED_CREDENTIALS)

  const sectionNames = new Set<string>()
  Object.keys(configRaw).forEach((section) => {
    sectionNames.add(normalizeSectionName(section))
  })
  Object.keys(credentialsRaw).forEach((section) => {
    sectionNames.add(section)
  })

  const configSections = new Set(
    Object.keys(configRaw).map((section) => normalizeSectionName(section)),
  )
  const credentialSections = new Set(Object.keys(credentialsRaw))

  const profiles: AwsProfile[] = []

  for (const name of sectionNames) {
    const configSection = configRaw[`profile ${name}`] || configRaw[name] || {}
    const credentialSection = credentialsRaw[name] || {}

    const hasSso = Boolean(
      configSection.sso_start_url &&
        configSection.sso_account_id &&
        configSection.sso_role_name,
    )

    const hasStaticCredentials = Boolean(
      credentialSection.aws_access_key_id &&
        credentialSection.aws_secret_access_key,
    )

    if (!hasSso && !hasStaticCredentials) {
      // Skip unusable profiles
      if (Object.keys(configSection).length === 0 && Object.keys(credentialSection).length === 0) {
        continue
      }
    }

    profiles.push({
      name,
      region: configSection.region || credentialSection.region,
      description: hasSso
        ? `${configSection.sso_account_id || ""}/${configSection.sso_role_name || ""}`
        : undefined,
      sourceFiles: gatherSourceFiles(configSections, credentialSections, name),
      hasSso,
      hasStaticCredentials,
      ssoStartUrl: configSection.sso_start_url,
      ssoAccountId: configSection.sso_account_id,
      ssoRoleName: configSection.sso_role_name,
      ssoRegion: configSection.sso_region || configSection.region,
    })
  }

  return profiles.sort((a, b) => a.name.localeCompare(b.name))
}
