"use client";

import React, { useState } from "react";
import { AppointmentStatus, ReminderChannel } from "@prisma/client";
import WeekCalendar from "./WeekCalendar";

interface Patient {
  id: string;
  fullName: string;
  phoneE164: string;
  preferredChan: ReminderChannel;
}

interface ProviderSchedule {
  id: string;
  weekday: number;
  startTime: string;
  endTime: string;
  breakJson: unknown;
}

interface ProviderTimeOff {
  id: string;
  startAt: string;
  endAt: string;
  reason: string | null;
}

interface Provider {
  id: string;
  name: string;
  specialty: string;
  schedules?: ProviderSchedule[];
  timeOff?: ProviderTimeOff[];
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

  // Tab navigation
  const [activeTab, setActiveTab] = useState<"appointments" | "availability">("appointments");

  // Calendar view
  const [calendarView, setCalendarView] = useState<"list" | "calendar">("list");
  const [weekOffset, setWeekOffset] = useState(0);

  // Availability management state
  const [availProviders, setAvailProviders] = useState<Provider[]>(providers);
  const [availMsg, setAvailMsg] = useState<{ id: string; text: string; ok: boolean } | null>(null);
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);
  const [scheduleEdits, setScheduleEdits] = useState<Record<string, { startTime: string; endTime: string }>>({});
  const [timeOffForm, setTimeOffForm] = useState<Record<string, { startAt: string; endAt: string; reason: string }>>({});
  const [savingSchedule, setSavingSchedule] = useState<string | null>(null);
  const [savingTimeOff, setSavingTimeOff] = useState<string | null>(null);

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

  const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const handleSaveSchedule = async (providerId: string, weekday: number) => {
    const key = `${providerId}-${weekday}`;
    const edit = scheduleEdits[key];
    if (!edit) return;
    setSavingSchedule(key);
    try {
      const res = await fetch(`/api/v1/providers/${providerId}/schedule`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weekday, startTime: edit.startTime, endTime: edit.endTime })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save");
      setAvailProviders((prev) => prev.map((p) => {
        if (p.id !== providerId) return p;
        const existing = p.schedules?.filter((s) => s.weekday !== weekday) ?? [];
        return { ...p, schedules: [...existing, data] };
      }));
      setAvailMsg({ id: key, text: "Saved!", ok: true });
    } catch (err: any) {
      setAvailMsg({ id: key, text: err.message, ok: false });
    } finally {
      setSavingSchedule(null);
    }
  };

  const handleAddTimeOff = async (providerId: string) => {
    const form = timeOffForm[providerId];
    if (!form?.startAt || !form?.endAt) return;
    setSavingTimeOff(providerId);
    try {
      const res = await fetch(`/api/v1/providers/${providerId}/time-off`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startAt: form.startAt, endAt: form.endAt, reason: form.reason || undefined })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add");
      setAvailProviders((prev) => prev.map((p) => {
        if (p.id !== providerId) return p;
        return { ...p, timeOff: [...(p.timeOff ?? []), { ...data, startAt: data.startAt, endAt: data.endAt }] };
      }));
      setTimeOffForm((prev) => ({ ...prev, [providerId]: { startAt: "", endAt: "", reason: "" } }));
      setAvailMsg({ id: `to-${providerId}`, text: "Time-off added!", ok: true });
    } catch (err: any) {
      setAvailMsg({ id: `to-${providerId}`, text: err.message, ok: false });
    } finally {
      setSavingTimeOff(null);
    }
  };

  const handleDeleteTimeOff = async (providerId: string, timeOffId: string) => {
    try {
      const res = await fetch(`/api/v1/providers/${providerId}/time-off/${timeOffId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
      setAvailProviders((prev) => prev.map((p) => {
        if (p.id !== providerId) return p;
        return { ...p, timeOff: (p.timeOff ?? []).filter((t) => t.id !== timeOffId) };
      }));
    } catch (err: any) {
      setAvailMsg({ id: `del-${timeOffId}`, text: err.message, ok: false });
    }
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

      {/* Tab bar */}
      <div style={styles.tabBar}>
        <button
          onClick={() => setActiveTab("appointments")}
          style={activeTab === "appointments" ? styles.tabBtnActive : styles.tabBtn}
        >
          Appointments
        </button>
        <button
          onClick={() => setActiveTab("availability")}
          style={activeTab === "availability" ? styles.tabBtnActive : styles.tabBtn}
        >
          Availability Management
        </button>
      </div>

      {activeTab === "appointments" && (
        <>
      {/* Error alert */}
      {errorMsg && <div style={styles.alertError}>{errorMsg}</div>}

      {/* View toggle */}
      <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
        <button
          onClick={() => setCalendarView("list")}
          style={calendarView === "list" ? styles.tabBtnActive : styles.tabBtn}
        >
          List View
        </button>
        <button
          onClick={() => setCalendarView("calendar")}
          style={calendarView === "calendar" ? styles.tabBtnActive : styles.tabBtn}
        >
          Calendar View
        </button>
      </div>

      {calendarView === "calendar" ? (
        <WeekCalendar
          appointments={appointments}
          providers={providers}
          weekOffset={weekOffset}
          onWeekChange={setWeekOffset}
        />
      ) : (
        <>
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
        </>
      )}
        </>
      )}

      {activeTab === "availability" && (
        <section style={styles.tableCard}>
          {availMsg && (
            <div style={availMsg.ok ? styles.alertSuccess : styles.alertError} key={availMsg.id}>
              {availMsg.text}
            </div>
          )}
          {availProviders.map((provider) => (
            <div key={provider.id} style={styles.providerBlock}>
              <button
                style={styles.providerBlockHeader}
                onClick={() => setExpandedProvider(expandedProvider === provider.id ? null : provider.id)}
              >
                <span style={{ fontWeight: 700, fontSize: "15px", color: "#0f172a" }}>{provider.name}</span>
                <span style={{ fontSize: "12px", color: "#64748b" }}>{provider.specialty} {expandedProvider === provider.id ? "▲" : "▼"}</span>
              </button>

              {expandedProvider === provider.id && (
                <div style={{ padding: "16px", borderTop: "1px solid #f1f5f9" }}>
                  {/* Weekly Schedule */}
                  <h4 style={styles.availSectionTitle}>Weekly Schedule</h4>
                  <table style={styles.scheduleTable}>
                    <thead>
                      <tr>
                        <th style={styles.scheduleTh}>Day</th>
                        <th style={styles.scheduleTh}>Start</th>
                        <th style={styles.scheduleTh}>End</th>
                        <th style={styles.scheduleTh}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {[0,1,2,3,4,5,6].map((day) => {
                        const existing = provider.schedules?.find((s) => s.weekday === day);
                        const key = `${provider.id}-${day}`;
                        const edit = scheduleEdits[key] ?? { startTime: existing?.startTime ?? "09:00", endTime: existing?.endTime ?? "18:00" };
                        return (
                          <tr key={day} style={styles.scheduleTr}>
                            <td style={styles.scheduleTd}>{WEEKDAYS[day]}</td>
                            <td style={styles.scheduleTd}>
                              <input
                                type="time"
                                value={edit.startTime}
                                onChange={(e) => setScheduleEdits((prev) => ({ ...prev, [key]: { ...edit, startTime: e.target.value } }))}
                                style={styles.timeInput}
                              />
                            </td>
                            <td style={styles.scheduleTd}>
                              <input
                                type="time"
                                value={edit.endTime}
                                onChange={(e) => setScheduleEdits((prev) => ({ ...prev, [key]: { ...edit, endTime: e.target.value } }))}
                                style={styles.timeInput}
                              />
                            </td>
                            <td style={styles.scheduleTd}>
                              <button
                                onClick={() => handleSaveSchedule(provider.id, day)}
                                disabled={savingSchedule === key}
                                style={styles.smallSaveBtn}
                              >
                                {savingSchedule === key ? "..." : existing ? "Update" : "Add"}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>

                  {/* Time-Off */}
                  <h4 style={{ ...styles.availSectionTitle, marginTop: "20px" }}>Upcoming Time-Off / Blocked Slots</h4>
                  {(provider.timeOff ?? []).length === 0 ? (
                    <p style={{ fontSize: "13px", color: "#94a3b8", margin: "0 0 12px 0" }}>No upcoming time-off entries.</p>
                  ) : (
                    <div style={{ marginBottom: "12px" }}>
                      {(provider.timeOff ?? []).map((t) => (
                        <div key={t.id} style={styles.timeOffRow}>
                          <div style={{ fontSize: "13px", color: "#1e293b" }}>
                            <strong>{new Date(t.startAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</strong>
                            {" → "}
                            {new Date(t.endAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
                            {t.reason && <span style={{ color: "#64748b" }}> — {t.reason}</span>}
                          </div>
                          <button
                            onClick={() => handleDeleteTimeOff(provider.id, t.id)}
                            style={styles.deleteBtn}
                          >
                            Delete
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <div style={styles.timeOffForm}>
                    <div style={styles.timeOffFormRow}>
                      <div style={styles.timeOffField}>
                        <label style={styles.fieldLabel}>FROM</label>
                        <input
                          type="datetime-local"
                          value={timeOffForm[provider.id]?.startAt ?? ""}
                          onChange={(e) => setTimeOffForm((prev) => ({ ...prev, [provider.id]: { ...prev[provider.id], startAt: e.target.value, endAt: prev[provider.id]?.endAt ?? "", reason: prev[provider.id]?.reason ?? "" } }))}
                          style={styles.dateTimeInput}
                        />
                      </div>
                      <div style={styles.timeOffField}>
                        <label style={styles.fieldLabel}>TO</label>
                        <input
                          type="datetime-local"
                          value={timeOffForm[provider.id]?.endAt ?? ""}
                          onChange={(e) => setTimeOffForm((prev) => ({ ...prev, [provider.id]: { ...prev[provider.id], startAt: prev[provider.id]?.startAt ?? "", endAt: e.target.value, reason: prev[provider.id]?.reason ?? "" } }))}
                          style={styles.dateTimeInput}
                        />
                      </div>
                      <div style={{ ...styles.timeOffField, flex: 2 }}>
                        <label style={styles.fieldLabel}>REASON (optional)</label>
                        <input
                          type="text"
                          placeholder="e.g. Conference, Sick leave"
                          value={timeOffForm[provider.id]?.reason ?? ""}
                          onChange={(e) => setTimeOffForm((prev) => ({ ...prev, [provider.id]: { ...prev[provider.id], startAt: prev[provider.id]?.startAt ?? "", endAt: prev[provider.id]?.endAt ?? "", reason: e.target.value } }))}
                          style={styles.dateTimeInput}
                        />
                      </div>
                    </div>
                    <button
                      onClick={() => handleAddTimeOff(provider.id)}
                      disabled={savingTimeOff === provider.id}
                      style={styles.addTimeOffBtn}
                    >
                      {savingTimeOff === provider.id ? "Adding..." : "+ Block Time / Add Time-Off"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </section>
      )}
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
  alertSuccess: {
    background: "#ecfdf5",
    border: "1px solid #a7f3d0",
    color: "#047857",
    padding: "10px 14px",
    borderRadius: "8px",
    fontSize: "13px",
    fontWeight: "500" as const,
    marginBottom: "16px",
  },
  tabBar: {
    display: "flex",
    gap: "4px",
    marginBottom: "24px",
    background: "#f8fafc",
    padding: "6px",
    borderRadius: "12px",
    border: "1px solid #e2e8f0",
  },
  tabBtn: {
    flex: 1,
    padding: "8px 16px",
    background: "transparent",
    border: "none",
    borderRadius: "8px",
    fontSize: "13px",
    fontWeight: "600" as const,
    color: "#64748b",
    cursor: "pointer",
  },
  tabBtnActive: {
    flex: 1,
    padding: "8px 16px",
    background: "#ffffff",
    border: "none",
    borderRadius: "8px",
    fontSize: "13px",
    fontWeight: "700" as const,
    color: "#4f46e5",
    cursor: "pointer",
    boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
  },
  providerBlock: {
    border: "1px solid #e2e8f0",
    borderRadius: "12px",
    overflow: "hidden" as const,
    marginBottom: "12px",
  },
  providerBlockHeader: {
    width: "100%",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "14px 16px",
    background: "#f8fafc",
    border: "none",
    cursor: "pointer",
    textAlign: "left" as const,
  },
  availSectionTitle: {
    margin: "0 0 10px 0",
    fontSize: "12px",
    fontWeight: "700" as const,
    color: "#94a3b8",
    letterSpacing: "0.5px",
    textTransform: "uppercase" as const,
  },
  scheduleTable: {
    width: "100%",
    borderCollapse: "collapse" as const,
    fontSize: "13px",
  },
  scheduleTh: {
    textAlign: "left" as const,
    padding: "6px 8px",
    fontSize: "11px",
    fontWeight: "700" as const,
    color: "#94a3b8",
    borderBottom: "1px solid #f1f5f9",
  },
  scheduleTr: {
    borderBottom: "1px solid #f8fafc",
  },
  scheduleTd: {
    padding: "6px 8px",
    color: "#334155",
  },
  timeInput: {
    border: "1px solid #e2e8f0",
    borderRadius: "6px",
    padding: "4px 8px",
    fontSize: "13px",
    color: "#0f172a",
    outline: "none",
  },
  smallSaveBtn: {
    background: "#6366f1",
    color: "#ffffff",
    border: "none",
    borderRadius: "6px",
    padding: "4px 10px",
    fontSize: "12px",
    fontWeight: "600" as const,
    cursor: "pointer",
  },
  timeOffRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "8px 0",
    borderBottom: "1px solid #f1f5f9",
  },
  deleteBtn: {
    background: "transparent",
    color: "#ef4444",
    border: "1px solid #fee2e2",
    borderRadius: "6px",
    padding: "4px 10px",
    fontSize: "12px",
    fontWeight: "600" as const,
    cursor: "pointer",
  },
  timeOffForm: {
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    borderRadius: "10px",
    padding: "12px",
    marginTop: "12px",
  },
  timeOffFormRow: {
    display: "flex",
    gap: "10px",
    marginBottom: "10px",
    flexWrap: "wrap" as const,
  },
  timeOffField: {
    flex: 1,
    display: "flex",
    flexDirection: "column" as const,
    gap: "4px",
    minWidth: "160px",
  },
  fieldLabel: {
    fontSize: "10px",
    fontWeight: "700" as const,
    color: "#94a3b8",
    letterSpacing: "0.5px",
  },
  dateTimeInput: {
    border: "1px solid #e2e8f0",
    borderRadius: "6px",
    padding: "6px 8px",
    fontSize: "13px",
    color: "#0f172a",
    outline: "none",
    width: "100%",
  },
  addTimeOffBtn: {
    background: "#f59e0b",
    color: "#ffffff",
    border: "none",
    borderRadius: "8px",
    padding: "8px 16px",
    fontSize: "13px",
    fontWeight: "600" as const,
    cursor: "pointer",
  },
};
