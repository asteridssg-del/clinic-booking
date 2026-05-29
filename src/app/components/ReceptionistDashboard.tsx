"use client";

import React, { useState } from "react";
import { AppointmentStatus, ReminderChannel } from "@prisma/client";

interface Patient {
  id: string;
  fullName: string;
  phoneE164: string;
  preferredChan: ReminderChannel;
}

interface Provider {
  id: string;
  name: string;
  specialty: string;
}

interface Appointment {
  id: string;
  startAt: string;
  endAt: string;
  status: AppointmentStatus;
  notes: string | null;
  patient: Patient;
  provider: Provider;
}

interface ReceptionistDashboardProps {
  receptionistEmail: string;
  tenantName: string;
  initialAppointments: Appointment[];
  providers: Provider[];
}

export default function ReceptionistDashboard({
  receptionistEmail,
  tenantName,
  initialAppointments,
  providers,
}: ReceptionistDashboardProps) {
  const [appointments, setAppointments] = useState<Appointment[]>(initialAppointments);
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [providerFilter, setProviderFilter] = useState<string>("ALL");
  const [loadingAptId, setLoadingAptId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState("");

  // Handler to transition statuses (checkin, complete, no-show, cancel)
  const handleTransition = async (appointmentId: string, action: "checkin" | "complete" | "no-show" | "cancel") => {
    setLoadingAptId(appointmentId);
    setErrorMsg("");
    try {
      let res;
      if (action === "cancel") {
        res = await fetch(`/api/v1/appointments/${appointmentId}/cancel`, {
          method: "POST",
        });
      } else {
        res = await fetch(`/api/v1/appointments/${appointmentId}/${action}`, {
          method: "POST",
        });
      }

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || data.error || `Failed to transition appointment state`);
      }

      // Update appointments state locally
      setAppointments((prev) =>
        prev.map((apt) => (apt.id === appointmentId ? { ...apt, status: data.status } : apt))
      );
    } catch (err: any) {
      setErrorMsg(err.message || "An unexpected error occurred during action execution.");
    } finally {
      setLoadingAptId(null);
    }
  };

  // Filters application
  const filteredAppointments = appointments.filter((apt) => {
    // Status filter
    if (statusFilter !== "ALL") {
      if (statusFilter === "ACTIVE" && !["BOOKED", "CONFIRMED", "CHECKED_IN"].includes(apt.status)) {
        return false;
      } else if (statusFilter !== "ACTIVE" && apt.status !== statusFilter) {
        return false;
      }
    }
    // Provider filter
    if (providerFilter !== "ALL" && apt.provider.id !== providerFilter) {
      return false;
    }
    return true;
  });

  // Calculate high-level analytical indicator stats
  const scheduledCount = appointments.filter((a) => ["BOOKED", "CONFIRMED"].includes(a.status)).length;
  const checkedInCount = appointments.filter((a) => a.status === "CHECKED_IN").length;
  const completedCount = appointments.filter((a) => a.status === "COMPLETED").length;

  const getStatusStyle = (status: AppointmentStatus) => {
    switch (status) {
      case "BOOKED":
      case "CONFIRMED":
        return styles.badgeBooked;
      case "CHECKED_IN":
        return styles.badgeCheckedIn;
      case "COMPLETED":
        return styles.badgeCompleted;
      case "CANCELLED_BY_PATIENT":
      case "CANCELLED_BY_RECEPTION":
        return styles.badgeCancelled;
      case "NO_SHOW":
        return styles.badgeNoShow;
      default:
        return styles.badgeDefault;
    }
  };

  const formatDateTime = (iso: string) => {
    const d = new Date(iso);
    const dateLabel = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    const timeLabel = d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
    return `${dateLabel} @ ${timeLabel}`;
  };

  return (
    <div style={styles.container}>
      {/* Header bar */}
      <header style={styles.header}>
        <div>
          <span style={styles.tenantLabel}>{tenantName} Reception Desk</span>
          <h1 style={styles.title}>Clinic Control Panel</h1>
          <p style={styles.receptionistEmail}>Acting Receptionist: {receptionistEmail}</p>
        </div>
        <a href="/api/auth/signout" style={styles.signOutBtn}>Sign Out</a>
      </header>

      {/* Analytics widgets row */}
      <section style={styles.analyticsRow}>
        <div style={styles.statWidget}>
          <span style={styles.statVal}>{scheduledCount}</span>
          <span style={styles.statLabel}>SCHEDULED</span>
        </div>
        <div style={{ ...styles.statWidget, borderLeft: "4px solid #8b5cf6" }}>
          <span style={styles.statVal}>{checkedInCount}</span>
          <span style={styles.statLabel}>CHECKED IN</span>
        </div>
        <div style={{ ...styles.statWidget, borderLeft: "4px solid #10b981" }}>
          <span style={styles.statVal}>{completedCount}</span>
          <span style={styles.statLabel}>COMPLETED TODAY</span>
        </div>
      </section>

      {/* Error alert */}
      {errorMsg && <div style={styles.alertError}>{errorMsg}</div>}

      {/* Controls & filters section */}
      <section style={styles.filterSection}>
        <div style={styles.filterGroup}>
          <label style={styles.filterLabel}>STATUS FILTER</label>
          <div style={styles.filterBar}>
            <button
              onClick={() => setStatusFilter("ALL")}
              style={statusFilter === "ALL" ? styles.filterBtnActive : styles.filterBtn}
            >
              All ({appointments.length})
            </button>
            <button
              onClick={() => setStatusFilter("ACTIVE")}
              style={statusFilter === "ACTIVE" ? styles.filterBtnActive : styles.filterBtn}
            >
              Active ({scheduledCount + checkedInCount})
            </button>
            <button
              onClick={() => setStatusFilter("CHECKED_IN")}
              style={statusFilter === "CHECKED_IN" ? styles.filterBtnActive : styles.filterBtn}
            >
              Checked In
            </button>
            <button
              onClick={() => setStatusFilter("COMPLETED")}
              style={statusFilter === "COMPLETED" ? styles.filterBtnActive : styles.filterBtn}
            >
              Completed
            </button>
            <button
              onClick={() => setStatusFilter("NO_SHOW")}
              style={statusFilter === "NO_SHOW" ? styles.filterBtnActive : styles.filterBtn}
            >
              No Show
            </button>
          </div>
        </div>

        <div style={styles.filterGroup}>
          <label htmlFor="provider-filter" style={styles.filterLabel}>FILTER BY PRACTITIONER</label>
          <select
            id="provider-filter"
            value={providerFilter}
            onChange={(e) => setProviderFilter(e.target.value)}
            style={styles.selectInput}
          >
            <option value="ALL">All Practitioners</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.specialty})
              </option>
            ))}
          </select>
        </div>
      </section>

      {/* Live appointments list */}
      <section style={styles.tableCard}>
        {filteredAppointments.length === 0 ? (
          <div style={styles.emptyState}>No bookings found matching selected filters.</div>
        ) : (
          <div style={styles.appointmentsGrid}>
            {filteredAppointments.map((apt) => (
              <div key={apt.id} style={styles.appointmentCard}>
                <div style={styles.cardInfo}>
                  <div style={styles.topInfoRow}>
                    <span style={getStatusStyle(apt.status)}>{apt.status}</span>
                    <span style={styles.timeTag}>{formatDateTime(apt.startAt)}</span>
                  </div>

                  <h3 style={styles.patientName}>{apt.patient.fullName}</h3>
                  <p style={styles.patientMeta}>
                    📞 {apt.patient.phoneE164} | 🔔 Preferred: <strong>{apt.patient.preferredChan}</strong>
                  </p>

                  <div style={styles.docMiniBadge}>
                    <strong>Doctor:</strong> {apt.provider.name} ({apt.provider.specialty})
                  </div>

                  {apt.notes && (
                    <div style={styles.notesBox}>
                      <strong>Notes:</strong> "{apt.notes}"
                    </div>
                  )}
                </div>

                <div style={styles.cardActions}>
                  {loadingAptId === apt.id ? (
                    <div style={styles.loadingSpinner}>Processing request...</div>
                  ) : (
                    <>
                      {/* Action 1: CHECK IN (Only for Booked/Confirmed status) */}
                      {["BOOKED", "CONFIRMED"].includes(apt.status) && (
                        <>
                          <button
                            onClick={() => handleTransition(apt.id, "checkin")}
                            style={styles.actionBtnCheckIn}
                          >
                            Check In
                          </button>
                          <button
                            onClick={() => handleTransition(apt.id, "cancel")}
                            style={styles.actionBtnCancel}
                          >
                            Cancel
                          </button>
                        </>
                      )}

                      {/* Action 2: COMPLETE / NO SHOW (Only for Checked In status) */}
                      {apt.status === "CHECKED_IN" && (
                        <>
                          <button
                            onClick={() => handleTransition(apt.id, "complete")}
                            style={styles.actionBtnComplete}
                          >
                            Complete Booking
                          </button>
                          <button
                            onClick={() => handleTransition(apt.id, "no-show")}
                            style={styles.actionBtnNoShow}
                          >
                            No Show
                          </button>
                        </>
                      )}

                      {/* Terminal states have no actions */}
                      {["COMPLETED", "NO_SHOW", "CANCELLED_BY_PATIENT", "CANCELLED_BY_RECEPTION"].includes(apt.status) && (
                        <span style={styles.terminalStateText}>Booking Concluded</span>
                      )}
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// Custom HSL Slate Dense Admin styles
const styles = {
  container: {
    maxWidth: "1000px",
    margin: "0 auto",
    padding: "32px 24px",
    minHeight: "100vh",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "32px",
    borderBottom: "1px solid #e2e8f0",
    paddingBottom: "24px",
  },
  tenantLabel: {
    fontSize: "11px",
    fontWeight: "700" as const,
    color: "#6366f1",
    textTransform: "uppercase" as const,
    letterSpacing: "1px",
    display: "block",
    marginBottom: "4px",
  },
  title: {
    margin: "0",
    fontSize: "28px",
    fontWeight: "800" as const,
    letterSpacing: "-0.5px",
    color: "#0f172a",
  },
  receptionistEmail: {
    margin: "4px 0 0 0",
    fontSize: "13px",
    color: "#64748b",
  },
  signOutBtn: {
    fontSize: "12px",
    fontWeight: "600" as const,
    color: "#ef4444",
    border: "1px solid #fee2e2",
    background: "#fef2f2",
    padding: "8px 12px",
    borderRadius: "8px",
    cursor: "pointer",
    transition: "all 0.2s ease",
  },
  analyticsRow: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr 1fr",
    gap: "20px",
    marginBottom: "32px",
  },
  statWidget: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderLeft: "4px solid #6366f1",
    padding: "20px",
    borderRadius: "12px",
    display: "flex",
    flexDirection: "column" as const,
    boxShadow: "0 1px 3px rgba(0, 0, 0, 0.02)",
  },
  statVal: {
    fontSize: "28px",
    fontWeight: "800" as const,
    color: "#0f172a",
    lineHeight: "1",
  },
  statLabel: {
    marginTop: "8px",
    fontSize: "10px",
    fontWeight: "700" as const,
    color: "#94a3b8",
    letterSpacing: "0.5px",
  },
  alertError: {
    background: "#fef2f2",
    border: "1px solid #fca5a5",
    color: "#b91c1c",
    padding: "12px 16px",
    borderRadius: "10px",
    fontSize: "14px",
    fontWeight: "500" as const,
    marginBottom: "24px",
  },
  filterSection: {
    display: "grid",
    gridTemplateColumns: "2fr 1fr",
    gap: "24px",
    alignItems: "end",
    marginBottom: "24px",
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: "16px",
    padding: "20px",
  },
  filterGroup: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "8px",
  },
  filterLabel: {
    fontSize: "10px",
    fontWeight: "700" as const,
    color: "#94a3b8",
    letterSpacing: "0.5px",
  },
  filterBar: {
    display: "flex",
    gap: "8px",
    overflowX: "auto" as const,
  },
  filterBtn: {
    background: "#f8fafc",
    border: "1px solid #cbd5e1",
    color: "#475569",
    padding: "8px 14px",
    borderRadius: "8px",
    fontSize: "13px",
    fontWeight: "600" as const,
    cursor: "pointer",
    whiteSpace: "nowrap" as const,
  },
  filterBtnActive: {
    background: "#0f172a",
    border: "1px solid #0f172a",
    color: "#ffffff",
    padding: "8px 14px",
    borderRadius: "8px",
    fontSize: "13px",
    fontWeight: "600" as const,
    cursor: "pointer",
    whiteSpace: "nowrap" as const,
  },
  selectInput: {
    padding: "9px 12px",
    borderRadius: "8px",
    border: "1px solid #cbd5e1",
    fontSize: "13px",
    color: "#334155",
    fontWeight: "500" as const,
    background: "#f8fafc",
    outline: "none",
  },
  tableCard: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: "20px",
    overflow: "hidden" as const,
  },
  emptyState: {
    padding: "48px",
    textAlign: "center" as const,
    fontSize: "14px",
    color: "#64748b",
    fontWeight: "500" as const,
  },
  appointmentsGrid: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "1px",
    background: "#e2e8f0", // acts as dividers
  },
  appointmentCard: {
    background: "#ffffff",
    display: "grid",
    gridTemplateColumns: "3fr 1fr",
    gap: "24px",
    padding: "24px",
    alignItems: "center",
    transition: "background 0.2s ease",
  },
  cardInfo: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "6px",
  },
  topInfoRow: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    marginBottom: "4px",
  },
  timeTag: {
    fontSize: "13px",
    fontWeight: "700" as const,
    color: "#4f46e5",
  },
  patientName: {
    margin: "0",
    fontSize: "18px",
    fontWeight: "800" as const,
    color: "#0f172a",
  },
  patientMeta: {
    margin: "0",
    fontSize: "13px",
    color: "#64748b",
  },
  docMiniBadge: {
    marginTop: "4px",
    fontSize: "12px",
    color: "#475569",
  },
  notesBox: {
    marginTop: "8px",
    fontSize: "12px",
    color: "#475569",
    background: "#f8fafc",
    padding: "10px",
    borderRadius: "8px",
    borderLeft: "2px solid #6366f1",
  },
  cardActions: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "8px",
  },
  loadingSpinner: {
    fontSize: "12px",
    color: "#64748b",
    textAlign: "center" as const,
  },
  actionBtnCheckIn: {
    background: "#8b5cf6",
    color: "#ffffff",
    border: "none",
    padding: "10px",
    borderRadius: "8px",
    fontSize: "13px",
    fontWeight: "600" as const,
    cursor: "pointer",
    boxShadow: "0 2px 4px rgba(139, 92, 246, 0.15)",
  },
  actionBtnCancel: {
    background: "transparent",
    color: "#ef4444",
    border: "1px solid #fee2e2",
    padding: "10px",
    borderRadius: "8px",
    fontSize: "13px",
    fontWeight: "600" as const,
    cursor: "pointer",
  },
  actionBtnComplete: {
    background: "#10b981",
    color: "#ffffff",
    border: "none",
    padding: "10px",
    borderRadius: "8px",
    fontSize: "13px",
    fontWeight: "600" as const,
    cursor: "pointer",
    boxShadow: "0 2px 4px rgba(16, 185, 129, 0.15)",
  },
  actionBtnNoShow: {
    background: "#f59e0b",
    color: "#ffffff",
    border: "none",
    padding: "10px",
    borderRadius: "8px",
    fontSize: "13px",
    fontWeight: "600" as const,
    cursor: "pointer",
    boxShadow: "0 2px 4px rgba(245, 158, 11, 0.15)",
  },
  terminalStateText: {
    fontSize: "12px",
    fontWeight: "600" as const,
    color: "#94a3b8",
    textAlign: "center" as const,
    textTransform: "uppercase" as const,
  },

  // Color-coded status badges
  badgeBooked: {
    background: "#dbeafe",
    color: "#1d4ed8",
    fontSize: "10px",
    fontWeight: "700" as const,
    padding: "3px 6px",
    borderRadius: "4px",
  },
  badgeCheckedIn: {
    background: "#ede9fe",
    color: "#6d28d9",
    fontSize: "10px",
    fontWeight: "700" as const,
    padding: "3px 6px",
    borderRadius: "4px",
  },
  badgeCompleted: {
    background: "#d1fae5",
    color: "#065f46",
    fontSize: "10px",
    fontWeight: "700" as const,
    padding: "3px 6px",
    borderRadius: "4px",
  },
  badgeCancelled: {
    background: "#fee2e2",
    color: "#b91c1c",
    fontSize: "10px",
    fontWeight: "700" as const,
    padding: "3px 6px",
    borderRadius: "4px",
  },
  badgeNoShow: {
    background: "#fef3c7",
    color: "#b45309",
    fontSize: "10px",
    fontWeight: "700" as const,
    padding: "3px 6px",
    borderRadius: "4px",
  },
  badgeDefault: {
    background: "#f1f5f9",
    color: "#475569",
    fontSize: "10px",
    fontWeight: "700" as const,
    padding: "3px 6px",
    borderRadius: "4px",
  },
};
