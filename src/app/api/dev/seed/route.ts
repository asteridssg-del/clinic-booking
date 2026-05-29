import { NextResponse } from "next/server";
import { db } from "@/lib/db";

const DEFAULT_TENANTS = [
  { key: "dental-hk", name: "Dental HK", timezone: "Asia/Hong_Kong" },
  { key: "physio-kl", name: "Physio KL", timezone: "Asia/Kuala_Lumpur" }
];

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Seed endpoint is disabled in production" }, { status: 403 });
  }

  try {
    console.log("[Seeder] Starting DB Seeding...");

    // 1. Seed Tenants
    const seededTenants = [];
    for (const t of DEFAULT_TENANTS) {
      const tenant = await db.tenant.upsert({
        where: { key: t.key },
        update: { name: t.name, timezone: t.timezone },
        create: t
      });
      seededTenants.push(tenant);
    }

    const dentalTenant = seededTenants.find((t) => t.key === "dental-hk")!;
    const physioTenant = seededTenants.find((t) => t.key === "physio-kl")!;

    // 2. Seed Clinics
    const dentalClinic = await db.clinic.upsert({
      where: { id: "clinic-dental-cwb" },
      update: { name: "Dental HK (Causeway Bay)", tenantId: dentalTenant.id },
      create: {
        id: "clinic-dental-cwb",
        tenantId: dentalTenant.id,
        name: "Dental HK (Causeway Bay)",
        timezone: "Asia/Hong_Kong"
      }
    });

    const physioClinic = await db.clinic.upsert({
      where: { id: "clinic-physio-bangsar" },
      update: { name: "Physio KL (Bangsar)", tenantId: physioTenant.id },
      create: {
        id: "clinic-physio-bangsar",
        tenantId: physioTenant.id,
        name: "Physio KL (Bangsar)",
        timezone: "Asia/Kuala_Lumpur"
      }
    });

    // 3. Seed Providers (Doctors)
    const providersList = [
      {
        id: "provider-clara",
        clinicId: dentalClinic.id,
        name: "Dr. Clara Wong",
        specialty: "General Dentistry"
      },
      {
        id: "provider-marcus",
        clinicId: dentalClinic.id,
        name: "Dr. Marcus Lee",
        specialty: "Orthodontics"
      },
      {
        id: "provider-amir",
        clinicId: physioClinic.id,
        name: "Dr. Amir Razak",
        specialty: "Sports Physiotherapy"
      }
    ];

    const seededProviders = [];
    for (const p of providersList) {
      const provider = await db.provider.upsert({
        where: { id: p.id },
        update: { name: p.name, specialty: p.specialty, active: true },
        create: p
      });
      seededProviders.push(provider);
    }

    // 4. Seed Provider Schedules (Monday - Friday, 09:00 - 18:00, lunch break 13:00 - 14:00)
    const lunchBreak = [{ startTime: "13:00", endTime: "14:00" }];
    
    for (const provider of seededProviders) {
      // Clear existing schedules for a clean state
      await db.providerSchedule.deleteMany({
        where: { providerId: provider.id }
      });

      // Insert schedules for Monday (1) to Friday (5)
      for (let weekday = 1; weekday <= 5; weekday++) {
        await db.providerSchedule.create({
          data: {
            providerId: provider.id,
            weekday,
            startTime: "09:00",
            endTime: "18:00",
            breakJson: lunchBreak
          }
        });
      }
    }

    return NextResponse.json({
      success: true,
      message: "Database seeded successfully!",
      tenants: seededTenants.map((t) => t.name),
      clinics: [dentalClinic.name, physioClinic.name],
      providers: seededProviders.map((p) => p.name)
    });
  } catch (error) {
    console.error("[Seeder] Error during seeding:", error);
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 }
    );
  }
}
