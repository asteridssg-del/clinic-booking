import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { Role } from "@prisma/client";
import { redirect } from "next/navigation";
import ReceptionistDashboard from "../components/ReceptionistDashboard";

export default async function ReceptionistPage() {
  const session = await getServerSession(authOptions);

  // 1. Authentication Check
  if (!session?.user) {
    redirect("/api/auth/signin");
  }

  // 2. Authorization Check (Only RECEPTIONIST role allowed)
  if (session.user.role !== Role.RECEPTIONIST) {
    return (
      <main style={styles.centerBoxBg}>
        <div style={styles.glassNoticeCard}>
          <div style={styles.iconCircle}>⚠️</div>
          <h2 style={styles.noticeTitle}>Access Denied</h2>
          <p style={styles.noticeDesc}>
            Your user account ({session.user.email}) does not have administrative receptionist privileges.
          </p>
          <a href="/" style={styles.dashboardLinkCTA}>
            Go Back to Patient Booking
          </a>
          <a href="/api/auth/signout" style={styles.signOutSub}>Sign Out</a>
        </div>
      </main>
    );
  }

  // 3. Fetch Tenant details
  const tenant = await db.tenant.findUnique({
    where: { id: session.user.tenantId }
  });

  // 4. Fetch all Providers (Doctors) under this tenant
  const providers = await db.provider.findMany({
    where: {
      clinic: { tenantId: session.user.tenantId, active: true },
      active: true
    },
    select: {
      id: true,
      name: true,
      specialty: true
    }
  });

  // 5. Fetch all appointments under this tenant
  const appointmentsRaw = await db.appointment.findMany({
    where: { tenantId: session.user.tenantId },
    include: {
      patient: {
        select: {
          id: true,
          fullName: true,
          phoneE164: true,
          preferredChan: true
        }
      },
      provider: {
        select: {
          id: true,
          name: true,
          specialty: true
        }
      }
    },
    orderBy: { startAt: "desc" }
  });

  // Serialize date fields for Next.js Client Component compatibility
  const appointments = appointmentsRaw.map((apt) => ({
    id: apt.id,
    startAt: apt.startAt.toISOString(),
    endAt: apt.endAt.toISOString(),
    status: apt.status,
    notes: apt.notes,
    patient: apt.patient,
    provider: apt.provider
  }));

  return (
    <ReceptionistDashboard
      receptionistEmail={session.user.email || ""}
      tenantName={tenant?.name || "Clinic"}
      initialAppointments={appointments}
      providers={providers}
    />
  );
}

const styles = {
  centerBoxBg: {
    minHeight: "100vh",
    background: "linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "16px",
  },
  glassNoticeCard: {
    background: "rgba(30, 41, 59, 0.7)",
    backdropFilter: "blur(12px)",
    border: "1px solid rgba(255, 255, 255, 0.08)",
    borderRadius: "24px",
    padding: "40px 32px",
    maxWidth: "460px",
    width: "100%",
    textAlign: "center" as const,
    color: "#ffffff",
  },
  iconCircle: {
    width: "60px",
    height: "60px",
    borderRadius: "30px",
    background: "rgba(239, 68, 68, 0.2)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "28px",
    margin: "0 auto 24px auto",
  },
  noticeTitle: {
    fontSize: "24px",
    fontWeight: "800" as const,
    margin: "0 0 12px 0",
    letterSpacing: "-0.5px",
  },
  noticeDesc: {
    fontSize: "14px",
    color: "#94a3b8",
    lineHeight: "1.6",
    margin: "0 0 24px 0",
  },
  dashboardLinkCTA: {
    display: "block",
    background: "linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)",
    color: "#ffffff",
    padding: "14px",
    borderRadius: "12px",
    fontSize: "15px",
    fontWeight: "600" as const,
    textDecoration: "none",
    boxShadow: "0 10px 15px -3px rgba(99, 102, 241, 0.3)",
    marginBottom: "16px",
  },
  signOutSub: {
    display: "inline-block",
    fontSize: "12px",
    color: "#ef4444",
    textDecoration: "underline",
    cursor: "pointer",
  },
};
