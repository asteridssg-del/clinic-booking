"use client";

import React, { useState, useEffect } from "react";
import { AppointmentStatus, ReminderChannel } from "@prisma/client";

interface User {
  id: string;
  name: string | null;
  email: string;
}

interface Provider {
  id: string;
  name: string;
  specialty: string;
  clinicId: string;
}

interface Clinic {
  id: string;
  name: string;
  timezone: string;
}

interface Appointment {
  id: string;
  startAt: string;
  endAt: string;
  status: AppointmentStatus;
  notes: string | null;
  provider: {
    name: string;
    specialty: string;
  };
  clinic: {
    name: string;
    timezone: string;
  };
}

interface PatientDashboardProps {
  user: User;
  tenantName: string;
  providers: Provider[];
  clinics: Clinic[];
  activeAppointment: Appointment | null;
}

export default function PatientDashboard({
  user,
  tenantName,
  providers,
  clinics,
  activeAppointment: initialActiveAppointment,
}: PatientDashboardProps) {
  // Booking & Rescheduling States
  const [activeAppointment, setActiveAppointment] = useState<Appointment | null>(initialActiveAppointment);
  const [isRescheduling, setIsRescheduling] = useState(false);
  
  // Wizard States
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selectedProvider, setSelectedProvider] = useState<Provider | null>(null);
  
  // Dates: Next 10 days
  const [datesList, setDatesList] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [slots, setSlots] = useState<string[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<string>("");
  
  // Booking input
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  // Populate next 10 days in local timezone
  useEffect(() => {
    const list = [];
    for (let i = 1; i <= 10; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      list.push(`${y}-${m}-${day}`);
    }
    setDatesList(list);
    if (list.length > 0) {
      setSelectedDate(list[0]);
    }
  }, []);

  // Fetch slots whenever doctor or date changes
  useEffect(() => {
    if (!selectedProvider || !selectedDate) return;
    
    const providerId = selectedProvider.id;
    
    async function fetchSlots() {
      setLoadingSlots(true);
      setErrorMsg("");
      try {
        const res = await fetch(
          `/api/v1/providers/${providerId}/availability?from=${selectedDate}&to=${selectedDate}`
        );
        if (!res.ok) {
          throw new Error("Failed to fetch slots");
        }
        const data = await res.json();
        // Extract slots array for the active date
        const dateSlotData = data.availability?.find((item: any) => item.date === selectedDate);
        setSlots(dateSlotData?.slots || []);
      } catch (err) {
        setErrorMsg("Could not load slot availability. Please try again.");
      } finally {
        setLoadingSlots(false);
      }
    }
    
    fetchSlots();
  }, [selectedProvider, selectedDate]);

  // Handle Booking Create
  const handleCreateBooking = async () => {
    if (!selectedProvider || !selectedSlot) return;
    
    setSubmitting(true);
    setErrorMsg("");
    setSuccessMsg("");
    
    const startAt = new Date(selectedSlot);
    const endAt = new Date(startAt.getTime() + 15 * 60_000); // 15-minute slot duration

    try {
      const res = await fetch("/api/v1/appointments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clinicId: selectedProvider.clinicId,
          providerId: selectedProvider.id,
          startAt: startAt.toISOString(),
          endAt: endAt.toISOString(),
          notes,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || data.error || "Failed to book appointment");
      }

      setSuccessMsg("Appointment booked successfully!");
      
      // Update local state with the new appointment details
      setActiveAppointment({
        id: data.id,
        startAt: data.startAt,
        endAt: data.endAt,
        status: data.status,
        notes: data.notes,
        provider: {
          name: selectedProvider.name,
          specialty: selectedProvider.specialty,
        },
        clinic: {
          name: clinics.find((c) => c.id === selectedProvider.clinicId)?.name || "Clinic",
          timezone: clinics.find((c) => c.id === selectedProvider.clinicId)?.timezone || "UTC",
        },
      });

      // Reset Wizard
      setStep(1);
      setSelectedProvider(null);
      setSelectedSlot("");
      setNotes("");
    } catch (err: any) {
      setErrorMsg(err.message || "An unexpected booking error occurred.");
    } finally {
      setSubmitting(false);
    }
  };

  // Handle Reschedule
  const handleReschedule = async () => {
    if (!activeAppointment || !selectedSlot) return;

    setSubmitting(true);
    setErrorMsg("");
    setSuccessMsg("");

    const startAt = new Date(selectedSlot);
    const endAt = new Date(startAt.getTime() + 15 * 60_000);

    try {
      const res = await fetch(`/api/v1/appointments/${activeAppointment.id}/reschedule`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startAt: startAt.toISOString(),
          endAt: endAt.toISOString(),
          providerId: selectedProvider?.id || activeAppointment.provider.name, // optional
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || data.error || "Rescheduling failed");
      }

      setSuccessMsg("Appointment rescheduled successfully!");
      
      // Update local active appointment
      setActiveAppointment({
        ...activeAppointment,
        startAt: data.startAt,
        endAt: data.endAt,
        provider: selectedProvider
          ? { name: selectedProvider.name, specialty: selectedProvider.specialty }
          : activeAppointment.provider,
      });

      // Exit rescheduling flow
      setIsRescheduling(false);
      setSelectedProvider(null);
      setSelectedSlot("");
    } catch (err: any) {
      setErrorMsg(err.message || "An unexpected error occurred during rescheduling.");
    } finally {
      setSubmitting(false);
    }
  };

  // Handle Cancellation
  const handleCancelBooking = async () => {
    if (!activeAppointment) return;

    if (!confirm("Are you sure you want to cancel your appointment? This cannot be undone.")) {
      return;
    }

    setSubmitting(true);
    setErrorMsg("");
    setSuccessMsg("");

    try {
      const res = await fetch(`/api/v1/appointments/${activeAppointment.id}/cancel`, {
        method: "POST",
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || data.error || "Cancellation failed");
      }

      setSuccessMsg("Appointment successfully cancelled.");
      setActiveAppointment(null);
      setIsRescheduling(false);
    } catch (err: any) {
      setErrorMsg(err.message || "Cancellation is not permitted within 2 hours of the start time.");
    } finally {
      setSubmitting(false);
    }
  };

  const formatDateLabel = (ymd: string) => {
    const d = new Date(ymd);
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  };

  const formatTimeSlot = (iso: string, timezone: string) => {
    return new Date(iso).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: timezone,
    });
  };

  return (
    <div style={styles.container}>
      {/* Header Panel */}
      <header style={styles.header}>
        <div>
          <span style={styles.badge}>{tenantName}</span>
          <h1 style={styles.title}>Book Your Appointment</h1>
          <p style={styles.subtitle}>Welcome back, {user.name || "Patient"}</p>
        </div>
        <a href="/api/auth/signout" style={styles.signOutBtn}>Sign Out</a>
      </header>

      {/* Notifications Panel */}
      {successMsg && <div style={styles.alertSuccess}>{successMsg}</div>}
      {errorMsg && <div style={styles.alertError}>{errorMsg}</div>}

      {/* Booking Flow Router */}
      {activeAppointment && !isRescheduling ? (
        /* ================= Active Appointment Mode ================= */
        <section style={styles.glassCard}>
          <div style={styles.cardHeader}>
            <h2 style={styles.sectionTitle}>Your Scheduled Appointment</h2>
            <span style={styles.statusBadge}>{activeAppointment.status}</span>
          </div>

          <div style={styles.appointmentGrid}>
            <div style={styles.detailsGroup}>
              <label style={styles.fieldLabel}>CLINIC</label>
              <p style={styles.fieldValue}>{activeAppointment.clinic.name}</p>
            </div>
            
            <div style={styles.detailsGroup}>
              <label style={styles.fieldLabel}>PRACTITIONER</label>
              <p style={styles.fieldValue}>{activeAppointment.provider.name}</p>
              <span style={styles.specialtyLabel}>{activeAppointment.provider.specialty}</span>
            </div>

            <div style={styles.detailsGroup}>
              <label style={styles.fieldLabel}>DATE & TIME</label>
              <p style={styles.fieldValue}>
                {new Date(activeAppointment.startAt).toLocaleDateString("en-US", {
                  weekday: "long",
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </p>
              <p style={styles.timeValue}>
                {formatTimeSlot(activeAppointment.startAt, activeAppointment.clinic.timezone)}
              </p>
            </div>

            {activeAppointment.notes && (
              <div style={{ ...styles.detailsGroup, gridColumn: "span 2" }}>
                <label style={styles.fieldLabel}>YOUR NOTES</label>
                <p style={styles.notesText}>"{activeAppointment.notes}"</p>
              </div>
            )}
          </div>

          <div style={styles.buttonContainer}>
            <button
              onClick={() => {
                // Initialize reschedule variables
                setIsRescheduling(true);
                const currentDoc = providers.find((p) => p.name === activeAppointment.provider.name);
                if (currentDoc) setSelectedProvider(currentDoc);
                setStep(2);
              }}
              style={styles.primaryBtn}
            >
              Reschedule Appointment
            </button>
            <button
              onClick={handleCancelBooking}
              disabled={submitting}
              style={styles.cancelBtn}
            >
              Cancel Appointment
            </button>
          </div>
        </section>
      ) : (
        /* ================= Booking Wizard Mode ================= */
        <section style={styles.glassCard}>
          {isRescheduling && (
            <div style={styles.rescheduleBanner}>
              <span>🔄 Rescheduling active booking.</span>
              <button onClick={() => setIsRescheduling(false)} style={styles.textLink}>Cancel</button>
            </div>
          )}

          {/* Stepper Wizard Indicator */}
          <div style={styles.stepper}>
            <div style={step === 1 ? styles.stepActive : styles.stepInactive}>1. Choose Practitioner</div>
            <div style={step === 2 ? styles.stepActive : styles.stepInactive}>2. Select Available Slot</div>
            <div style={step === 3 ? styles.stepActive : styles.stepInactive}>3. Confirm Details</div>
          </div>

          {/* STEP 1: Select Doctor */}
          {step === 1 && (
            <div>
              <h3 style={styles.stepTitle}>Select a Practitioner</h3>
              <div style={styles.doctorGrid}>
                {providers.map((doc) => (
                  <div
                    key={doc.id}
                    onClick={() => {
                      setSelectedProvider(doc);
                      setStep(2);
                    }}
                    style={styles.doctorCard}
                  >
                    <div style={styles.avatarPlaceholder}>
                      {doc.name.split(" ").pop()?.charAt(0)}
                    </div>
                    <div style={styles.doctorInfo}>
                      <h4 style={styles.doctorName}>{doc.name}</h4>
                      <p style={styles.doctorSpecialty}>{doc.specialty}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* STEP 2: Pick Date & Time */}
          {step === 2 && selectedProvider && (
            <div>
              <div style={styles.stepHeaderRow}>
                <h3 style={styles.stepTitle}>Pick a Date & Time Slot</h3>
                <button onClick={() => setStep(1)} style={styles.secondaryTextBtn}>← Back to doctors</button>
              </div>
              
              <div style={styles.doctorRowInline}>
                <div style={styles.smallAvatar}>
                  {selectedProvider.name.split(" ").pop()?.charAt(0)}
                </div>
                <div>
                  <h4 style={{ margin: 0 }}>{selectedProvider.name}</h4>
                  <p style={{ margin: 0, opacity: 0.7, fontSize: 13 }}>{selectedProvider.specialty}</p>
                </div>
              </div>

              {/* Date horizontal pill scrolling list */}
              <label style={styles.fieldLabel}>DATE</label>
              <div style={styles.dateSelector}>
                {datesList.map((date) => (
                  <button
                    key={date}
                    onClick={() => {
                      setSelectedDate(date);
                      setSelectedSlot("");
                    }}
                    style={selectedDate === date ? styles.datePillActive : styles.datePill}
                  >
                    {formatDateLabel(date)}
                  </button>
                ))}
              </div>

              {/* Time slot picker */}
              <label style={styles.fieldLabel}>AVAILABLE SLOTS (Clinic Local Time)</label>
              {loadingSlots ? (
                <div style={styles.loader}>Searching active slots...</div>
              ) : slots.length === 0 ? (
                <div style={styles.emptyState}>
                  No slots available on this date. Please select another date.
                </div>
              ) : (
                <div style={styles.slotGrid}>
                  {slots.map((iso) => (
                    <button
                      key={iso}
                      onClick={() => setSelectedSlot(iso)}
                      style={selectedSlot === iso ? styles.slotBtnActive : styles.slotBtn}
                    >
                      {formatTimeSlot(iso, clinics.find((c) => c.id === selectedProvider.clinicId)?.timezone || "Asia/Hong_Kong")}
                    </button>
                  ))}
                </div>
              )}

              {selectedSlot && (
                <button
                  onClick={() => {
                    if (isRescheduling) {
                      handleReschedule();
                    } else {
                      setStep(3);
                    }
                  }}
                  disabled={submitting}
                  style={styles.bottomNextBtn}
                >
                  {isRescheduling ? "Confirm Reschedule" : "Next: Confirm Booking"}
                </button>
              )}
            </div>
          )}

          {/* STEP 3: Confirm Details */}
          {step === 3 && selectedProvider && selectedSlot && (
            <div>
              <div style={styles.stepHeaderRow}>
                <h3 style={styles.stepTitle}>Confirm Booking</h3>
                <button onClick={() => setStep(2)} style={styles.secondaryTextBtn}>← Back to calendar</button>
              </div>

              <div style={styles.confirmCard}>
                <h4 style={styles.confirmSub}>BOOKING RECAP</h4>
                <div style={styles.recapRow}>
                  <span style={styles.recapLabel}>Clinic:</span>
                  <span style={styles.recapVal}>
                    {clinics.find((c) => c.id === selectedProvider.clinicId)?.name}
                  </span>
                </div>
                <div style={styles.recapRow}>
                  <span style={styles.recapLabel}>Practitioner:</span>
                  <span style={styles.recapVal}>{selectedProvider.name}</span>
                </div>
                <div style={styles.recapRow}>
                  <span style={styles.recapLabel}>Date:</span>
                  <span style={styles.recapVal}>
                    {new Date(selectedSlot).toLocaleDateString("en-US", {
                      weekday: "long",
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    })}
                  </span>
                </div>
                <div style={styles.recapRow}>
                  <span style={styles.recapLabel}>Time Slot:</span>
                  <span style={styles.recapTime}>
                    {formatTimeSlot(selectedSlot, clinics.find((c) => c.id === selectedProvider.clinicId)?.timezone || "Asia/Hong_Kong")}
                  </span>
                </div>
              </div>

              <div style={{ marginTop: 20 }}>
                <label htmlFor="notes" style={styles.fieldLabel}>ADDITIONAL NOTES (Optional)</label>
                <textarea
                  id="notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Tell us any symptoms or reason for visit..."
                  rows={4}
                  style={styles.notesTextarea}
                />
              </div>

              <button
                onClick={handleCreateBooking}
                disabled={submitting}
                style={styles.bookCTA}
              >
                {submitting ? "Booking appointment..." : "Confirm & Book Now"}
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

// Premium Sleek HSL Styles (Glassmorphism inspired)
const styles = {
  container: {
    maxWidth: "600px",
    margin: "0 auto",
    padding: "24px 16px",
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column" as const,
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "32px",
    padding: "0 8px",
  },
  badge: {
    background: "linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)",
    color: "#ffffff",
    fontSize: "11px",
    fontWeight: "700" as const,
    textTransform: "uppercase" as const,
    padding: "4px 8px",
    borderRadius: "12px",
    letterSpacing: "0.5px",
    display: "inline-block",
    marginBottom: "8px",
  },
  title: {
    margin: "0",
    fontSize: "24px",
    fontWeight: "800" as const,
    letterSpacing: "-0.5px",
    color: "#0f172a",
  },
  subtitle: {
    margin: "4px 0 0 0",
    fontSize: "14px",
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
  alertSuccess: {
    background: "#ecfdf5",
    border: "1px solid #a7f3d0",
    color: "#047857",
    padding: "12px 16px",
    borderRadius: "10px",
    fontSize: "14px",
    fontWeight: "500" as const,
    marginBottom: "20px",
  },
  alertError: {
    background: "#fef2f2",
    border: "1px solid #fca5a5",
    color: "#b91c1c",
    padding: "12px 16px",
    borderRadius: "10px",
    fontSize: "14px",
    fontWeight: "500" as const,
    marginBottom: "20px",
  },
  glassCard: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: "20px",
    padding: "24px",
    boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.05)",
    position: "relative" as const,
    overflow: "hidden" as const,
  },
  cardHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "24px",
    borderBottom: "1px solid #f1f5f9",
    paddingBottom: "16px",
  },
  sectionTitle: {
    margin: "0",
    fontSize: "18px",
    fontWeight: "700" as const,
    color: "#0f172a",
  },
  statusBadge: {
    background: "#e0f2fe",
    color: "#0369a1",
    fontSize: "11px",
    fontWeight: "700" as const,
    padding: "4px 8px",
    borderRadius: "6px",
    textTransform: "uppercase" as const,
  },
  appointmentGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "20px",
    marginBottom: "24px",
  },
  detailsGroup: {
    display: "flex",
    flexDirection: "column" as const,
  },
  fieldLabel: {
    fontSize: "10px",
    fontWeight: "700" as const,
    color: "#94a3b8",
    letterSpacing: "1px",
    marginBottom: "6px",
  },
  fieldValue: {
    margin: "0",
    fontSize: "15px",
    fontWeight: "600" as const,
    color: "#1e293b",
  },
  specialtyLabel: {
    fontSize: "12px",
    color: "#64748b",
  },
  timeValue: {
    margin: "4px 0 0 0",
    fontSize: "20px",
    fontWeight: "800" as const,
    color: "#4f46e5",
  },
  notesText: {
    margin: "0",
    fontSize: "13px",
    color: "#64748b",
    fontStyle: "italic" as const,
    background: "#f8fafc",
    padding: "10px",
    borderRadius: "8px",
    borderLeft: "3px solid #cbd5e1",
  },
  buttonContainer: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "12px",
    borderTop: "1px solid #f1f5f9",
    paddingTop: "20px",
  },
  primaryBtn: {
    background: "linear-gradient(135deg, #4f46e5 0%, #4338ca 100%)",
    color: "#ffffff",
    border: "none",
    padding: "14px",
    borderRadius: "12px",
    fontSize: "15px",
    fontWeight: "600" as const,
    cursor: "pointer",
    boxShadow: "0 4px 12px rgba(79, 70, 229, 0.15)",
    transition: "all 0.2s ease",
  },
  cancelBtn: {
    background: "transparent",
    color: "#ef4444",
    border: "1px solid #fee2e2",
    padding: "14px",
    borderRadius: "12px",
    fontSize: "15px",
    fontWeight: "600" as const,
    cursor: "pointer",
    transition: "all 0.2s ease",
  },
  rescheduleBanner: {
    background: "#fef3c7",
    border: "1px solid #fde68a",
    color: "#92400e",
    padding: "10px 14px",
    borderRadius: "8px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    fontSize: "13px",
    fontWeight: "500" as const,
    marginBottom: "20px",
  },
  textLink: {
    background: "transparent",
    border: "none",
    color: "#b45309",
    textDecoration: "underline",
    cursor: "pointer",
    fontWeight: "700" as const,
  },
  stepper: {
    display: "flex",
    justifyContent: "space-between",
    marginBottom: "24px",
    background: "#f8fafc",
    padding: "8px",
    borderRadius: "12px",
    border: "1px solid #f1f5f9",
  },
  stepActive: {
    flex: 1,
    textAlign: "center" as const,
    fontSize: "11px",
    fontWeight: "700" as const,
    color: "#4f46e5",
    padding: "6px 0",
    background: "#ffffff",
    borderRadius: "8px",
    boxShadow: "0 1px 3px rgba(0, 0, 0, 0.05)",
  },
  stepInactive: {
    flex: 1,
    textAlign: "center" as const,
    fontSize: "11px",
    fontWeight: "500" as const,
    color: "#94a3b8",
    padding: "6px 0",
  },
  stepTitle: {
    margin: "0 0 16px 0",
    fontSize: "16px",
    fontWeight: "700" as const,
    color: "#0f172a",
  },
  stepHeaderRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: "16px",
  },
  secondaryTextBtn: {
    background: "transparent",
    border: "none",
    color: "#4f46e5",
    fontSize: "13px",
    fontWeight: "600" as const,
    cursor: "pointer",
  },
  doctorGrid: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "12px",
  },
  doctorCard: {
    display: "flex",
    alignItems: "center",
    padding: "16px",
    background: "#f8fafc",
    border: "1px solid #f1f5f9",
    borderRadius: "12px",
    cursor: "pointer",
    transition: "all 0.2s ease",
    ":hover": {
      borderColor: "#cbd5e1",
      background: "#f1f5f9",
    },
  },
  avatarPlaceholder: {
    width: "44px",
    height: "44px",
    borderRadius: "22px",
    background: "#e0e7ff",
    color: "#4f46e5",
    fontWeight: "700" as const,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    marginRight: "16px",
    fontSize: "18px",
  },
  doctorInfo: {
    display: "flex",
    flexDirection: "column" as const,
  },
  doctorName: {
    margin: "0",
    fontSize: "15px",
    fontWeight: "700" as const,
    color: "#1e293b",
  },
  doctorSpecialty: {
    margin: "2px 0 0 0",
    fontSize: "12px",
    color: "#64748b",
  },
  doctorRowInline: {
    display: "flex",
    alignItems: "center",
    background: "#f8fafc",
    padding: "12px",
    borderRadius: "10px",
    border: "1px solid #f1f5f9",
    marginBottom: "20px",
  },
  smallAvatar: {
    width: "32px",
    height: "32px",
    borderRadius: "16px",
    background: "#e0e7ff",
    color: "#4f46e5",
    fontWeight: "700" as const,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    marginRight: "12px",
    fontSize: "14px",
  },
  dateSelector: {
    display: "flex",
    gap: "8px",
    overflowX: "auto" as const,
    paddingBottom: "8px",
    marginBottom: "20px",
  },
  datePill: {
    flexShrink: 0,
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    borderRadius: "10px",
    padding: "10px 14px",
    fontSize: "12px",
    fontWeight: "600" as const,
    color: "#64748b",
    cursor: "pointer",
  },
  datePillActive: {
    flexShrink: 0,
    background: "#4f46e5",
    border: "1px solid #4f46e5",
    borderRadius: "10px",
    padding: "10px 14px",
    fontSize: "12px",
    fontWeight: "600" as const,
    color: "#ffffff",
    cursor: "pointer",
  },
  loader: {
    padding: "24px 0",
    textAlign: "center" as const,
    fontSize: "14px",
    color: "#64748b",
    fontWeight: "500" as const,
  },
  emptyState: {
    padding: "24px",
    background: "#f8fafc",
    borderRadius: "10px",
    border: "1px dashed #cbd5e1",
    textAlign: "center" as const,
    fontSize: "13px",
    color: "#64748b",
    marginBottom: "20px",
  },
  slotGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(80px, 1fr))",
    gap: "10px",
    marginBottom: "20px",
  },
  slotBtn: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: "8px",
    padding: "10px 4px",
    fontSize: "13px",
    fontWeight: "600" as const,
    color: "#334155",
    cursor: "pointer",
    transition: "all 0.15s ease",
  },
  slotBtnActive: {
    background: "#4f46e5",
    border: "1px solid #4f46e5",
    color: "#ffffff",
    borderRadius: "8px",
    padding: "10px 4px",
    fontSize: "13px",
    fontWeight: "600" as const,
    cursor: "pointer",
  },
  bottomNextBtn: {
    width: "100%",
    background: "linear-gradient(135deg, #4f46e5 0%, #4338ca 100%)",
    color: "#ffffff",
    border: "none",
    padding: "14px",
    borderRadius: "12px",
    fontSize: "15px",
    fontWeight: "600" as const,
    cursor: "pointer",
    boxShadow: "0 4px 12px rgba(79, 70, 229, 0.15)",
  },
  confirmCard: {
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    borderRadius: "12px",
    padding: "16px",
  },
  confirmSub: {
    margin: "0 0 12px 0",
    fontSize: "10px",
    fontWeight: "700" as const,
    color: "#94a3b8",
    letterSpacing: "1px",
  },
  recapRow: {
    display: "flex",
    justifyContent: "space-between",
    padding: "6px 0",
    borderBottom: "1px solid #f1f5f9",
    ":last-child": {
      borderBottom: "none",
    },
  },
  recapLabel: {
    fontSize: "13px",
    color: "#64748b",
  },
  recapVal: {
    fontSize: "13px",
    fontWeight: "600" as const,
    color: "#1e293b",
  },
  recapTime: {
    fontSize: "14px",
    fontWeight: "800" as const,
    color: "#4f46e5",
  },
  notesTextarea: {
    width: "100%",
    border: "1px solid #e2e8f0",
    borderRadius: "10px",
    padding: "12px",
    fontSize: "14px",
    color: "#0f172a",
    fontFamily: "inherit",
    outline: "none",
    resize: "none" as const,
    marginBottom: "20px",
    ":focus": {
      borderColor: "#6366f1",
    },
  },
  bookCTA: {
    width: "100%",
    background: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
    color: "#ffffff",
    border: "none",
    padding: "14px",
    borderRadius: "12px",
    fontSize: "15px",
    fontWeight: "600" as const,
    cursor: "pointer",
    boxShadow: "0 4px 12px rgba(16, 185, 129, 0.15)",
  },
};
