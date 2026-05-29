"use client";

import React from "react";
import { AppointmentStatus } from "@prisma/client";

interface Provider {
  id: string;
  name: string;
}

interface Appointment {
  id: string;
  startAt: string;
  endAt: string;
  status: AppointmentStatus;
  notes: string | null;
  patient: { fullName: string };
  provider: Provider;
}

interface WeekCalendarProps {
  appointments: Appointment[];
  providers: Provider[];
  weekOffset: number;
  onWeekChange: (offset: number) => void;
}

const HOUR_HEIGHT = 60; // px per hour
const DAY_START_HOUR = 8;
const DAY_END_HOUR = 20;
const TOTAL_HOURS = DAY_END_HOUR - DAY_START_HOUR;

const PROVIDER_COLORS = [
  "#6366f1", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"
];

function getWeekDates(weekOffset: number): Date[] {
  const now = new Date();
  const day = now.getDay(); // 0 = Sunday
  const monday = new Date(now);
  monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1) + weekOffset * 7);
  monday.setHours(0, 0, 0, 0);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export default function WeekCalendar({ appointments, providers, weekOffset, onWeekChange }: WeekCalendarProps) {
  const weekDates = getWeekDates(weekOffset);

  const providerColorMap: Record<string, string> = {};
  providers.forEach((p, i) => {
    providerColorMap[p.id] = PROVIDER_COLORS[i % PROVIDER_COLORS.length];
  });

  const startOfWeek = new Date(weekDates[0]);
  startOfWeek.setHours(0, 0, 0, 0);
  const endOfWeek = new Date(weekDates[6]);
  endOfWeek.setHours(23, 59, 59, 999);

  const weekAppointments = appointments.filter((apt) => {
    const d = new Date(apt.startAt);
    return d >= startOfWeek && d <= endOfWeek;
  });

  return (
    <div style={styles.wrapper}>
      {/* Navigation */}
      <div style={styles.navRow}>
        <button onClick={() => onWeekChange(weekOffset - 1)} style={styles.navBtn}>&#8592; Prev</button>
        <span style={styles.weekLabel}>
          {weekDates[0].toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          {" – "}
          {weekDates[6].toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
        </span>
        <button onClick={() => onWeekChange(weekOffset + 1)} style={styles.navBtn}>Next &#8594;</button>
      </div>

      {/* Calendar grid */}
      <div style={styles.grid}>
        {/* Time gutter */}
        <div style={styles.timeGutter}>
          <div style={styles.cornerCell} />
          {Array.from({ length: TOTAL_HOURS }, (_, i) => (
            <div key={i} style={{ ...styles.hourLabel, height: `${HOUR_HEIGHT}px` }}>
              {String(DAY_START_HOUR + i).padStart(2, "0")}:00
            </div>
          ))}
        </div>

        {/* Day columns */}
        {weekDates.map((date, dayIdx) => {
          const dayStr = date.toDateString();
          const dayApts = weekAppointments.filter(
            (a) => new Date(a.startAt).toDateString() === dayStr
          );
          const isToday = date.toDateString() === new Date().toDateString();

          return (
            <div key={dayIdx} style={styles.dayColumn}>
              {/* Day header */}
              <div style={isToday ? { ...styles.dayHeader, background: "#e0e7ff", color: "#4f46e5" } : styles.dayHeader}>
                <span style={styles.dayName}>
                  {date.toLocaleDateString("en-US", { weekday: "short" })}
                </span>
                <span style={styles.dayDate}>
                  {date.toLocaleDateString("en-US", { day: "numeric", month: "short" })}
                </span>
              </div>

              {/* Hour rows */}
              <div style={{ ...styles.dayBody, height: `${TOTAL_HOURS * HOUR_HEIGHT}px`, position: "relative" }}>
                {Array.from({ length: TOTAL_HOURS }, (_, i) => (
                  <div
                    key={i}
                    style={{
                      position: "absolute",
                      top: `${i * HOUR_HEIGHT}px`,
                      left: 0,
                      right: 0,
                      height: `${HOUR_HEIGHT}px`,
                      borderBottom: "1px solid #f1f5f9",
                    }}
                  />
                ))}

                {/* Appointment cards */}
                {dayApts.map((apt) => {
                  const start = new Date(apt.startAt);
                  const end = new Date(apt.endAt);
                  const startMins = start.getHours() * 60 + start.getMinutes();
                  const endMins = end.getHours() * 60 + end.getMinutes();
                  const dayStartMins = DAY_START_HOUR * 60;
                  const dayEndMins = DAY_END_HOUR * 60;

                  const topMins = clamp(startMins, dayStartMins, dayEndMins) - dayStartMins;
                  const heightMins = clamp(endMins, dayStartMins, dayEndMins) - clamp(startMins, dayStartMins, dayEndMins);

                  const topPx = (topMins / 60) * HOUR_HEIGHT;
                  const heightPx = Math.max((heightMins / 60) * HOUR_HEIGHT, 18);

                  const color = providerColorMap[apt.provider.id] ?? "#6366f1";
                  const isCancelled = apt.status.startsWith("CANCELLED") || apt.status === "NO_SHOW";

                  return (
                    <div
                      key={apt.id}
                      title={`${apt.patient.fullName} · ${apt.provider.name}\n${start.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })} – ${end.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}`}
                      style={{
                        position: "absolute",
                        top: `${topPx}px`,
                        height: `${heightPx}px`,
                        left: "2px",
                        right: "2px",
                        background: isCancelled ? "#f1f5f9" : `${color}22`,
                        borderLeft: `3px solid ${isCancelled ? "#94a3b8" : color}`,
                        borderRadius: "4px",
                        padding: "2px 4px",
                        overflow: "hidden",
                        cursor: "default",
                        zIndex: 1,
                      }}
                    >
                      <div style={{ fontSize: "10px", fontWeight: 700, color: isCancelled ? "#94a3b8" : color, lineHeight: 1.2, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
                        {apt.patient.fullName}
                      </div>
                      {heightPx > 28 && (
                        <div style={{ fontSize: "9px", color: "#64748b", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
                          {apt.provider.name}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const styles = {
  wrapper: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: "16px",
    overflow: "hidden" as const,
  },
  navRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "12px 16px",
    borderBottom: "1px solid #e2e8f0",
    background: "#f8fafc",
  },
  navBtn: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: "8px",
    padding: "6px 12px",
    fontSize: "13px",
    fontWeight: "600" as const,
    color: "#475569",
    cursor: "pointer",
  },
  weekLabel: {
    fontSize: "14px",
    fontWeight: "700" as const,
    color: "#0f172a",
  },
  grid: {
    display: "flex",
    overflowX: "auto" as const,
  },
  timeGutter: {
    flexShrink: 0,
    width: "44px",
    borderRight: "1px solid #e2e8f0",
  },
  cornerCell: {
    height: "40px",
    borderBottom: "1px solid #e2e8f0",
  },
  hourLabel: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "flex-end",
    paddingRight: "6px",
    paddingTop: "2px",
    fontSize: "9px",
    color: "#94a3b8",
    fontWeight: "600" as const,
    borderBottom: "1px solid #f1f5f9",
    boxSizing: "border-box" as const,
  },
  dayColumn: {
    flex: 1,
    minWidth: "100px",
    borderRight: "1px solid #e2e8f0",
  },
  dayHeader: {
    height: "40px",
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "center",
    borderBottom: "1px solid #e2e8f0",
    background: "#f8fafc",
  },
  dayName: {
    fontSize: "10px",
    fontWeight: "700" as const,
    color: "#64748b",
    textTransform: "uppercase" as const,
    letterSpacing: "0.5px",
  },
  dayDate: {
    fontSize: "11px",
    fontWeight: "600" as const,
    color: "#1e293b",
  },
  dayBody: {
    background: "#ffffff",
  },
};
