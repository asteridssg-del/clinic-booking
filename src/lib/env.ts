const must = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

export const env = {
  googleClientId: must("GOOGLE_CLIENT_ID"),
  googleClientSecret: must("GOOGLE_CLIENT_SECRET"),
  nextAuthSecret: must("NEXTAUTH_SECRET"),
  defaultTenantKey: process.env.DEFAULT_TENANT_KEY ?? "dental-hk",
  receptionistAllowlist: (process.env.RECEPTIONIST_ALLOWLIST ?? "")
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean)
};
