import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { Role, AppointmentStatus } from "@prisma/client";
import PatientDashboard from "./components/PatientDashboard";
import Link from "next/link";

export default async function HomePage() {
  const session = await getServerSession(authOptions);

  // ================= 1. Unauthenticated Welcome Screen =================
  if (!session?.user) {
    return (
      <main style={styles.landingBg}>
        <div style={styles.landingContent}>
          <div style={styles.brandingGroup}>
            <span style={styles.superBadge}>White-Label MVP</span>
            <h1 style={styles.mainHeading}>Clinic Booking Portal</h1>
            <p style={styles.mainDesc}>
              A modern, multi-tenant scheduling engine for elite healthcare and therapy clinics.
            </p>
          </div>

          <div style={styles.clinicsShowcase}>
            <div style={styles.showcaseCard}>
              <span style={styles.locationTag}>HONG KONG</span>
              <h3>Dental HK</h3>
              <p>State-of-the-art general dentistry and orthodontics clinic located in Causeway Bay.</p>
            </div>
            <div style={styles.showcaseCard}>
              <span style={styles.locationTag}>KUALA LUMPUR</span>
              <h3>Physio KL</h3>
              <p>Premier physical therapy and sports recovery center based in Bangsar.</p>
            </div>
          </div>

          <div style={styles.actionCard}>
            <a href="/api/auth/signin" style={styles.googleSignInBtn}>
              <svg style={styles.googleIcon} viewBox="0 0 24 24">
                <path
                  fill="currentColor"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="currentColor"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="currentColor"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                />
                <path
                  fill="currentColor"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                />
              </svg>
              Sign In with Google Account
            </a>
            <p style={styles.seedNotice}>
              🔧 <strong>First time running?</strong> Populate mock clinics and practitioners by visiting{" "}
              <a href="/api/dev/seed" style={styles.seedLink}>/api/dev/seed</a>.
            </p>
          </div>
        </div>
      </main>
    );
  }

  // ================= 2. Authenticated Receptionist Redirect =================
  if (session.user.role === Role.RECEPTIONIST) {
    return (
      <main style={styles.centerBoxBg}>
        <div style={styles.glassNoticeCard}>
          <div style={styles.iconCircle}>📋</div>
          <h2 style={styles.noticeTitle}>Receptionist Portal</h2>
          <p style={styles.noticeDesc}>
            Hello, {session.user.name || "Receptionist"}. You are currently logged in with administrative access for **{session.user.tenantId === "dental-hk" ? "Dental HK" : "Physio KL"}**.
          </p>
          <Link href="/receptionist" style={styles.dashboardLinkCTA}>
            Open Receptionist Dashboard
          </Link>
          <a href="/api/auth/signout" style={styles.signOutSub}>Sign Out</a>
        </div>
      </main>
    );
  }

  // ================= 3. Authenticated Patient Dashboard Flow =================
  // Fetch active patient profile details
  const userWithProfile = await db.user.findUnique({
    where: { id: session.user.id },
    include: {
      patientProfile: true,
      tenant: true
    }
  });

  if (!userWithProfile) {
    return (
      <main style={styles.centerBoxBg}>
        <div style={styles.glassNoticeCard}>
          <h2 style={styles.noticeTitle}>Account Setup Error</h2>
          <p style={styles.noticeDesc}>Could not resolve tenant structure. Please sign out and sign back in.</p>
          <a href="/api/auth/signout" style={styles.signOutSub}>Sign Out</a>
        </div>
      </main>
    );
  }

  // Fetch active appointment (if any exists in statuses BOOKED, CONFIRMED, CHECKED_IN)
  const activeAppointmentRaw = userWithProfile.patientProfileId
    ? await db.appointment.findFirst({
        where: {
          tenantId: session.user.tenantId,
          patientId: userWithProfile.patientProfileId,
          status: {
            in: [
              AppointmentStatus.BOOKED,
              AppointmentStatus.CONFIRMED,
              AppointmentStatus.CHECKED_IN
            ]
          }
        },
        include: {
          provider: {
            select: { name: true, specialty: true }
          },
          clinic: {
            select: { name: true, timezone: true }
          }
        }
      })
    : null;

  // Convert active appointment dates to string for client component serialization
  const activeAppointment = activeAppointmentRaw
    ? {
        id: activeAppointmentRaw.id,
        startAt: activeAppointmentRaw.startAt.toISOString(),
        endAt: activeAppointmentRaw.endAt.toISOString(),
        status: activeAppointmentRaw.status,
        notes: activeAppointmentRaw.notes,
        provider: activeAppointmentRaw.provider,
        clinic: activeAppointmentRaw.clinic
      }
    : null;

  // Fetch all active providers (doctors) and clinics under this tenant
  const providers = await db.provider.findMany({
    where: {
      active: true,
      clinic: {
        tenantId: session.user.tenantId,
        active: true
      }
    },
    select: {
      id: true,
      name: true,
      specialty: true,
      clinicId: true
    }
  });

  const clinics = await db.clinic.findMany({
    where: {
      tenantId: session.user.tenantId,
      active: true
    },
    select: {
      id: true,
      name: true,
      timezone: true
    }
  });

  return (
    <PatientDashboard
      user={{
        id: session.user.id,
        name: session.user.name || null,
        email: session.user.email || ""
      }}
      tenantName={userWithProfile.tenant.name}
      providers={providers}
      clinics={clinics}
      activeAppointment={activeAppointment}
    />
  );
}

// Premium visual inline styles
const styles = {
  landingBg: {
    minHeight: "100vh",
    background: "linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%)",
    color: "#f8fafc",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "32px 16px",
  },
  landingContent: {
    maxWidth: "800px",
    width: "100%",
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    textAlign: "center" as const,
  },
  brandingGroup: {
    marginBottom: "40px",
  },
  superBadge: {
    background: "rgba(99, 102, 241, 0.15)",
    border: "1px solid rgba(99, 102, 241, 0.3)",
    color: "#a5b4fc",
    fontSize: "11px",
    fontWeight: "700" as const,
    padding: "6px 12px",
    borderRadius: "20px",
    textTransform: "uppercase" as const,
    letterSpacing: "1px",
    display: "inline-block",
    marginBottom: "16px",
  },
  mainHeading: {
    fontSize: "48px",
    fontWeight: "800" as const,
    letterSpacing: "-1.5px",
    margin: "0 0 16px 0",
    background: "linear-gradient(to right, #ffffff, #c7d2fe)",
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
  },
  mainDesc: {
    fontSize: "18px",
    color: "#94a3b8",
    maxWidth: "540px",
    margin: "0 auto",
    lineHeight: "1.6",
  },
  clinicsShowcase: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "24px",
    width: "100%",
    marginBottom: "40px",
  },
  showcaseCard: {
    background: "rgba(30, 41, 59, 0.4)",
    backdropFilter: "blur(12px)",
    border: "1px solid rgba(255, 255, 255, 0.05)",
    borderRadius: "16px",
    padding: "24px",
    textAlign: "left" as const,
  },
  locationTag: {
    fontSize: "10px",
    fontWeight: "700" as const,
    color: "#6366f1",
    letterSpacing: "0.5px",
    display: "block",
    marginBottom: "8px",
  },
  actionCard: {
    width: "100%",
    maxWidth: "420px",
    background: "rgba(15, 23, 42, 0.6)",
    border: "1px solid rgba(255, 255, 255, 0.1)",
    borderRadius: "20px",
    padding: "32px 24px",
    boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.3)",
  },
  googleSignInBtn: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "12px",
    width: "100%",
    background: "#ffffff",
    color: "#0f172a",
    border: "none",
    padding: "14px",
    borderRadius: "12px",
    fontSize: "15px",
    fontWeight: "600" as const,
    textDecoration: "none",
    cursor: "pointer",
    boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
    transition: "all 0.2s ease",
  },
  googleIcon: {
    width: "18px",
    height: "18px",
  },
  seedNotice: {
    marginTop: "20px",
    marginBottom: "0",
    fontSize: "12px",
    color: "#64748b",
  },
  seedLink: {
    color: "#818cf8",
    textDecoration: "underline",
  },
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
    background: "rgba(99, 102, 241, 0.2)",
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
