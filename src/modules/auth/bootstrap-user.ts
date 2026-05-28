import { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

type OAuthProfile = {
  email?: string | null;
  name?: string | null;
  image?: string | null;
  sub?: string | null;
};

const FALLBACK_TENANTS = [
  { key: "dental-hk", name: "Dental HK", timezone: "Asia/Hong_Kong" },
  { key: "physio-kl", name: "Physio KL", timezone: "Asia/Kuala_Lumpur" }
];

async function ensureSeedTenants() {
  for (const tenant of FALLBACK_TENANTS) {
    await db.tenant.upsert({
      where: { key: tenant.key },
      update: {},
      create: tenant
    });
  }
}

function inferTenantKeyFromEmail(email: string): string {
  const normalized = email.toLowerCase();
  if (normalized.endsWith("@physio-kl.com")) return "physio-kl";
  return env.defaultTenantKey;
}

export async function bootstrapUserFromGoogleProfile(profile: OAuthProfile) {
  const email = (profile.email ?? "").toLowerCase().trim();
  if (!email) {
    throw new Error("Google profile email is missing");
  }

  await ensureSeedTenants();

  const tenantKey = inferTenantKeyFromEmail(email);
  const tenant = await db.tenant.findUnique({ where: { key: tenantKey } });
  if (!tenant) {
    throw new Error(`Tenant not found for key: ${tenantKey}`);
  }

  const role = env.receptionistAllowlist.includes(email)
    ? Role.RECEPTIONIST
    : Role.PATIENT;

  let patientProfileId: string | undefined;

  if (role === Role.PATIENT) {
    const profileSub = (profile.sub ?? "").trim();
    if (!profileSub) {
      throw new Error("Google profile sub is missing");
    }

    const fallbackPhone = `+000${Date.now().toString().slice(-8)}`;
    const patient = await db.patientProfile.upsert({
      where: { googleSub: profileSub },
      update: {
        fullName: profile.name ?? "Patient",
        tenantId: tenant.id
      },
      create: {
        tenantId: tenant.id,
        googleSub: profileSub,
        fullName: profile.name ?? "Patient",
        phoneE164: fallbackPhone
      }
    });
    patientProfileId = patient.id;
  }

  const user = await db.user.upsert({
    where: { email },
    update: {
      tenantId: tenant.id,
      name: profile.name ?? undefined,
      image: profile.image ?? undefined,
      role,
      patientProfileId: patientProfileId ?? null
    },
    create: {
      tenantId: tenant.id,
      email,
      name: profile.name ?? undefined,
      image: profile.image ?? undefined,
      role,
      patientProfileId: patientProfileId ?? null
    }
  });

  return { userId: user.id, tenantId: tenant.id, role: user.role };
}
