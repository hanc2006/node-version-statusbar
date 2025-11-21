import * as vscode from "vscode"
import * as path from "path"
import { runCommand } from "../utils/ProcessUtils"
import {
    KubeEnvironment,
    getKubeSecretConfig,
} from "../utils/ConfigUtils"

export const KUBE_NAMESPACES = {
    "yol-backend": [
        "yol-address-lookup",
        "yol-pdf-service",
        "yol-product-catalog",
        "yol-product-feed-service",
        "yol-capture-info-nj-service",
        "yol-frontend-logger-service",
        "yol-pos-admin-service",
        "yol-utils-service",
        "yol-capture-info-service",
        "yol-carrier-lookup-service",
        "yol-crontab-service",
        "yol-shorturl-service",
        "yol-telegram-alert-service",
        "yol-pos-customer-lookup-service",
        "yol-order-handler-kafka-consumer-py",
        "yol-product-catalog-builder-service",
        "yol-product-catalog-kafka-consumer-py",
        "yol-roaming-cockpit-proxy",
        "yol-idv-service",
        "yol-payment-service",
    ],
    "yol-checkout": [
        "yol-checkout-service",
        "yol-credit-check-service",
        "yol-linecheck-service",
        "yol-msisdn-search",
        "yol-order-handler-service",
    ],
    "yol-selfcare": [
        "yol-selfcare-service",
        "yol-selfcare-bills-service",
        "yol-smartwatch-service",
        "yol-deals-service",
        "yol-options-manage-service",
    ],
    "yol-identity": [
        "yol-identity-service",
        "yol-identity-token-service",
        "yol-notification-service",
        "yol-auth-service",
        "yol-oidc-provider",
        "yol-pos-token-service",
        "yol-selfcare-pass-service",
    ],
    "yol-gdpr": ["yol-gdpr-service"],
    "yol-tv": [
        "yol-tv-service",
        "yol-tv-signup-service",
        "yol-tv-kafka-consumer",
        "yol-tv-bundle-handler",
    ],
    "yol-campaign-tool": [
        "yol-campaign-base-kafka-consumer",
        "yol-campaign-ext-processor",
        "yol-campaign-ext-service",
        "yol-campaign-tool-service",
    ],
    "yol-onboarding": [
        "yol-fiber-onboarding-service",
        "yol-mobile-onboarding-service",
    ],
} as const

export type Namespace = keyof typeof KUBE_NAMESPACES
export type ServiceName = (typeof KUBE_NAMESPACES)[Namespace][number]

export function resolveNamespaceForSecret(
    service: string,
        namespaces: Record<string, readonly string[]> = KUBE_NAMESPACES,
): string {
    for (const [ns, services] of Object.entries(namespaces)) {
        if (services.includes(service)) {
            return ns
        }
    }
    throw new Error(`Unknown secret base name: ${service}`)
}

/**
 * Build a full .env file based on the logic in fetch-secert-by-secerts.sh.
 *
 * Minimal behavior (no interactive context, no extras):
 * - Secret: <serviceName>-secrets from the provided namespace
 * - Decode Base64 values and prefix variables with UPPERCASE(service_basename)_
 * - Append env block from ConfigMap <serviceName>-cm-app-config if present
 * - Append prefixed values from global secret ns-global-secrets (same namespace) if present
 * - Rewrite internal service URLs to https://test.t.aws.flbs.ch/<service>
 * - Output path: /src/Common/Environment/.env.local.<secretName>
 */
export async function writeEnvLocalFromK8sSecret(
    serviceName: ServiceName,
    environment: KubeEnvironment,
): Promise<string> {
        const secretName = `${serviceName}-secrets`;
        const { envDirectory } = getKubeSecretConfig();
        const namespace = resolveNamespaceForSecret(serviceName).concat(
        `-${environment}`
    );


    const PREFIX = serviceName.toUpperCase().replace(/-/g, "_") + "_";

    // 1) Fetch Secret JSON
    const sec = await runCommand(
        `kubectl get secret ${secretName} -n ${namespace} -o json`
    );
    if (sec.failed) {
        throw new Error(
            `Failed to fetch secret '${secretName}' from namespace '${namespace}'.`
        );
    }
    const secJson = JSON.parse(sec.stdout || "{}");
    const secData: Record<string, string> = secJson?.data ?? {};

    const lines: string[] = [];

    // Write decoded Secret entries as PREFIXKEY='value'
    for (const [key, b64] of Object.entries(secData)) {
        let decoded = "";
        try {
            decoded = Buffer.from(b64, "base64").toString("utf8");
        } catch {
            decoded = b64;
        }
        const escaped = decoded.replace(/'/g, "\\'");
        lines.push(`${PREFIX}${key}='${escaped}'`);
    }

    // 2) Append env block from ConfigMap <secretBaseName>-cm-app-config
    const cmName = `${serviceName}-cm-app-config`;

    const cm = await runCommand(
        `kubectl get configmap ${cmName} -n ${namespace} -o json`
    );

    if (!cm.failed) {
        try {
            const cmJson = JSON.parse(cm.stdout || "{}");
            const cmData: Record<string, string> = cmJson?.data ?? {};
            const envLikeEntries = Object.entries(cmData).filter(([key, value]) => {
                const keyIsEnv = /(^|\.)env(\.|-|$)/i.test(key);
                const valHasEnv =
                    typeof value === "string" &&
                    (/(^|\n)NODE_ENV=/.test(value) || /(^|\n)SERVER_URL=/.test(value));
                return keyIsEnv || valHasEnv;
            });

            if (envLikeEntries.length > 0) {
                lines.push(
                    "",
                    "# ================== Env Vars from ConfigMap =================="
                );
                for (const [, value] of envLikeEntries) {
                    const block = (value ?? "").replace(/\r$/gm, "");
                    // Append raw lines from the block
                    for (const l of block.split("\n")) {
                        if (l.trim().length) lines.push(l);
                    }
                }
            }
        } catch {
            // ignore parse errors
        }
    }

    // 3) Append global secret ns-global-secrets (same namespace) with PREFIX
    const globalSecretName = "ns-global-secrets";

    const gs = await runCommand(
        `kubectl get secret ${globalSecretName} -n ${namespace} -o json`
    );

    if (!gs.failed) {
        try {
            const gsJson = JSON.parse(gs.stdout || "{}");
            const gsData: Record<string, string> = gsJson?.data ?? {};
            lines.push(
                "",
                `# ================== Global secret: ${globalSecretName} ==================`
            );
            for (const [gkey, gb64] of Object.entries(gsData)) {
                let gdecoded = "";
                try {
                    gdecoded = Buffer.from(gb64, "base64").toString("utf8");
                } catch {
                    gdecoded = gb64;
                }
                const gescaped = gdecoded.replace(/'/g, "\\'");
                lines.push(`${PREFIX}${gkey}='${gescaped}'`);
            }
        } catch {
            // ignore parse errors
        }
    }

    // 4) Rewrite internal service URLs
    const urlPattern =
        /http:\/\/yol-([a-z0-9-]+)-service\.[^"=\s]*\.svc\.cluster\.local:8080/g;

    const rewritten = lines.map((line) =>
        line.replace(urlPattern, (_m, svc) => `https://test.t.aws.flbs.ch/${svc}`)
    );


    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
    let resolvedDirectory = envDirectory
    if (path.isAbsolute(envDirectory)) {
        resolvedDirectory = envDirectory
    } else {
        if (!workspaceFolder) {
            throw new Error("Unable to resolve workspace path for kube secrets output")
        }
        resolvedDirectory = path.join(workspaceFolder.uri.fsPath, envDirectory)
    }

    const envLabel = environment === "test" ? "local" : environment
    const sanitizedService = serviceName.replace(/[^a-zA-Z0-9.-]/g, "-")
    const fileName = `.env.${envLabel}.${sanitizedService}`
    const directoryUri = vscode.Uri.file(resolvedDirectory)
    const fileUri = vscode.Uri.file(path.join(resolvedDirectory, fileName))

    await vscode.workspace.fs.createDirectory(directoryUri)
    await vscode.workspace.fs.writeFile(
        fileUri,
        Buffer.from(rewritten.join("\n"), "utf8"),
    )

    return fileUri.fsPath
}
