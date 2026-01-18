/** NPX distribution */
export interface NpxDistribution {
  package: string;
  args?: string[];
  env?: Record<string, string>;
}

/** Binary platform info */
export interface BinaryPlatform {
  archive: string;
  cmd: string;
  args?: string[];
}

/** Distribution method for an agent */
export interface Distribution {
  npx?: NpxDistribution;
  binary?: Record<string, BinaryPlatform>;
}

/** A single agent provider from the registry */
export interface RegistryAgent {
  id: string;
  name: string;
  version: string;
  description: string;
  icon?: string;
  distribution: Distribution;
}

/** Brand colors for each provider */
export const PROVIDER_COLORS: Record<
  string,
  { main: string; light: string; dark: string }
> = {
  claude: { main: "#D97706", light: "#F59E0B", dark: "#B45309" },
  "codex-acp": { main: "#10A37F", light: "#34D399", dark: "#059669" },
  gemini: { main: "#4285F4", light: "#60A5FA", dark: "#2563EB" },
  "github-copilot": { main: "#6E7681", light: "#8B949E", dark: "#484F58" },
  "mistral-vibe": { main: "#F97316", light: "#FB923C", dark: "#EA580C" },
  auggie: { main: "#8B5CF6", light: "#A78BFA", dark: "#7C3AED" },
  "qwen-code": { main: "#6366F1", light: "#818CF8", dark: "#4F46E5" },
  opencode: { main: "#06B6D4", light: "#22D3EE", dark: "#0891B2" },
};

/** Get color for a provider, with fallback */
export function getProviderColor(providerId: string): {
  main: string;
  light: string;
  dark: string;
} {
  return (
    PROVIDER_COLORS[providerId] || {
      main: "#6B7280",
      light: "#9CA3AF",
      dark: "#4B5563",
    }
  );
}

/** Providers that may need auth setup */
export const PROVIDERS_NEEDING_AUTH = new Set([
  "codex-acp",
  "gemini",
  "github-copilot",
  "mistral-vibe",
  "auggie",
  "qwen-code",
]);

/** Check if a provider may need auth setup */
export function mayNeedAuth(providerId: string): boolean {
  return PROVIDERS_NEEDING_AUTH.has(providerId);
}
