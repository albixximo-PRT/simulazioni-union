"use client"

import React, { useEffect, useMemo, useRef, useState } from "react"
import { toPng } from "html-to-image"

const APP_PASSWORD = "Gabus"
const AUTH_STORAGE_KEY = "albixximo_union_authorized"
const EXPORT_TEXTS_STORAGE_KEY = "albixximo_union_export_texts_session"

type UnionRow = {
  posizione: number
  nomePilota: string
  auto: string
  distacchi: string
  pp: string
  gv: string
  gara: string
  lobby: string
  lega: string
}

type DisplayRow = UnionRow & {
  sourcePosizione: number
}

type UnionMeta = {
  gara: string
  lobby: string
  lega: string
}

type ExportTexts = {
  mainTitle: string
  sideLabel: string
  subtitle: string
}

type MatchFieldStatus = "ok" | "warn" | "error"

type MatchSummary = {
  overallStatus: "ok" | "warn" | "error"
  percentage: number
  fields: {
    posizione: MatchFieldStatus
    nomePilota: MatchFieldStatus
    auto: MatchFieldStatus
    distacchi: MatchFieldStatus
    pp: MatchFieldStatus
    gv: MatchFieldStatus
    gara: MatchFieldStatus
    lobby: MatchFieldStatus
    lega: MatchFieldStatus
  }
  notes: string[]
}

type DGKind = "-" | "P" | "S" | "DSQ"

type DGRowComputed = UnionRow & {
  sourcePosizione: number
  dgKind?: DGKind
  dgSeconds?: number
  dgLabel?: string
  computedRaceMs?: number | null
  computedNonComparable?: boolean
  computedDsq?: boolean
  originalWasLapped?: boolean
}

const DEFAULT_EXPORT_TEXTS: ExportTexts = {
  mainTitle: "ALBIXXIMO UNION TOOLS",
  sideLabel: "UNION CSV EXTRACTOR",
  subtitle: "PRT Timing Assistant",
}

const DG_SECOND_OPTIONS = [
  "-",
  "5",
  "10",
  "15",
  "20",
  "25",
  "30",
  "35",
  "40",
  "45",
  "50",
  "55",
  "60",
] as const

function formatLobbyShort(lobby: string) {
  const raw = String(lobby || "").trim()
  const match = raw.match(/^A0*(\d+)$/i)
  if (match) return `A${Number(match[1])}`
  return raw || "union"
}

function normalizeMatchName(name: string) {
  return String(name || "")
    .toLowerCase()
    .replace(/__/g, "_")
    .replace(/_/g, " ")
    .replace(/[@#'"`´’‘.,\-]+/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function sameDriverForMatch(a: string, b: string) {
  const aa = normalizeMatchName(a)
  const bb = normalizeMatchName(b)
  if (!aa || !bb) return false
  return aa === bb
}

function normalizeSimpleValue(value: string) {
  return String(value || "").trim().toLowerCase()
}

function normalizePilotKey(value: string) {
  return normalizeMatchName(value)
}

function getRowStableKey(posizione: number) {
  return `row-${posizione}`
}

function isClearlySuspiciousCar(value: string): boolean {
  const raw = String(value || "").trim()
  if (!raw) return true

  const v = raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[''`´’‘]/g, "")
    .replace(/[‐-–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()

  if (!v) return true
  if (/^\d+$/.test(v)) return true
  if (!/[a-z]/i.test(v)) return true
  if (v.length < 4) return true

  const plausibleTokens: string[] = [
    "hybrid",
    "vision",
    "gr.4",
    "gr4",
    "gt3",
    "gt4",
    "lms",
    "r18",
    "919",
    "ts050",
    "gr010",
    "amg",
    "supra",
    "nsx",
    "hurac",
    "vantage",
    "gt-r",
    "gtr",
    "mazda",
    "silvia",
    "elantra",
    "cayman",
    "megane",
    "italia",
    "clubsport",
    "trophy",
    "touring car",
    "911",
    "r8",
    "4c",
  ]

  const hasPlausibleToken = plausibleTokens.some((token) => v.includes(token))
  if (hasPlausibleToken) return false

  if (/\(\d{3}\)/.test(raw)) return false
  if (/'\d{2}\b/.test(raw)) return false

  return true
}

function isUnionDistaccoValid(value: string, posizione: number) {
  const v = String(value || "").trim()
  if (!v) return posizione === 1 ? false : true

  if (posizione === 1) {
    return /^(?:\d+:)?\d{1,2}:\d{2}\.\d{3}$/.test(v)
  }

  if (v.toUpperCase() === "BOX") return true
  if (v.toUpperCase() === "DNF") return true
  if (v.toUpperCase() === "DOPPIATO") return true
  if (/^\d+giro$/i.test(v)) return true
  if (/^\+\d+\.\d{3}$/.test(v)) return true
  if (/^\+\d+:\d{2}\.\d{3}$/.test(v)) return true
  if (/^(?:\d+:)?\d{1,2}:\d{2}\.\d{3}$/.test(v)) return true

  return false
}

function statusBadge(status: MatchFieldStatus) {
  if (status === "ok") return "✅"
  if (status === "warn") return "⚠️"
  return "❌"
}

function overallBoxStyle(status: "ok" | "warn" | "error"): React.CSSProperties {
  if (status === "ok") {
    return {
      background: "rgba(34,197,94,0.14)",
      border: "1px solid rgba(34,197,94,0.45)",
      color: "#dcfce7",
    }
  }

  if (status === "warn") {
    return {
      background: "rgba(250,204,21,0.12)",
      border: "1px solid rgba(250,204,21,0.45)",
      color: "#fef3c7",
    }
  }

  return {
    background: "rgba(239,68,68,0.14)",
    border: "1px solid rgba(239,68,68,0.45)",
    color: "#fee2e2",
  }
}

function matchCellStyle(status: MatchFieldStatus): React.CSSProperties {
  if (status === "ok") {
    return {
      background: "linear-gradient(180deg, rgba(0,255,120,0.18), rgba(0,0,0,0.25))",
      border: "1px solid rgba(0,255,120,0.35)",
      boxShadow: "0 0 12px rgba(0,255,120,0.18)",
      color: "#ecfff5",
    }
  }

  if (status === "warn") {
    return {
      background: "linear-gradient(180deg, rgba(255,215,0,0.18), rgba(0,0,0,0.25))",
      border: "1px solid rgba(255,215,0,0.35)",
      boxShadow: "0 0 12px rgba(255,215,0,0.16)",
      color: "#fff8dc",
    }
  }

  return {
    background: "linear-gradient(180deg, rgba(255,80,80,0.18), rgba(0,0,0,0.25))",
    border: "1px solid rgba(255,80,80,0.35)",
    boxShadow: "0 0 12px rgba(255,80,80,0.14)",
    color: "#fff1f1",
  }
}

function parseLeaderRaceTimeMs(value: string): number | null {
  const v = String(value || "").trim()
  if (!v) return null

  const hms = v.match(/^(\d+):(\d{2}):(\d{2})\.(\d{3})$/)
  if (hms) {
    const hh = Number(hms[1])
    const mm = Number(hms[2])
    const ss = Number(hms[3])
    const ms = Number(hms[4])
    if ([hh, mm, ss, ms].some(Number.isNaN)) return null
    return (hh * 3600 + mm * 60 + ss) * 1000 + ms
  }

  const msOnly = v.match(/^(\d+):(\d{2})\.(\d{3})$/)
  if (msOnly) {
    const mm = Number(msOnly[1])
    const ss = Number(msOnly[2])
    const ms = Number(msOnly[3])
    if ([mm, ss, ms].some(Number.isNaN)) return null
    return (mm * 60 + ss) * 1000 + ms
  }

  return null
}

function parseGapToLeaderMs(value: string): number | null {
  const v = String(value || "").trim()
  if (!v) return null

  const normalized = v.replace(/\s+/g, "")

  const mmss = normalized.match(/^\+(\d+):(\d{2})\.(\d{3})$/)
  if (mmss) {
    const mm = Number(mmss[1])
    const ss = Number(mmss[2])
    const ms = Number(mmss[3])
    if ([mm, ss, ms].some(Number.isNaN)) return null
    return (mm * 60 + ss) * 1000 + ms
  }

  const ssOnly = normalized.match(/^\+(\d+)\.(\d{3})$/)
  if (ssOnly) {
    const ss = Number(ssOnly[1])
    const ms = Number(ssOnly[2])
    if ([ss, ms].some(Number.isNaN)) return null
    return ss * 1000 + ms
  }

  return null
}

function parseManualGapMs(value: string): number | null {
  const v = String(value || "").trim()
  if (!v) return null

  const match = v.match(/^(\d+):(\d{2})\.(\d{3})$/)
  if (!match) return null

  const mm = Number(match[1])
  const ss = Number(match[2])
  const ms = Number(match[3])

  if ([mm, ss, ms].some(Number.isNaN)) return null
  return (mm * 60 + ss) * 1000 + ms
}

function getComparableRaceMsForOrdering(
  row: Pick<UnionRow, "distacchi">,
  leaderMs: number | null
): number | null {
  const rawDistacco = String(row.distacchi || "").trim()

  if (!rawDistacco) return null
  if (isNonComparableUnionValue(rawDistacco)) return null

  const absoluteMs = parseLeaderRaceTimeMs(rawDistacco)
  if (absoluteMs != null) return absoluteMs

  if (leaderMs != null) {
    const gapMs = parseGapToLeaderMs(rawDistacco)
    if (gapMs != null) return leaderMs + gapMs
  }

  return null
}

function formatRaceTimeFromMs(totalMs: number): string {
  const safe = Math.max(0, Math.round(totalMs))
  const hours = Math.floor(safe / 3600000)
  const minutes = Math.floor((safe % 3600000) / 60000)
  const seconds = Math.floor((safe % 60000) / 1000)
  const millis = safe % 1000

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`
  }

  const totalMinutes = Math.floor(safe / 60000)
  return `${totalMinutes}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`
}

function formatGapFromLeaderMs(totalMs: number): string {
  const safe = Math.max(0, Math.round(totalMs))
  const minutes = Math.floor(safe / 60000)
  const seconds = Math.floor((safe % 60000) / 1000)
  const millis = safe % 1000

  return `+${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`
}

function formatDGLabel(seconds: number, kind: Exclude<DGKind, "-" | "DSQ">) {
  const safe = Math.max(0, Math.round(seconds || 0))
  const minutes = Math.floor(safe / 60)
  const secs = safe % 60
  return `+${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.000 | ${kind}`
}

function isDoppiatoValue(value: string) {
  const v = String(value || "").trim()
  if (!v) return false
  if (v.toUpperCase() === "DOPPIATO") return true
  return /^\d+giro$/i.test(v)
}

function isNonComparableUnionValue(value: string) {
  const v = String(value || "").trim().toUpperCase()
  if (!v) return true
  if (v === "BOX") return true
  if (v === "DNF") return true
  if (v === "DSQ") return true
  if (v === "DOPPIATO") return true
  if (/^\d+GIRO$/i.test(v)) return true
  return false
}

function buildUnionMatchSummary({
  rows,
  unionMeta,
  detectedPoleDriver,
  detectedBestLapDriver,
  detectedRaceOrder,
}: {
  rows: UnionRow[]
  unionMeta: UnionMeta
  detectedPoleDriver: string
  detectedBestLapDriver: string
  detectedRaceOrder: string[]
}): MatchSummary {
  const notes: string[] = []

  let posizione: MatchFieldStatus = "ok"
  let nomePilota: MatchFieldStatus = "ok"
  let auto: MatchFieldStatus = "ok"
  let distacchi: MatchFieldStatus = "ok"
  let pp: MatchFieldStatus = "ok"
  let gv: MatchFieldStatus = "ok"
  let gara: MatchFieldStatus = "ok"
  let lobby: MatchFieldStatus = "ok"
  let lega: MatchFieldStatus = "ok"

  if (!rows.length) {
    return {
      overallStatus: "warn",
      percentage: 0,
      fields: {
        posizione: "warn",
        nomePilota: "warn",
        auto: "warn",
        distacchi: "warn",
        pp: "warn",
        gv: "warn",
        gara: "warn",
        lobby: "warn",
        lega: "warn",
      },
      notes: ["Nessun dato da verificare."],
    }
  }

  const sortedRows = [...rows].sort((a, b) => a.posizione - b.posizione)

  for (let i = 0; i < sortedRows.length; i++) {
    if (sortedRows[i].posizione !== i + 1) {
      posizione = "error"
      notes.push("Ordine posizioni non consecutivo.")
      break
    }
  }

  for (const row of rows) {
    if (!String(row.nomePilota || "").trim()) {
      nomePilota = "error"
      notes.push("Presente almeno un nome pilota vuoto.")
      break
    }
  }

  for (const row of rows) {
    if (!String(row.auto || "").trim()) {
      auto = "error"
      notes.push("Presente almeno un'auto vuota.")
      break
    }
  }

  if (auto !== "error") {
    for (let i = 0; i < rows.length; i++) {
      const csvCar = rows[i]?.auto || ""
      if (isClearlySuspiciousCar(csvCar)) {
        auto = "warn"
        notes.push(`Possibile auto anomala in posizione ${i + 1}.`)
        break
      }
    }
  }

  for (const row of rows) {
    if (!isUnionDistaccoValid(row.distacchi, row.posizione)) {
      distacchi = "warn"
      notes.push("Almeno un distacco ha formato non standard UNION.")
      break
    }
  }

  const csvPoleRow = rows.find((r) => String(r.pp || "").trim().toUpperCase() === "PP")
  const csvGvRow = rows.find((r) => String(r.gv || "").trim().toUpperCase() === "GV")

  if (detectedPoleDriver) {
    if (!csvPoleRow) {
      pp = "error"
      notes.push("PP non presente nel CSV.")
    } else if (!sameDriverForMatch(csvPoleRow.nomePilota, detectedPoleDriver)) {
      pp = "error"
      notes.push("PP non coerente con la qualifica.")
    }
  } else if (!csvPoleRow) {
    pp = "warn"
    notes.push("PP non verificabile automaticamente.")
  }

  if (detectedBestLapDriver) {
    if (!csvGvRow) {
      gv = "error"
      notes.push("GV non presente nel CSV.")
    } else if (!sameDriverForMatch(csvGvRow.nomePilota, detectedBestLapDriver)) {
      gv = "error"
      notes.push("GV non coerente con la gara.")
    }
  } else if (!csvGvRow) {
    gv = "warn"
    notes.push("GV non verificabile automaticamente.")
  }

  if (detectedRaceOrder.length) {
    for (let i = 0; i < Math.min(rows.length, detectedRaceOrder.length); i++) {
      if (!sameDriverForMatch(rows[i].nomePilota, detectedRaceOrder[i])) {
        nomePilota = "warn"
        notes.push(`Possibile differenza nomi/ordine in posizione ${i + 1}.`)
        break
      }
    }
  }

  const garaValues = new Set(rows.map((r) => normalizeSimpleValue(r.gara)))
  const lobbyValues = new Set(rows.map((r) => normalizeSimpleValue(r.lobby)))
  const legaValues = new Set(rows.map((r) => normalizeSimpleValue(r.lega)))

  if (garaValues.size > 1) {
    gara = "error"
    notes.push("Valore Gara non uniforme.")
  }
  if (lobbyValues.size > 1) {
    lobby = "error"
    notes.push("Valore Lobby non uniforme.")
  }
  if (legaValues.size > 1) {
    lega = "error"
    notes.push("Valore Lega non uniforme.")
  }

  if (unionMeta.gara && normalizeSimpleValue(rows[0]?.gara) !== normalizeSimpleValue(unionMeta.gara)) {
    gara = "error"
    notes.push("Gara diversa dal meta rilevato.")
  }

  if (gara !== "error") {
    const allGaraValues = rows.map((r) => String(r.gara || "").trim())
    const uniqueGara = new Set(allGaraValues)

    if (
      uniqueGara.size === 1 &&
      (uniqueGara.has("18") || uniqueGara.has("-") || uniqueGara.has(""))
    ) {
      gara = "warn"
      notes.push("Numero gara non rilevato dagli screen (–). Inserisci manualmente.")
    }
  }

  if (unionMeta.lobby && normalizeSimpleValue(rows[0]?.lobby) !== normalizeSimpleValue(unionMeta.lobby)) {
    lobby = "error"
    notes.push("Lobby diversa dal meta rilevato.")
  }

  if (unionMeta.lega && normalizeSimpleValue(rows[0]?.lega) !== normalizeSimpleValue(unionMeta.lega)) {
    lega = "error"
    notes.push("Lega diversa dal meta rilevato.")
  }

  const fields = {
    posizione,
    nomePilota,
    auto,
    distacchi,
    pp,
    gv,
    gara,
    lobby,
    lega,
  }

  const values = Object.values(fields)
  const okCount = values.filter((v) => v === "ok").length
  const warnCount = values.filter((v) => v === "warn").length
  const errorCount = values.filter((v) => v === "error").length

  let percentage = 100
  let overallStatus: "ok" | "warn" | "error" = "ok"

  if (errorCount > 0) {
    overallStatus = "error"
    percentage = Math.round(((okCount + warnCount * 0.5) / values.length) * 100)
  } else if (warnCount > 0) {
    overallStatus = "warn"
    percentage = Math.round(((okCount + warnCount * 0.8) / values.length) * 100)
  }

  if (percentage < 0) percentage = 0
  if (percentage > 100) percentage = 100

  return {
    overallStatus,
    percentage,
    fields,
    notes,
  }
}

/* ===================== PUNTI UNION ===================== */

function getPointsForRow(r: DGRowComputed): number {
  const basePointsMap: Record<number, number> = {
    1: 30,
    2: 26,
    3: 22,
    4: 18,
    5: 16,
    6: 14,
    7: 12,
    8: 10,
    9: 8,
    10: 6,
    11: 4,
    12: 2,
    13: 1,
    14: 0,
  }

  let points = basePointsMap[r.posizione] ?? 0

  if ((r.pp || "").trim().toUpperCase() === "PP") points += 1
  if ((r.gv || "").trim().toUpperCase() === "GV") points += 1

  return points
}

function TableCell({
  children,
  align,
  mono,
  dim,
  style,
  exporting = false,
}: {
  children: React.ReactNode
  align?: "left" | "center" | "right"
  mono?: boolean
  dim?: boolean
  style?: React.CSSProperties
  exporting?: boolean
}) {
  return (
    <td
      style={{
        padding: exporting ? "10px 13px" : "12px 12px",
        borderBottom: "1px solid rgba(255,255,255,0.08)",
        textAlign: align ?? "left",
        fontFamily: mono ? "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" : undefined,
        fontSize: exporting ? 14 : 13,
        opacity: dim ? 0.75 : 0.95,
        verticalAlign: "middle",
        ...style,
      }}
    >
      {children}
    </td>
  )
}

function HeaderBadge({
  label,
  value,
  variant,
  exporting = false,
}: {
  label: string
  value: string
  variant: "gold" | "violet" | "silver"
  exporting?: boolean
}) {
  const palette =
    variant === "gold"
      ? { border: "rgba(255,215,0,0.70)", glow: "rgba(255,215,0,0.16)" }
      : variant === "silver"
        ? { border: "rgba(210,215,225,0.72)", glow: "rgba(210,215,225,0.18)" }
        : { border: "rgba(160,90,255,0.70)", glow: "rgba(160,90,255,0.14)" }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: exporting ? 12 : 10,
        flexWrap: "nowrap",
        whiteSpace: "nowrap",
      }}
    >
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          padding: exporting
            ? variant === "silver"
              ? "10px 16px"
              : "9px 14px"
            : variant === "silver"
              ? "8px 12px"
              : "7px 11px",
          borderRadius: 999,
          border: `1px solid ${palette.border}`,
          background: "rgba(0,0,0,0.20)",
          boxShadow: `0 0 22px ${palette.glow}`,
          color: "white",
          fontWeight: 900,
          fontSize: exporting
            ? variant === "silver"
              ? 15
              : 14
            : variant === "silver"
              ? 13
              : 12,
          letterSpacing: 0.6,
          textTransform: "uppercase",
          whiteSpace: "nowrap",
          flexShrink: 0,
        }}
      >
        {label}
      </span>

      <span
        style={{
          color: "white",
          fontWeight: 900,
          fontSize: exporting ? 16 : 14,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          letterSpacing: 0.2,
          whiteSpace: "nowrap",
          flexShrink: 0,
        }}
      >
        {value || "-"}
      </span>
    </div>
  )
}

function Pill({
  left,
  right,
  variant,
  exporting = false,
}: {
  left: string
  right?: string
  variant: "gold" | "violet" | "orange" | "teal" | "fuchsia"
  exporting?: boolean
}) {
  const styles: Record<typeof variant, React.CSSProperties> = {
    gold: {
      background: "rgba(255,215,0,0.92)",
      border: "1px solid rgba(255,215,0,0.55)",
      boxShadow: "0 0 22px rgba(255,215,0,0.20)",
    },
    violet: {
      background: "rgba(160,90,255,0.92)",
      border: "1px solid rgba(160,90,255,0.55)",
      boxShadow: "0 0 22px rgba(160,90,255,0.18)",
    },
    orange: {
      background: "rgba(255,165,0,0.92)",
      border: "1px solid rgba(255,165,0,0.55)",
      boxShadow: "0 0 22px rgba(255,165,0,0.16)",
    },
    teal: {
      background: "rgba(64,224,208,0.92)",
      border: "1px solid rgba(64,224,208,0.55)",
      boxShadow: "0 0 22px rgba(64,224,208,0.14)",
    },
    fuchsia: {
      background: "rgba(255,0,128,0.92)",
      border: "1px solid rgba(255,0,128,0.55)",
      boxShadow: "0 0 22px rgba(255,0,128,0.18)",
    },
  }

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: exporting ? 12 : 10,
        padding:
          exporting
            ? left === "DOPPIATO"
              ? "6px 14px"
              : left === "PP" || left === "GV"
                ? "7px 14px"
                : "10px 16px"
            : left === "DOPPIATO"
              ? "5px 10px"
              : "8px 12px",
        borderRadius:
          left === "DOPPIATO"
            ? 12
            : left === "PP" || left === "GV"
              ? 13
              : 14,
        fontSize: exporting ? 14 : 12,
        fontWeight: 900,
        letterSpacing: 0.6,
        textTransform: "uppercase",
        whiteSpace: "nowrap",
        color: "rgba(0,0,0,0.92)",
        ...styles[variant],
      }}
    >
      <span>{left}</span>
      {right ? (
        <span
          style={{
            paddingLeft: 10,
            borderLeft: "1px solid rgba(0,0,0,0.22)",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
            letterSpacing: 0.2,
            textTransform: "none",
            fontSize: exporting ? 15 : 12,
          }}
        >
          {right}
        </span>
      ) : null}
    </span>
  )
}

function PosBadge({ pos }: { pos: number }) {
  const base: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 34,
    height: 28,
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(0,0,0,0.22)",
    fontSize: 16,
    lineHeight: 1,
    userSelect: "none",
  }

  if (pos === 1) {
    return (
      <span
        title="P1"
        style={{
          ...base,
          borderColor: "rgba(255,215,0,0.40)",
          boxShadow: "0 0 22px rgba(255,215,0,0.16)",
        }}
      >
        🥇
      </span>
    )
  }

  if (pos === 2) {
    return (
      <span
        title="P2"
        style={{
          ...base,
          borderColor: "rgba(220,220,220,0.30)",
          boxShadow: "0 0 18px rgba(220,220,220,0.10)",
        }}
      >
        🥈
      </span>
    )
  }

  if (pos === 3) {
    return (
      <span
        title="P3"
        style={{
          ...base,
          borderColor: "rgba(205,127,50,0.35)",
          boxShadow: "0 0 18px rgba(205,127,50,0.12)",
        }}
      >
        🥉
      </span>
    )
  }

  return (
    <span
      title={`P${pos}`}
      style={{
        ...base,
        fontSize: 12,
        fontWeight: 900,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        opacity: 0.9,
      }}
    >
      {pos}
    </span>
  )
}

function rowStyleForPos(pos: number, fallback: string): React.CSSProperties {
  if (pos === 1) {
    return {
      background:
        "linear-gradient(90deg, rgba(255,215,0,0.11) 0%, rgba(255,215,0,0.05) 28%, rgba(255,255,255,0.02) 70%)",
    }
  }
  if (pos === 2) {
    return {
      background:
        "linear-gradient(90deg, rgba(220,220,220,0.10) 0%, rgba(220,220,220,0.04) 28%, rgba(255,255,255,0.02) 70%)",
    }
  }
  if (pos === 3) {
    return {
      background:
        "linear-gradient(90deg, rgba(205,127,50,0.12) 0%, rgba(205,127,50,0.05) 28%, rgba(255,255,255,0.02) 70%)",
    }
  }
  return { background: fallback }
}

function renderDistaccoCell(
  value: string,
  exporting = false,
  forceDoppiatoPill = false
) {
  const t = (value || "").trim()
  const u = t.toUpperCase()

  if (forceDoppiatoPill) {
    return <Pill left="DOPPIATO" variant="orange" exporting={exporting} />
  }

  if (!t || t === "-") return "-"

  if (u === "DNF") return <Pill left="DNF" variant="teal" exporting={exporting} />
  if (u === "BOX") return <Pill left="BOX" variant="fuchsia" exporting={exporting} />
  if (u === "DOPPIATO") return <Pill left="DOPPIATO" variant="orange" exporting={exporting} />
  if (/^\d+giro$/i.test(t)) return <Pill left="DOPPIATO" variant="orange" exporting={exporting} />

  return t
}
function renderDGCell(
  kind: DGKind | undefined,
  seconds: number | undefined,
  exporting = false
) {
  if (!kind || kind === "-") return "-"

  if (kind === "DSQ") {
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          padding: exporting ? "4px 8px" : "3px 7px",
          borderRadius: 999,
          background: "rgba(255,0,128,0.18)",
          border: "1px solid rgba(255,0,128,0.36)",
          color: "#ffd6ef",
          fontWeight: 900,
          fontSize: exporting ? 12 : 11,
          whiteSpace: "nowrap",
          lineHeight: 1,
          height: exporting ? 22 : 20,
        }}
      >
        DSQ
      </span>
    )
  }

  const timeColor = kind === "P" ? "#ff3b3b" : "#ff2bd6"
  const pillBg = kind === "P" ? "rgba(255,59,59,0.92)" : "rgba(255,43,214,0.92)"
  const pillBorder = kind === "P" ? "1px solid rgba(255,59,59,0.55)" : "1px solid rgba(255,43,214,0.55)"
  const pillShadow = kind === "P" ? "0 0 14px rgba(255,59,59,0.18)" : "0 0 14px rgba(255,43,214,0.18)"

  const safe = Math.max(0, Math.round(seconds || 0))
  const minutes = Math.floor(safe / 60)
  const secs = safe % 60
  const formatted = `+${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.000`

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "baseline",
        justifyContent: "center",
        gap: exporting ? 8 : 7,
        whiteSpace: "nowrap",
        lineHeight: 1,
      }}
    >
      <span
        style={{
          color: timeColor,
          fontWeight: 900,
          fontSize: exporting ? 17 : 16,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          letterSpacing: 0.1,
          textShadow:
            kind === "P"
              ? "0 0 10px rgba(255,59,59,0.20)"
              : "0 0 10px rgba(255,43,214,0.18)",
        }}
      >
        {formatted}
      </span>

      <span
        style={{
          color: "rgba(255,255,255,0.92)",
          fontWeight: 800,
          fontSize: exporting ? 13 : 12,
          lineHeight: 1,
          display: "inline-block",
          transform: "translateY(-1px)",
        }}
      >
        |
      </span>

      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          minWidth: exporting ? 24 : 20,
          height: exporting ? 20 : 18,
          padding: exporting ? "0 8px" : "0 7px",
          borderRadius: 999,
          background: pillBg,
          border: pillBorder,
          boxShadow: pillShadow,
          color: "rgba(0,0,0,0.92)",
          fontWeight: 900,
          fontSize: exporting ? 12 : 11,
          lineHeight: 1,
          textTransform: "uppercase",
          transform: "translateY(-1px)",
        }}
      >
        {kind}
      </span>
    </span>
  )
}

function LegendBare() {
  return (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
      <span style={{ fontSize: 12, opacity: 0.85, fontWeight: 900, letterSpacing: 0.4, textTransform: "uppercase" }}>
        Legenda
      </span>
      <Pill left="PP" variant="gold" />
      <Pill left="GV" variant="violet" />
      <Pill left="DOPPIATO" variant="orange" />
      <Pill left="DNF" variant="teal" />
      <Pill left="BOX" variant="fuchsia" />
    </div>
  )
}

function AppHeader({
  mainTitle = "Albixximo Union Tools",
  sideLabel = "Union CSV Extractor",
  subtitle = "PRT Timing Assistant",
}: {
  mainTitle?: string
  sideLabel?: string
  subtitle?: string
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        flexWrap: "wrap",
        marginBottom: 10,
        padding: 12,
        borderRadius: 22,
        border: "1px solid rgba(255,255,255,0.10)",
        background: "linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.03))",
        boxShadow: "0 14px 60px rgba(0,0,0,0.45)",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          background:
            "radial-gradient(900px 220px at 10% 10%, rgba(255,215,0,0.18), transparent 60%)," +
            "radial-gradient(700px 220px at 90% 0%, rgba(160,90,255,0.18), transparent 55%)",
          opacity: 0.9,
        }}
      />

      <div style={{ position: "relative", minWidth: 0, flex: 1 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "nowrap",
            whiteSpace: "nowrap",
            minWidth: 0,
          }}
        >
          <div
            style={{
              fontSize: 34,
              fontWeight: 900,
              letterSpacing: 0.4,
              textTransform: "uppercase",
              lineHeight: 1.05,
              textShadow: "0 0 18px rgba(255,215,0,0.22)",
              whiteSpace: "nowrap",
              flexShrink: 1,
              minWidth: 0,
            }}
          >
            {mainTitle}
          </div>

          <span
            style={{
              fontSize: 14,
              padding: "6px 10px",
              borderRadius: 999,
              border: "1px solid rgba(255,255,255,0.14)",
              background: "rgba(255,255,255,0.06)",
              opacity: 0.95,
              letterSpacing: 0.6,
              textTransform: "uppercase",
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            {sideLabel}
          </span>
        </div>

        <div style={{ marginTop: 5, fontSize: 13, opacity: 0.9, whiteSpace: "nowrap" }}>{subtitle}</div>

        <div
          style={{
            marginTop: 8,
            height: 7,
            borderRadius: 999,
            background:
              "linear-gradient(90deg, rgba(255,215,0,0.0) 0%, rgba(255,215,0,0.35) 18%, rgba(255,255,255,0.14) 50%, rgba(160,90,255,0.30) 82%, rgba(160,90,255,0.0) 100%)",
            boxShadow: "0 0 18px rgba(255,215,0,0.14)",
            opacity: 0.9,
          }}
        />
      </div>

      <a
        href="/union_logo.png"
        target="_blank"
        rel="noreferrer"
        title="Union Logo"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          textDecoration: "none",
          flexShrink: 0,
        }}
      >
        <img
          src="/union_logo.png"
          alt="Union"
          style={{
            height: 110,
            width: "auto",
            opacity: 0.98,
            filter:
              "drop-shadow(0 0 18px rgba(255,215,0,0.55)) drop-shadow(0 0 40px rgba(255,215,0,0.25))",
          }}
        />
      </a>
    </div>
  )
}

function SummaryStrip({
  winnerPilot,
  ppPilot,
  gvPilot,
  unionMeta,
  exporting = false,
}: {
  winnerPilot: string
  ppPilot: string
  gvPilot: string
  unionMeta: UnionMeta
  exporting?: boolean
}) {
  return (
    <div
      style={{
        padding: "16px 18px",
        borderRadius: 20,
        border: "1px solid rgba(255,255,255,0.12)",
        background: "rgba(255,255,255,0.05)",
        boxShadow: "0 10px 40px rgba(0,0,0,0.35)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
          <HeaderBadge label="WINNER" value={winnerPilot} variant="silver" exporting={exporting} />
          <HeaderBadge label="PP" value={ppPilot} variant="gold" exporting={exporting} />
          <HeaderBadge label="GV" value={gvPilot} variant="violet" exporting={exporting} />
          <HeaderBadge label="GARA" value={unionMeta.gara} variant="gold" exporting={exporting} />
          <HeaderBadge label="LOBBY" value={unionMeta.lobby} variant="violet" exporting={exporting} />
          <HeaderBadge label="LEGA" value={unionMeta.lega} variant="gold" exporting={exporting} />
        </div>
      </div>
    </div>
  )
}

function ResultsTable({
  previewRows,
  exporting = false,
  tableTitle = "Classifica Union (output)",
  roundFinalMode = false,
}: {
  previewRows: DGRowComputed[]
  exporting?: boolean
  tableTitle?: string
  roundFinalMode?: boolean
}) {
  return (
    <div
      style={{
        borderRadius: 16,
        border: "1px solid rgba(255,255,255,0.10)",
        background: "rgba(0,0,0,0.22)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: exporting ? "11px 14px" : "12px 14px",
          borderBottom: "1px solid rgba(255,255,255,0.10)",
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ fontWeight: 900, fontSize: exporting ? 15 : undefined }}>
          {tableTitle}
        </div>
        <div
          style={{
            fontSize: exporting ? 13 : 12,
            opacity: 0.88,
            fontWeight: exporting ? 800 : undefined,
          }}
        >
          {exporting ? `Partecipanti: ${previewRows.length}` : `${previewRows.length} righe`}
        </div>
      </div>

      <div style={{ minWidth: 0 }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            tableLayout: "fixed",
          }}
        >
          <thead
            style={{
              position: exporting ? "static" : "sticky",
              top: 0,
              zIndex: 2,
              background: "rgba(10,12,18,0.92)",
              backdropFilter: exporting ? undefined : "blur(10px)",
            }}
          >
            <tr>
              <th
                style={{
                  padding: exporting ? "11px 13px" : "12px 12px",
                  textAlign: "left",
                  fontSize: exporting ? 16 : 12,
                  opacity: 0.8,
                  width: 60,
                }}
              >
                #
              </th>
              <th
                style={{
                  padding: exporting ? "11px 13px" : "12px 12px",
                  textAlign: "left",
                  fontSize: exporting ? 16 : 12,
                  opacity: 0.8,
                  width: exporting ? 220 : 190,
                }}
              >
                Nome pilota
              </th>
              <th
                style={{
                  padding: exporting ? "11px 13px" : "12px 12px",
                  textAlign: "left",
                  fontSize: exporting ? 16 : 12,
                  opacity: 0.8,
                  width: exporting ? 270 : 240,
                }}
              >
                Auto
              </th>
              <th
                style={{
                  padding: exporting ? "11px 13px" : "12px 12px",
                  textAlign: "right",
                  fontSize: exporting ? 16 : 12,
                  opacity: 0.8,
                  width: exporting ? 170 : 145,
                }}
              >
                Distacchi
              </th>
              <th
                style={{
                  padding: exporting ? "11px 13px" : "12px 12px",
                  textAlign: "center",
                  fontSize: exporting ? 16 : 12,
                  opacity: 0.8,
                  width: exporting ? 90 : 76,
                }}
              >
                PP
              </th>
              <th
                style={{
                  padding: exporting ? "11px 13px" : "12px 12px",
                  textAlign: "center",
                  fontSize: exporting ? 16 : 12,
                  opacity: 0.8,
                  width: exporting ? 90 : 76,
                }}
              >
                GV
              </th>
              <th
                style={{
                  padding: exporting ? "11px 13px" : "12px 12px",
                  textAlign: "center",
                  fontSize: exporting ? 16 : 12,
                  opacity: 0.8,
                  width: exporting ? 170 : 150,
                }}
              >
                DG
              </th>
              <th
                style={{
                  padding: exporting ? "11px 13px" : "12px 12px",
                  textAlign: "center",
                  fontSize: exporting ? 16 : 12,
                  opacity: 0.8,
                  width: exporting ? 90 : 74,
                }}
              >
                {exporting && roundFinalMode ? "ROUND" : "Gara"}
              </th>
              <th
                style={{
                  padding: exporting ? "11px 13px" : "12px 12px",
                  textAlign: "center",
                  fontSize: exporting ? 16 : 12,
                  opacity: 0.8,
                  width: exporting ? 90 : 74,
                }}
              >
                Lobby
              </th>
              <th
                style={{
                  padding: exporting ? "11px 13px" : "12px 12px",
                  textAlign: "center",
                  fontSize: exporting ? 16 : 12,
                  opacity: 0.8,
                  width: exporting ? 140 : 115,
                }}
              >
                Lega
              </th>
              <th
                style={{
                  padding: exporting ? "11px 13px" : "12px 12px",
                  textAlign: "center",
                  fontSize: exporting ? 16 : 12,
                  opacity: 0.8,
                  width: exporting ? 150 : 70,
                }}
              >
                {exporting && roundFinalMode ? "SUPERFINALS" : "Punti"}
              </th>
            </tr>
          </thead>

          <tbody>
            {previewRows.map((r, i) => {
              const isPp = (r.pp || "").trim().toUpperCase() === "PP"
              const isGv = (r.gv || "").trim().toUpperCase() === "GV"
              const fallbackBg = i % 2 === 0 ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.10)"

              const rawDistacco = String(r.distacchi || "").trim().toUpperCase()

              const isBoxOrDsq =
                rawDistacco === "BOX" || rawDistacco === "DSQ"

              const isDnf =
                rawDistacco === "DNF"

              const isZeroPointsStatus = isBoxOrDsq || isDnf

              const bonusPoints =
                (isPp ? 1 : 0) +
                (isGv ? 1 : 0)

              const pointsValue = isBoxOrDsq
                ? 0
                : isDnf
                  ? bonusPoints
                  : getPointsForRow(r)

              const isP1 = r.posizione === 1
              const isP2 = r.posizione === 2
              const isP3 = r.posizione === 3
              const isPodium = isP1 || isP2 || isP3

              const podiumBg = isP1
                ? "linear-gradient(180deg, rgba(255,215,0,1), rgba(255,200,0,0.95))"
                : isP2
                  ? "linear-gradient(180deg, rgba(220,220,220,0.96), rgba(185,185,185,0.96))"
                  : "linear-gradient(180deg, rgba(205,127,50,0.96), rgba(168,102,38,0.96))"

              const podiumBorder = isP1
                ? "1px solid rgba(255,215,0,0.55)"
                : isP2
                  ? "1px solid rgba(220,220,220,0.42)"
                  : "1px solid rgba(205,127,50,0.45)"

              const podiumGlow = isP1
                ? "0 0 18px rgba(255,215,0,0.35)"
                : isP2
                  ? "0 0 14px rgba(220,220,220,0.22)"
                  : "0 0 14px rgba(205,127,50,0.22)"

              const normalPointsColor = exporting ? "#ffffff" : "#ecfff5"

              return (
                <tr
                  key={`${r.posizione}-${r.nomePilota}-${i}`}
                  style={rowStyleForPos(r.posizione, fallbackBg)}
                >
                  <TableCell exporting={exporting}>
                    <PosBadge pos={r.posizione} />
                  </TableCell>

                  <TableCell
                    exporting={exporting}
                    style={{
                      fontSize: exporting ? 18 : undefined,
                      fontWeight: exporting ? (r.posizione === 1 ? 800 : 700) : undefined,
                      letterSpacing: exporting ? "0.04em" : undefined,
                      color: exporting ? (r.posizione === 1 ? "#fff6cc" : "#ffffff") : undefined,
                      textShadow: exporting
                        ? r.posizione === 1
                          ? "0 0 10px rgba(255,215,0,0.45)"
                          : "none"
                        : undefined,
                    }}
                  >
                    {String(r.nomePilota || "").trim() ? (
                      r.nomePilota
                    ) : (
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          padding: exporting ? "10px 14px" : "8px 12px",
                          borderRadius: 12,
                          background: "rgba(239,68,68,0.18)",
                          border: "1px solid rgba(239,68,68,0.42)",
                          boxShadow: "0 0 14px rgba(239,68,68,0.14)",
                          color: "#fee2e2",
                          fontWeight: 900,
                          fontSize: exporting ? 13 : 11,
                          letterSpacing: 0.5,
                          textTransform: "uppercase",
                          whiteSpace: "nowrap",
                        }}
                      >
                        Inserire Pilota
                      </span>
                    )}
                  </TableCell>

                  <TableCell
                    exporting={exporting}
                    dim={!r.auto}
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      fontSize: exporting ? 17 : undefined,
                    }}
                  >
                    {r.auto || "-"}
                  </TableCell>

                  <TableCell
                    exporting={exporting}
                    align="right"
                    mono
                    style={{
                      whiteSpace: "nowrap",
                      fontSize: exporting ? 17 : undefined,
                    }}
                  >
                    {renderDistaccoCell(r.distacchi, exporting, exporting && !!r.originalWasLapped)}
                  </TableCell>

                  <TableCell exporting={exporting} align="center" mono dim={!isPp}>
                    {isPp ? <Pill left="PP" variant="gold" exporting={exporting} /> : "-"}
                  </TableCell>

                  <TableCell exporting={exporting} align="center" mono dim={!isGv}>
                    {isGv ? <Pill left="GV" variant="violet" exporting={exporting} /> : "-"}
                  </TableCell>

                  <TableCell
                    exporting={exporting}
                    align="center"
                    mono
                    dim={!r.dgKind || r.dgKind === "-"}
                    style={{
                      whiteSpace: "nowrap",
                      fontSize: exporting ? 12 : 11,
                      lineHeight: 1,
                    }}
                  >
                    {renderDGCell(r.dgKind, r.dgSeconds, exporting)}
                  </TableCell>

                  <TableCell
                    exporting={exporting}
                    align="center"
                    mono
                    dim={!r.gara}
                    style={{
                      borderBottom: "1px solid rgba(255,255,255,0.08)",
                    }}
                  >
                    {exporting && roundFinalMode ? (
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          minWidth: exporting ? 42 : 34,
                          height: exporting ? 28 : 24,
                          padding: exporting ? "0 12px" : "0 8px",
                          borderRadius: 999,
                          background: "rgba(255,215,0,0.16)",
                          border: "1px solid rgba(255,215,0,0.32)",
                          boxShadow: "0 0 10px rgba(255,215,0,0.12)",
                          color: "#fff8dc",
                          fontWeight: 900,
                          lineHeight: 1,
                        }}
                      >
                        R1
                      </span>
                    ) : String(r.gara).trim() === "-" ? (
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          minWidth: exporting ? 34 : 28,
                          height: exporting ? 28 : 24,
                          padding: exporting ? "0 10px" : "0 8px",
                          borderRadius: 999,
                          background: "rgba(255,165,0,0.16)",
                          border: "1px solid rgba(255,165,0,0.32)",
                          boxShadow: "0 0 10px rgba(255,165,0,0.12)",
                          color: "#fff3e0",
                          fontWeight: 900,
                          lineHeight: 1,
                        }}
                      >
                        -
                      </span>
                    ) : (
                      r.gara || "-"
                    )}
                  </TableCell>
                                    <TableCell exporting={exporting} align="center" mono dim={!r.lobby}>
                    {r.lobby || "-"}
                  </TableCell>

                  <TableCell
                    exporting={exporting}
                    align="center"
                    mono
                    dim={!r.lega}
                    style={{
                      whiteSpace: "nowrap",
                      fontSize: exporting ? 15 : 12,
                    }}
                  >
                    {r.lega || "-"}
                  </TableCell>

                  <TableCell
                    exporting={exporting}
                    align="center"
                    mono
                    style={{
                      whiteSpace: "nowrap",
                      fontSize: exporting ? 16 : 13,
                      fontWeight: 900,
                    }}
                  >
                    {exporting && roundFinalMode ? (
                      r.posizione <= 7 ? (
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            padding: exporting ? "8px 14px" : "6px 12px",
                            borderRadius: 999,
                            background: "rgba(34,197,94,0.20)",
                            border: "1px solid rgba(34,197,94,0.42)",
                            boxShadow: "0 0 16px rgba(34,197,94,0.16)",
                            color: "#dcfce7",
                            fontWeight: 900,
                            fontSize: exporting ? 13 : 11,
                            letterSpacing: 0.4,
                            textTransform: "none",
                          }}
                          title="Qualificato alle Superfinals"
                        >
                          Qualificato
                        </span>
                      ) : (
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            minWidth: 28,
                            opacity: 0.7,
                          }}
                        >
                          -
                        </span>
                      )
                    ) : isPodium ? (
                      <span
                        style={{
                          position: "relative",
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          minWidth: exporting ? 30 : 26,
                          height: exporting ? 20 : 18,
                          padding: exporting ? "0 8px" : "0 7px",
                          borderRadius: 999,
                          background: podiumBg,
                          border: podiumBorder,
                          boxShadow: podiumGlow,
                          color: "rgba(0,0,0,0.95)",
                          fontWeight: 900,
                          fontSize: exporting ? 12 : 11,
                          lineHeight: 1,
                          transform: "translateY(-1px)",
                        }}
                        title={
                          isZeroPointsStatus
                            ? "Punti gara: 0"
                            : isPp && isGv
                              ? "Bonus: PP + GV"
                              : isPp
                                ? "Bonus: PP"
                                : isGv
                                  ? "Bonus: GV"
                                  : "Punti gara"
                        }
                      >
                        <span>{pointsValue}</span>

                        {(isPp || isGv) && (
                          <span
                            style={{
                              position: "absolute",
                              top: exporting ? -6 : -5,
                              right:
                                isPp && isGv
                                  ? (exporting ? -14 : -12)
                                  : (exporting ? -9 : -7),
                              display: "flex",
                              gap: 1,
                              fontSize: exporting ? 10 : 9,
                              lineHeight: 1,
                            }}
                          >
                            {isPp && (
                              <span
                                style={{
                                  color: "#ffd700",
                                  textShadow: "0 0 6px rgba(255,215,0,0.45)",
                                }}
                              >
                                ★
                              </span>
                            )}

                            {isGv && (
                              <span
                                style={{
                                  color: "#b67cff",
                                  textShadow: "0 0 6px rgba(160,90,255,0.45)",
                                }}
                              >
                                ★
                              </span>
                            )}
                          </span>
                        )}
                      </span>
                    ) : (
                      <span
                        title={
                          isZeroPointsStatus
                            ? "Punti gara: 0"
                            : isPp && isGv
                              ? "Bonus: PP + GV"
                              : isPp
                                ? "Bonus: PP"
                                : isGv
                                  ? "Bonus: GV"
                                  : "Punti gara"
                        }
                        style={{
                          position: "relative",
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          minWidth: exporting ? 34 : 30,
                          height: exporting ? 20 : 18,
                          padding: exporting ? "0 8px" : "0 7px",
                          borderRadius: 999,
                          border: "1px solid rgba(255,255,255,0.22)",
                          background: "transparent",
                          boxShadow: "none",
                          color: normalPointsColor,
                          fontWeight: 900,
                          fontSize: exporting ? 16 : 14,
                          fontFamily:
                            "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                          letterSpacing: 0.1,
                          textShadow: exporting
                            ? "0 0 8px rgba(255,255,255,0.10)"
                            : "0 0 8px rgba(64,224,208,0.12)",
                        }}
                      >
                        <span>{pointsValue}</span>

                        {(isPp || isGv) && (
                          <span
                            style={{
                              position: "absolute",
                              top: exporting ? -6 : -5,
                              right:
                                isPp && isGv
                                  ? (exporting ? -14 : -12)
                                  : (exporting ? -9 : -7),
                              display: "flex",
                              gap: 1,
                              fontSize: exporting ? 10 : 9,
                              lineHeight: 1,
                            }}
                          >
                            {isPp && (
                              <span
                                style={{
                                  color: "#ffd700",
                                  textShadow: "0 0 6px rgba(255,215,0,0.45)",
                                }}
                              >
                                ★
                              </span>
                            )}

                            {isGv && (
                              <span
                                style={{
                                  color: "#b67cff",
                                  textShadow: "0 0 6px rgba(160,90,255,0.45)",
                                }}
                              >
                                ★
                              </span>
                            )}
                          </span>
                        )}
                      </span>
                    )}
                  </TableCell>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function SplashScreen() {
  return (
    <div
      style={{
        position: "relative",
        minHeight: "100vh",
        padding: 24,
        color: "white",
        fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial",
        background:
          "radial-gradient(1200px 600px at 15% 10%, rgba(255,215,0,0.14), transparent 50%)," +
          "radial-gradient(900px 500px at 85% 20%, rgba(160,90,255,0.16), transparent 50%)," +
          "linear-gradient(180deg, #0b0d12 0%, #07080c 100%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          background:
            "radial-gradient(circle at center, rgba(40,80,255,0.18) 0%, rgba(160,90,255,0.14) 30%, rgba(255,215,0,0.08) 55%, transparent 75%)",
          filter: "blur(30px)",
        }}
      />

      <div
        style={{
          display: "grid",
          placeItems: "center",
          gap: 20,
          animation: "unionSplashFade 5s ease forwards",
          zIndex: 1,
        }}
      >
        <div
          style={{
            position: "relative",
            width: 260,
            height: 260,
            display: "grid",
            placeItems: "center",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: "50%",
              background:
                "radial-gradient(circle, rgba(255,215,0,0.24) 0%, rgba(160,90,255,0.18) 38%, transparent 72%)",
              filter: "blur(18px)",
              animation: "unionSplashGlow 2.4s ease-in-out infinite",
            }}
          />

          <img
            src="/union_logo.png"
            alt="Union"
            style={{
              width: 220,
              height: "auto",
              animation: "unionSplashSpin 5s linear forwards",
              filter:
                "drop-shadow(0 0 10px rgba(255,215,0,0.28)) drop-shadow(0 0 24px rgba(160,90,255,0.22))",
            }}
          />
        </div>

        <div
          style={{
            fontSize: 16,
            fontWeight: 800,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: "rgba(255,255,255,0.86)",
          }}
        >
          Union Race Timing
        </div>
      </div>
    </div>
  )
}

export default function Page() {
  const [files, setFiles] = useState<File[]>([])
  const [csv, setCsv] = useState("")
  const [rows, setRows] = useState<UnionRow[]>([])
  const [unionMeta, setUnionMeta] = useState<UnionMeta>({ gara: "", lobby: "", lega: "" })
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState("")
  const [warning, setWarning] = useState("")
  const [showTable, setShowTable] = useState(true)
  const [showReq, setShowReq] = useState(false)

  const [authorized, setAuthorized] = useState(false)
  const [authChecked, setAuthChecked] = useState(false)
  const [showSplash, setShowSplash] = useState(true)
  const [inputPassword, setInputPassword] = useState("")
  const [loginError, setLoginError] = useState("")
  const [pulse, setPulse] = useState(0)

  const [showExportModal, setShowExportModal] = useState(false)
  const [exportTexts, setExportTexts] = useState<ExportTexts>(DEFAULT_EXPORT_TEXTS)
  const [exportTextsDraft, setExportTextsDraft] = useState<ExportTexts>(DEFAULT_EXPORT_TEXTS)
  const [workspaceKey, setWorkspaceKey] = useState(0)
  const [isRoundFinal, setIsRoundFinal] = useState(false)

  const [detectedPoleDriver, setDetectedPoleDriver] = useState("")
  const [detectedBestLapDriver, setDetectedBestLapDriver] = useState("")
  const [detectedRaceOrder, setDetectedRaceOrder] = useState<string[]>([])
  const [manualGaraOverride, setManualGaraOverride] = useState("")

  const [showAutoModal, setShowAutoModal] = useState(false)
  const [manualAutoOverrides, setManualAutoOverrides] = useState<Record<number, string>>({})
  const [manualAutoDraft, setManualAutoDraft] = useState<Record<number, string>>({})

  const [showPilotModal, setShowPilotModal] = useState(false)
  const [manualPilotOverrides, setManualPilotOverrides] = useState<Record<number, string>>({})
  const [manualPilotDraft, setManualPilotDraft] = useState<Record<number, string>>({})

  const [showDistaccoModal, setShowDistaccoModal] = useState(false)
  const [manualDistaccoOverrides, setManualDistaccoOverrides] = useState<Record<number, string>>({})
  const [manualDistaccoDraft, setManualDistaccoDraft] = useState<Record<number, string>>({})

  const [dgKinds, setDgKinds] = useState<Record<string, DGKind>>({})
  const [dgSeconds, setDgSeconds] = useState<Record<string, string>>({})
  const [dgLapOverrides, setDgLapOverrides] = useState<Record<string, string>>({})

  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const exportRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const savedAuth = sessionStorage.getItem(AUTH_STORAGE_KEY)
    if (savedAuth === "true") {
      setAuthorized(true)
    }

    const savedExportTexts = sessionStorage.getItem(EXPORT_TEXTS_STORAGE_KEY)
    if (savedExportTexts) {
      try {
        const parsed = JSON.parse(savedExportTexts)
        const nextTexts: ExportTexts = {
          mainTitle: parsed?.mainTitle || DEFAULT_EXPORT_TEXTS.mainTitle,
          sideLabel: parsed?.sideLabel || DEFAULT_EXPORT_TEXTS.sideLabel,
          subtitle: parsed?.subtitle || DEFAULT_EXPORT_TEXTS.subtitle,
        }
        setExportTexts(nextTexts)
        setExportTextsDraft(nextTexts)
      } catch {
        setExportTexts(DEFAULT_EXPORT_TEXTS)
        setExportTextsDraft(DEFAULT_EXPORT_TEXTS)
      }
    }

    setAuthChecked(true)

    const splashTimer = setTimeout(() => {
      setShowSplash(false)
    }, 5000)

    return () => clearTimeout(splashTimer)
  }, [])

  useEffect(() => {
    if (authorized) {
      sessionStorage.setItem(EXPORT_TEXTS_STORAGE_KEY, JSON.stringify(exportTexts))
    }
  }, [exportTexts, authorized])

  useEffect(() => {
    const id = setInterval(() => {
      setPulse((p) => (p === 0 ? 1 : 0))
    }, 2200)

    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const style = document.createElement("style")
    style.innerHTML = `
      @keyframes unionLoadSlide {
        0% { left: -35%; }
        50% { left: 100%; }
        100% { left: -35%; }
      }

      @keyframes unionLoadShine {
        0% { left: -20%; }
        50% { left: 100%; }
        100% { left: -20%; }
      }

      @keyframes unionSplashSpin {
        0% { transform: rotate(0deg) scale(0.92); }
        50% { transform: rotate(180deg) scale(1); }
        100% { transform: rotate(360deg) scale(0.92); }
      }

      @keyframes unionSplashGlow {
        0% { opacity: 0.75; transform: scale(0.96); }
        50% { opacity: 1; transform: scale(1.05); }
        100% { opacity: 0.75; transform: scale(0.96); }
      }

      @keyframes unionSplashFade {
        0% { opacity: 0; }
        12% { opacity: 1; }
        88% { opacity: 1; }
        100% { opacity: 0; }
      }

      @keyframes unionGlowMove {
        0% { transform: translateX(-100%); }
        100% { transform: translateX(100%); }
      }
    `
    document.head.appendChild(style)

    return () => {
      document.head.removeChild(style)
    }
  }, [])

  const canRun = useMemo(() => files.length > 0, [files])

  const ppPilot = useMemo(() => {
    const row = rows.find((r) => (r.pp || "").trim().toUpperCase() === "PP")
    return row?.nomePilota || ""
  }, [rows])

  const gvPilot = useMemo(() => {
    const row = rows.find((r) => (r.gv || "").trim().toUpperCase() === "GV")
    return row?.nomePilota || ""
  }, [rows])

  const detectedGaraDisplay = useMemo(() => {
    const rawMetaGara = String(unionMeta.gara || "").trim()
    const allRowsAre18 =
      rows.length > 0 && rows.every((r) => String(r.gara || "").trim() === "18")

    if (rawMetaGara === "18" && allRowsAre18) {
      return "-"
    }

    return rawMetaGara || "-"
  }, [unionMeta.gara, rows])

  const effectiveGara = useMemo(() => {
    return String(manualGaraOverride || detectedGaraDisplay || "").trim()
  }, [manualGaraOverride, detectedGaraDisplay])

  const displayRows = useMemo<DisplayRow[]>(() => {
    return rows.map((r) => ({
      ...r,
      sourcePosizione: r.posizione,
      nomePilota: (manualPilotOverrides[r.posizione] ?? r.nomePilota ?? "").trim(),
      auto: (manualAutoOverrides[r.posizione] ?? r.auto ?? "").trim(),
      distacchi: (manualDistaccoOverrides[r.posizione] ?? r.distacchi ?? "").trim(),
      gara: effectiveGara,
    }))
  }, [rows, manualPilotOverrides, manualAutoOverrides, manualDistaccoOverrides, effectiveGara])

  const winnerPilot = useMemo(() => {
    const row = displayRows.find((r) => r.posizione === 1) || displayRows[0]
    return row?.nomePilota || ""
  }, [displayRows])

  const matchSummary = useMemo(() => {
    return buildUnionMatchSummary({
      rows: displayRows,
      unionMeta: { ...unionMeta, gara: effectiveGara },
      detectedPoleDriver,
      detectedBestLapDriver,
      detectedRaceOrder,
    })
  }, [displayRows, unionMeta, effectiveGara, detectedPoleDriver, detectedBestLapDriver, detectedRaceOrder])

  const hasManualAutoOverrides = useMemo(() => {
    return Object.keys(manualAutoOverrides).length > 0
  }, [manualAutoOverrides])

  const hasManualPilotOverrides = useMemo(() => {
    return Object.keys(manualPilotOverrides).length > 0
  }, [manualPilotOverrides])

  const hasManualDistaccoOverrides = useMemo(() => {
    return Object.keys(manualDistaccoOverrides).length > 0
  }, [manualDistaccoOverrides])

  const shouldSyncDgTableWithManualEdits = useMemo(() => {
    return hasManualPilotOverrides || hasManualDistaccoOverrides
  }, [hasManualPilotOverrides, hasManualDistaccoOverrides])

  const finalRows = useMemo<DGRowComputed[]>(() => {
    if (displayRows.length === 0) return []

    const useEditedOrderingForDg = shouldSyncDgTableWithManualEdits

    const detectedLeaderRow =
      displayRows.find((r) => parseLeaderRaceTimeMs(r.distacchi) != null) ||
      displayRows.find((r) => r.posizione === 1) ||
      displayRows[0]

    const detectedLeaderMs = parseLeaderRaceTimeMs(detectedLeaderRow?.distacchi || "")

    const ordered = useEditedOrderingForDg
      ? [...displayRows].sort((a, b) => {
          const aMs = getComparableRaceMsForOrdering(a, detectedLeaderMs)
          const bMs = getComparableRaceMsForOrdering(b, detectedLeaderMs)

          if (aMs != null && bMs != null) {
            if (aMs !== bMs) return aMs - bMs
            return a.posizione - b.posizione
          }

          if (aMs != null && bMs == null) return -1
          if (aMs == null && bMs != null) return 1

          return a.posizione - b.posizione
        })
      : [...displayRows].sort((a, b) => a.posizione - b.posizione)

    const leaderRow =
      ordered.find((r) => parseLeaderRaceTimeMs(r.distacchi) != null) || ordered[0]
    const leaderMs = parseLeaderRaceTimeMs(leaderRow?.distacchi || "")

    const comparable: Array<{
      originalIndex: number
      row: DisplayRow
      totalMs: number
      dgKind: DGKind
      dgSeconds: number
    }> = []

    const nonComparable: Array<{
      originalIndex: number
      row: DisplayRow
      dgKind: DGKind
      dgSeconds: number
    }> = []

    const dsqRows: Array<{
      originalIndex: number
      row: DisplayRow
      dgKind: DGKind
    }> = []

    const resolvedBaseMsByIndex = new Map<number, number>()

    for (let i = 0; i < ordered.length; i++) {
      const row = ordered[i]
      const key = getRowStableKey(row.posizione)
      const dgKind = dgKinds[key] || "-"
      const dgSec = Number(dgSeconds[key] || 0)
      const rawDistacco = String(row.distacchi || "").trim()
      const isDoppiato = isDoppiatoValue(rawDistacco)

      if (dgKind === "DSQ") {
        dsqRows.push({
          originalIndex: i,
          row,
          dgKind,
        })
        continue
      }

      let baseMs: number | null = null

      if (i === 0) {
        baseMs = parseLeaderRaceTimeMs(rawDistacco)
      } else if (isDoppiato) {
        const manualGap = String(dgLapOverrides[key] || "").trim()
        const manualGapMs = parseManualGapMs(manualGap)
        const prevIndex = i - 1

        if (
          manualGapMs != null &&
          prevIndex >= 0 &&
          resolvedBaseMsByIndex.has(prevIndex)
        ) {
          const prevMs = resolvedBaseMsByIndex.get(prevIndex)!
          baseMs = prevMs + manualGapMs
        }
      } else if (!isNonComparableUnionValue(rawDistacco) && leaderMs != null) {
        const directAbsolute = parseLeaderRaceTimeMs(rawDistacco)
        if (directAbsolute != null) {
          baseMs = directAbsolute
        } else {
          const gapMs = parseGapToLeaderMs(rawDistacco)
          if (gapMs != null) {
            baseMs = leaderMs + gapMs
          }
        }
      }

      if (baseMs != null) {
        resolvedBaseMsByIndex.set(i, baseMs)
        comparable.push({
          originalIndex: i,
          row,
          totalMs: baseMs + dgSec * 1000,
          dgKind,
          dgSeconds: dgSec,
        })
      } else {
        nonComparable.push({
          originalIndex: i,
          row,
          dgKind,
          dgSeconds: dgSec,
        })
      }
    }

    comparable.sort((a, b) => {
      if (a.totalMs !== b.totalMs) return a.totalMs - b.totalMs
      return a.originalIndex - b.originalIndex
    })

    const newLeaderMs = comparable[0]?.totalMs ?? null

    const comparableRows: DGRowComputed[] = comparable.map((item, idx) => {
      const isLeader = idx === 0
      const updatedDistacco =
        newLeaderMs == null
          ? item.row.distacchi
          : isLeader
            ? formatRaceTimeFromMs(item.totalMs)
            : formatGapFromLeaderMs(item.totalMs - newLeaderMs)

      return {
        ...item.row,
        posizione: idx + 1,
        distacchi: updatedDistacco,
        dgKind: item.dgKind,
        dgSeconds: item.dgKind === "-" ? 0 : item.dgSeconds,
        dgLabel:
          item.dgKind === "P" || item.dgKind === "S"
            ? formatDGLabel(item.dgSeconds, item.dgKind)
            : item.dgKind === "DSQ"
              ? "DSQ"
              : "",
        computedRaceMs: item.totalMs,
        computedNonComparable: false,
        computedDsq: false,
        originalWasLapped: isDoppiatoValue(item.row.distacchi),
      }
    })

    const nonComparableRows: DGRowComputed[] = nonComparable
      .sort((a, b) => a.originalIndex - b.originalIndex)
      .map((item, idx) => ({
        ...item.row,
        posizione: comparableRows.length + idx + 1,
        dgKind: item.dgKind,
        dgSeconds: item.dgKind === "-" ? 0 : item.dgSeconds,
        dgLabel:
          item.dgKind === "P" || item.dgKind === "S"
            ? formatDGLabel(item.dgSeconds, item.dgKind)
            : item.dgKind === "DSQ"
              ? "DSQ"
              : "",
        computedRaceMs: null,
        computedNonComparable: true,
        computedDsq: false,
        originalWasLapped: isDoppiatoValue(item.row.distacchi),
      }))

    const dsqComputedRows: DGRowComputed[] = dsqRows
      .sort((a, b) => a.originalIndex - b.originalIndex)
      .map((item, idx) => ({
        ...item.row,
        posizione: comparableRows.length + nonComparableRows.length + idx + 1,
        distacchi: "DSQ",
        dgKind: "DSQ",
        dgSeconds: 0,
        dgLabel: "DSQ",
        computedRaceMs: null,
        computedNonComparable: false,
        computedDsq: true,
        originalWasLapped: isDoppiatoValue(item.row.distacchi),
      }))

    return [...comparableRows, ...nonComparableRows, ...dsqComputedRows]
  }, [displayRows, dgKinds, dgSeconds, dgLapOverrides])

  const dgTableRows = useMemo<(DisplayRow | DGRowComputed)[]>(() => {
    if (!shouldSyncDgTableWithManualEdits) {
      return displayRows
    }

    return finalRows
  }, [shouldSyncDgTableWithManualEdits, displayRows, finalRows])
  
  const finalCsv = useMemo(() => {
    if (!finalRows.length) return ""

    const header = "#,Nome pilota,Auto,Distacchi,-PP-,-GV-,Gara,Lobby,Lega"

    let dnfCount = 0
    let boxCount = 0
    let previousGapMs = 0

    const body = finalRows.map((r, index) => {
      const rawDistacco = String(r.distacchi || "").trim().toUpperCase()
      let csvDistacco = String(r.distacchi || "").trim()

      if (index === 0) {
        previousGapMs = 0
      } else if (rawDistacco.startsWith("+")) {
        const parsedGap = parseGapToLeaderMs(rawDistacco)
        if (parsedGap != null) {
          previousGapMs = parsedGap
        }
        csvDistacco = String(r.distacchi || "").trim()
      } else if (isDoppiatoValue(rawDistacco)) {
        previousGapMs += 10000
        csvDistacco = formatGapFromLeaderMs(previousGapMs)
      } else if (rawDistacco === "DNF") {
        csvDistacco = formatRaceTimeFromMs(3600000 + dnfCount * 60000)
        dnfCount++
      } else if (rawDistacco === "BOX") {
        csvDistacco = formatRaceTimeFromMs(7200000 + boxCount * 60000)
        boxCount++
      } else if (rawDistacco === "DSQ") {
        csvDistacco = "DSQ"
      } else {
        csvDistacco = String(r.distacchi || "").trim()
      }

      return [
        r.posizione,
        r.nomePilota,
        r.auto,
        csvDistacco,
        r.pp,
        r.gv,
        r.gara,
        r.lobby,
        r.lega,
      ]
        .map((value) => {
          const s = String(value ?? "").replace(/"/g, '""')
          return s.includes(",") ? `"${s}"` : s
        })
        .join(",")
    })

    return [header, ...body].join("\n")
  }, [finalRows])

  function openPilotCorrectionModal() {
  const nextDraft: Record<number, string> = {}
  for (const row of displayRows) {
    nextDraft[row.posizione] = String(row.nomePilota ?? "").trim()
  }
  setManualPilotDraft(nextDraft)
  setShowPilotModal(true)
}

  function applyPilotCorrections() {
  const cleaned: Record<number, string> = {}

  for (const row of rows) {
    const hasDraft = Object.prototype.hasOwnProperty.call(manualPilotDraft, row.posizione)
    const draftValue = String(manualPilotDraft[row.posizione] ?? "").trim()
    const originalValue = String(row.nomePilota ?? "").trim()

    if (!hasDraft) continue

    if (draftValue !== originalValue) {
      cleaned[row.posizione] = draftValue
    }
  }

  const nextAutoOverrides: Record<number, string> = {}

  for (const row of rows) {
    const finalPilotName = String(cleaned[row.posizione] ?? row.nomePilota ?? "").trim()
    const originalAuto = String(row.auto ?? "").trim()

    if (!finalPilotName) {
      if (originalAuto) {
        nextAutoOverrides[row.posizione] = ""
      }
      continue
    }

    const sourceRow = rows.find((candidate) =>
      sameDriverForMatch(candidate.nomePilota, finalPilotName)
    )

    if (!sourceRow) {
      continue
    }

    const sourceAuto = String(sourceRow.auto ?? "").trim()

    if (sourceAuto !== originalAuto) {
      nextAutoOverrides[row.posizione] = sourceAuto
    }
  }

  setManualPilotOverrides(cleaned)
  setManualAutoOverrides(nextAutoOverrides)
  setShowPilotModal(false)
}

  function resetPilotCorrections() {
    setManualPilotOverrides({})
    setManualPilotDraft({})
    setShowPilotModal(false)
  }

  function openAutoCorrectionModal() {
    const nextDraft: Record<number, string> = {}
    for (const row of rows) {
      nextDraft[row.posizione] = (manualAutoOverrides[row.posizione] ?? row.auto ?? "").trim()
    }
    setManualAutoDraft(nextDraft)
    setShowAutoModal(true)
  }

  function applyAutoCorrections() {
    const cleaned: Record<number, string> = {}
    for (const row of rows) {
      const draftValue = String(manualAutoDraft[row.posizione] ?? "").trim()
      const originalValue = String(row.auto ?? "").trim()
      if (draftValue && draftValue !== originalValue) {
        cleaned[row.posizione] = draftValue
      }
    }
    setManualAutoOverrides(cleaned)
    setShowAutoModal(false)
  }

  function resetAutoCorrections() {
    setManualAutoOverrides({})
    setManualAutoDraft({})
    setShowAutoModal(false)
  }

  function openDistaccoCorrectionModal() {
    const nextDraft: Record<number, string> = {}
    for (const row of displayRows) {
      nextDraft[row.posizione] = String(row.distacchi ?? "").trim()
    }
    setManualDistaccoDraft(nextDraft)
    setShowDistaccoModal(true)
  }

  function applyDistaccoCorrections() {
    const cleaned: Record<number, string> = {}
    for (const row of rows) {
      const draftValue = String(manualDistaccoDraft[row.posizione] ?? "").trim()
      const originalValue = String(row.distacchi ?? "").trim()
      if (draftValue && draftValue !== originalValue) {
        cleaned[row.posizione] = draftValue
      }
    }
    setManualDistaccoOverrides(cleaned)
    setShowDistaccoModal(false)
  }

  function resetDistaccoCorrections() {
    setManualDistaccoOverrides({})
    setManualDistaccoDraft({})
    setShowDistaccoModal(false)
  }

  function resetAllManualCorrections() {
    setManualPilotOverrides({})
    setManualPilotDraft({})
    setShowPilotModal(false)

    setManualAutoOverrides({})
    setManualAutoDraft({})
    setShowAutoModal(false)

    setManualDistaccoOverrides({})
    setManualDistaccoDraft({})
    setShowDistaccoModal(false)
  }

  function handleLogin() {
    if (inputPassword === APP_PASSWORD) {
      setAuthorized(true)
      sessionStorage.setItem(AUTH_STORAGE_KEY, "true")
      setLoginError("")
      return
    }

    setLoginError("Password errata")
  }

  function handleLogout() {
    sessionStorage.removeItem(AUTH_STORAGE_KEY)
    sessionStorage.removeItem(EXPORT_TEXTS_STORAGE_KEY)

    setAuthorized(false)
    setFiles([])
    setCsv("")
    setRows([])
    setUnionMeta({ gara: "", lobby: "", lega: "" })
    setDetectedPoleDriver("")
    setDetectedBestLapDriver("")
    setDetectedRaceOrder([])
    setManualGaraOverride("")

    setManualPilotOverrides({})
    setManualPilotDraft({})
    setShowPilotModal(false)

    setManualAutoOverrides({})
    setManualAutoDraft({})
    setShowAutoModal(false)

    setManualDistaccoOverrides({})
    setManualDistaccoDraft({})
    setShowDistaccoModal(false)

    setDgKinds({})
    setDgSeconds({})
    setDgLapOverrides({})
    setLoading(false)
    setExporting(false)
    setError("")
    setWarning("")
    setShowTable(true)
    setShowReq(false)
    setShowExportModal(false)
    setIsRoundFinal(false)
    setInputPassword("")
    setLoginError("")
    setExportTexts(DEFAULT_EXPORT_TEXTS)
    setExportTextsDraft(DEFAULT_EXPORT_TEXTS)

    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }

    setWorkspaceKey((k) => k + 1)
  }
  async function performExportTablePng() {
    if (!exportRef.current || finalRows.length === 0) return

    try {
      setExporting(true)
      await new Promise((resolve) => setTimeout(resolve, 140))

      const dataUrl = await toPng(exportRef.current, {
        cacheBust: true,
        pixelRatio: 2,
        width: 1920,
        height: 1080,
        canvasWidth: 1920,
        canvasHeight: 1080,
        backgroundColor: "#07080c",
        style: {
          transform: "scale(1)",
          transformOrigin: "top left",
        },
      })

      const link = document.createElement("a")
      link.download = `${formatLobbyShort(unionMeta.lobby).replace(/[^\w-]/g, "_")}.png`
      link.href = dataUrl
      link.click()
    } catch (e: any) {
      setError(`Errore esportazione PNG: ${String(e?.message || e)}`)
    } finally {
      setExporting(false)
    }
  }

  function openExportModal() {
    setExportTextsDraft(exportTexts)
    setShowExportModal(true)
  }

  async function confirmExportPng() {
    const nextTexts = {
      mainTitle: (exportTextsDraft.mainTitle || DEFAULT_EXPORT_TEXTS.mainTitle).trim(),
      sideLabel: (exportTextsDraft.sideLabel || DEFAULT_EXPORT_TEXTS.sideLabel).trim(),
      subtitle: (exportTextsDraft.subtitle || DEFAULT_EXPORT_TEXTS.subtitle).trim(),
    }

    setExportTexts(nextTexts)
    setShowExportModal(false)
    await new Promise((resolve) => setTimeout(resolve, 80))
    await performExportTablePng()
  }

  async function run() {
    setLoading(true)
    setError("")
    setWarning("")
    setCsv("")
    setRows([])
    setUnionMeta({ gara: "", lobby: "", lega: "" })
    setDetectedPoleDriver("")
    setDetectedBestLapDriver("")
    setDetectedRaceOrder([])
    setManualGaraOverride("")

    setManualPilotOverrides({})
    setManualPilotDraft({})
    setShowPilotModal(false)

    setManualAutoOverrides({})
    setManualAutoDraft({})
    setShowAutoModal(false)

    setManualDistaccoOverrides({})
    setManualDistaccoDraft({})
    setShowDistaccoModal(false)

    setDgKinds({})
    setDgSeconds({})
    setDgLapOverrides({})

    try {
      const fd = new FormData()
      for (const f of files) fd.append("files", f)

      const res = await fetch("/api/albixximo", { method: "POST", body: fd })
      const data = await res.json()

      if (!res.ok) {
        setError(JSON.stringify(data, null, 2))
      } else {
        setCsv(data.csv || "")
        setRows(Array.isArray(data.unionRows) ? data.unionRows : [])
        setDetectedPoleDriver(data.detectedPoleDriver || "")
        setDetectedBestLapDriver(data.detectedBestLapDriver || "")
        setDetectedRaceOrder(Array.isArray(data.detectedRaceOrder) ? data.detectedRaceOrder : [])
        setUnionMeta(
          data.unionMeta && typeof data.unionMeta === "object"
            ? {
                gara: data.unionMeta.gara || "",
                lobby: data.unionMeta.lobby || "",
                lega: data.unionMeta.lega || "",
              }
            : { gara: "", lobby: "", lega: "" }
        )
        setWarning(data.warning || "")
      }
    } catch (e: any) {
      setError(String(e?.message || e))
    } finally {
      setLoading(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ""
      }
    }
  }

  function resetAll() {
    window.location.reload()
  }

  if (!authChecked || showSplash) {
    return <SplashScreen />
  }

  if (!authorized) {
    return (
      <div
        style={{
          position: "relative",
          minHeight: "100vh",
          padding: 24,
          color: "white",
          fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial",
          background:
            "radial-gradient(1200px 600px at 15% 10%, rgba(255,215,0,0.14), transparent 50%)," +
            "radial-gradient(900px 500px at 85% 20%, rgba(160,90,255,0.16), transparent 50%)," +
            "linear-gradient(180deg, #0b0d12 0%, #07080c 100%)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            background:
              "radial-gradient(circle at center, rgba(40,80,255,0.18) 0%, rgba(160,90,255,0.14) 30%, rgba(255,215,0,0.08) 55%, transparent 75%)",
            filter: "blur(30px)",
          }}
        />

        <div
          style={{
            width: "100%",
            maxWidth: 680,
            borderRadius: 28,
            padding: "34px 28px",
            background: "rgba(14, 18, 32, 0.88)",
            border: "1px solid rgba(163, 95, 255, 0.34)",
            boxShadow:
              "0 0 60px rgba(120,70,255,0.20), 0 0 140px rgba(255,215,0,0.08)",
            backdropFilter: "blur(14px)",
            position: "relative",
            zIndex: 1,
          }}
        >
          <div style={{ textAlign: "center", marginBottom: 34 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                marginBottom: 18,
              }}
            >
              <img
                src="/union_logo.png"
                alt="Union"
                style={{
                  width: 360,
                  maxWidth: "82%",
                  height: "auto",
                  transition: "transform 1.8s ease, filter 1.8s ease",
                  transform: pulse ? "scale(1.01)" : "scale(1)",
                  filter: pulse
                    ? "drop-shadow(0 0 6px rgba(255,215,0,0.22)) drop-shadow(0 0 14px rgba(255,215,0,0.12)) drop-shadow(0 0 18px rgba(160,90,255,0.12))"
                    : "drop-shadow(0 0 2px rgba(255,215,0,0.10)) drop-shadow(0 0 8px rgba(160,90,255,0.10))",
                }}
              />
            </div>

            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "6px 14px",
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 800,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "rgba(255,215,0,0.96)",
                background: "rgba(255,215,0,0.10)",
                border: "1px solid rgba(255,215,0,0.22)",
                marginBottom: 18,
              }}
            >
              Accesso riservato
            </div>

            <h1
              style={{
                margin: 0,
                fontSize: 44,
                fontWeight: 900,
                letterSpacing: "-0.04em",
                textTransform: "uppercase",
                textShadow: "0 0 22px rgba(255,215,0,0.18)",
                lineHeight: 1.02,
              }}
            >
              UNION RACE TIMING
            </h1>

            <p
              style={{
                margin: "18px 0 0 0",
                fontSize: 16,
                color: "rgba(255,255,255,0.75)",
              }}
            >
              Inserisci password per accedere
            </p>
          </div>

          <div style={{ display: "grid", gap: 16 }}>
            <input
              type="password"
              value={inputPassword}
              onChange={(e) => setInputPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleLogin()
              }}
              placeholder="Inserisci password"
              autoFocus
              style={{
                width: "100%",
                height: 64,
                borderRadius: 16,
                border: "1px solid rgba(255,215,0,0.28)",
                background: "rgba(255,255,255,0.04)",
                color: "#ffffff",
                padding: "0 20px",
                fontSize: 17,
                outline: "none",
                boxSizing: "border-box",
              }}
            />

            {loginError && (
              <div
                style={{
                  fontSize: 13,
                  color: "#ff9c9c",
                  background: "rgba(255,80,80,0.08)",
                  border: "1px solid rgba(255,80,80,0.22)",
                  borderRadius: 12,
                  padding: "10px 12px",
                }}
              >
                {loginError}
              </div>
            )}

            <button
              onClick={handleLogin}
              disabled={!inputPassword.trim()}
              style={{
                width: "100%",
                height: 64,
                borderRadius: 16,
                border: "1px solid rgba(255,215,0,0.35)",
                background: !inputPassword.trim()
                  ? "rgba(255,255,255,0.08)"
                  : "linear-gradient(135deg, rgba(255,215,0,0.96), rgba(255,190,40,0.94))",
                color: "#111522",
                fontSize: 17,
                fontWeight: 900,
                cursor: !inputPassword.trim() ? "not-allowed" : "pointer",
                boxShadow: "0 12px 30px rgba(255,215,0,0.18)",
                textTransform: "uppercase",
                letterSpacing: 0.6,
              }}
            >
              Accedi
            </button>
          </div>

          <div
            style={{
              marginTop: 22,
              textAlign: "center",
              fontSize: 10,
              color: "rgba(255,255,255,0.45)",
              letterSpacing: 0.3,
            }}
          >
            Albixximo Time Assistant
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      key={workspaceKey}
      style={{
        position: "relative",
        minHeight: "100vh",
        padding: 24,
        color: "white",
        fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial",
        background:
          "radial-gradient(1200px 600px at 15% 10%, rgba(255,215,0,0.14), transparent 50%)," +
          "radial-gradient(900px 500px at 85% 20%, rgba(160,90,255,0.16), transparent 50%)," +
          "linear-gradient(180deg, #0b0d12 0%, #07080c 100%)",
      }}
    >
      <div style={{ maxWidth: 1320, margin: "0 auto" }}>
        <AppHeader />

        <div
          style={{
            marginTop: 14,
            borderRadius: 20,
            border: "1px solid rgba(255,255,255,0.12)",
            background: "rgba(255,255,255,0.05)",
            boxShadow: "0 10px 40px rgba(0,0,0,0.35)",
            overflow: "hidden",
          }}
        >
          <div style={{ padding: 18, borderBottom: "1px solid rgba(255,255,255,0.10)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
                <HeaderBadge label="WINNER" value={winnerPilot} variant="silver" />
                <HeaderBadge label="PP" value={ppPilot} variant="gold" />
                <HeaderBadge label="GV" value={gvPilot} variant="violet" />
                <HeaderBadge label="GARA" value={effectiveGara} variant="gold" />
                <HeaderBadge label="LOBBY" value={unionMeta.lobby} variant="violet" />
                <HeaderBadge label="LEGA" value={unionMeta.lega} variant="gold" />
              </div>

              <button
                onClick={() => setShowReq((v) => !v)}
                style={{
                  padding: "10px 12px",
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.14)",
                  background: "rgba(0,0,0,0.18)",
                  color: "white",
                  cursor: "pointer",
                  fontWeight: 900,
                  letterSpacing: 0.4,
                  textTransform: "uppercase",
                  fontSize: 12,
                }}
                title="Mostra/Nascondi requisiti"
              >
                {showReq ? "Nascondi requisiti" : "Requisiti"}
              </button>
            </div>

            {showReq && (
              <div style={{ marginTop: 10, fontSize: 13, opacity: 0.82, lineHeight: 1.45 }}>
                <div>
                  Minimo richiesto: <b>Qualifica 1–8</b> e <b>Gara 1–8</b>. Gli screen <b>9–N</b> sono opzionali.
                </div>
                <div style={{ marginTop: 8, opacity: 0.85 }}>
                  Il CSV scaricato è già in formato <b>Union</b> con 9 colonne:
                  <b> #, Nome pilota, Auto, Distacchi, PP, GV, Gara, Lobby, Lega</b>.
                </div>
              </div>
            )}
          </div>

          <div style={{ padding: 18, display: "grid", gap: 16 }}>
            <div
              style={{
                borderRadius: 16,
                border: "1px solid rgba(255,255,255,0.10)",
                background: "rgba(0,0,0,0.18)",
                padding: 14,
                display: "grid",
                gap: 12,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <div style={{ fontWeight: 900, opacity: 0.95 }}>Caricamento immagini</div>

                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12, opacity: 0.9 }}>
                    <input
                      type="checkbox"
                      checked={showTable}
                      onChange={(e) => setShowTable(e.target.checked)}
                      style={{ transform: "scale(1.1)" }}
                    />
                    Mostra anteprima Union
                  </label>
                </div>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => setFiles(Array.from(e.target.files || []))}
                style={{ display: "none" }}
              />

              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    padding: "12px 16px",
                    borderRadius: 14,
                    border: "1px solid rgba(255,215,0,0.35)",
                    background: "linear-gradient(180deg, rgba(255,215,0,0.18), rgba(0,0,0,0.10))",
                    color: "white",
                    fontWeight: 900,
                    letterSpacing: 0.6,
                    textTransform: "uppercase",
                    cursor: "pointer",
                    boxShadow: "0 0 24px rgba(255,215,0,0.12)",
                  }}
                >
                  Sfoglia file
                </button>

                <div style={{ fontSize: 12, opacity: 0.8 }}>
                  Carica 2–4 immagini (Qualifica + Gara). Ordine consigliato: Quali 1–8, Quali 9–N, Gara 1–8, Gara 9–N
                  <span style={{ opacity: 0 }}>.</span>
                </div>
              </div>

              {files.length > 0 && (
                <div style={{ fontSize: 12, opacity: 0.88 }}>
                  <b>{files.length}</b> file selezionati
                  <div style={{ marginTop: 6, display: "grid", gap: 2 }}>
                    {files.slice(0, 8).map((f) => (
                      <div key={f.name} style={{ opacity: 0.86 }}>
                        • {f.name}
                      </div>
                    ))}
                    {files.length > 8 && <div style={{ opacity: 0.75 }}>• ... +{files.length - 8}</div>}
                  </div>
                </div>
              )}
            </div>

            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <button
                onClick={run}
                disabled={loading || !canRun}
                style={{
                  padding: "12px 16px",
                  borderRadius: 14,
                  border: "1px solid rgba(255,255,255,0.18)",
                  background: loading || !canRun ? "rgba(255,255,255,0.08)" : "rgba(255,215,0,0.18)",
                  color: "white",
                  fontWeight: 900,
                  letterSpacing: 0.6,
                  cursor: loading || !canRun ? "not-allowed" : "pointer",
                  boxShadow: loading || !canRun ? "none" : "0 0 22px rgba(255,215,0,0.12)",
                  textTransform: "uppercase",
                }}
              >
                {loading ? "Elaborazione..." : "Genera Tabella e CSV Union"}
              </button>

              <button
                onClick={resetAll}
                style={{
                  padding: "12px 14px",
                  borderRadius: 14,
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "rgba(255,255,255,0.06)",
                  color: "white",
                  cursor: "pointer",
                  opacity: 0.9,
                  textTransform: "uppercase",
                  fontWeight: 900,
                  letterSpacing: 0.4,
                  fontSize: 12,
                }}
              >
                Reset
              </button>

              <button
                onClick={handleLogout}
                style={{
                  padding: "12px 14px",
                  borderRadius: 14,
                  border: "1px solid rgba(255,80,80,0.35)",
                  background: "rgba(255,80,80,0.18)",
                  color: "white",
                  cursor: "pointer",
                  textTransform: "uppercase",
                  fontWeight: 900,
                  letterSpacing: 0.4,
                  fontSize: 12,
                  boxShadow: "0 0 18px rgba(255,80,80,0.12)",
                }}
              >
                Logout
              </button>

              {!canRun && <div style={{ fontSize: 12, opacity: 0.75 }}>Seleziona almeno 2 immagini (Quali + Gara).</div>}
            </div>

            {loading && (
              <div
                style={{
                  width: "100%",
                  marginTop: -6,
                  paddingLeft: 6,
                  display: "grid",
                  gap: 10,
                }}
              >
                <div
                  style={{
                    position: "relative",
                    height: 12,
                    maxWidth: 420,
                    borderRadius: 999,
                    background: "rgba(255,255,255,0.06)",
                    overflow: "hidden",
                    border: "1px solid rgba(255,255,255,0.10)",
                    boxShadow: "inset 0 0 14px rgba(0,0,0,0.25)",
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      borderRadius: 999,
                      background:
                        "linear-gradient(90deg, rgba(255,215,0,0.08), rgba(220,220,220,0.06), rgba(160,90,255,0.08))",
                    }}
                  />

                  <div
                    style={{
                      position: "absolute",
                      top: 0,
                      bottom: 0,
                      left: "-35%",
                      width: "35%",
                      borderRadius: 999,
                      background:
                        "linear-gradient(90deg, rgba(255,215,0,0.95), rgba(220,220,220,0.95), rgba(160,90,255,0.95))",
                      boxShadow:
                        "0 0 18px rgba(255,215,0,0.25), 0 0 22px rgba(160,90,255,0.18)",
                      animation: "unionLoadSlide 2.8s ease-in-out infinite",
                    }}
                  />

                  <div
                    style={{
                      position: "absolute",
                      top: 0,
                      bottom: 0,
                      left: "-20%",
                      width: "20%",
                      borderRadius: 999,
                      background:
                        "linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255,0.42), rgba(255,255,255,0))",
                      filter: "blur(2px)",
                      animation: "unionLoadShine 2.8s ease-in-out infinite",
                    }}
                  />
                </div>

                <div style={{ fontSize: 12, opacity: 0.75 }}>
                  Elaborazione immagini e generazione CSV...
                </div>
              </div>
            )}

            {finalRows.length > 0 && (
              <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <button
                  onClick={openExportModal}
                  disabled={exporting}
                  style={{
                    padding: "12px 16px",
                    borderRadius: 14,
                    border: "1px solid rgba(255,255,255,0.16)",
                    background: exporting ? "rgba(255,255,255,0.08)" : "rgba(160,90,255,0.18)",
                    color: "white",
                    fontWeight: 900,
                    letterSpacing: 0.6,
                    cursor: exporting ? "not-allowed" : "pointer",
                    boxShadow: exporting ? "none" : "0 0 22px rgba(160,90,255,0.12)",
                    textTransform: "uppercase",
                  }}
                >
                  {exporting ? "Esportazione PNG..." : "Esporta PNG tabella"}
                </button>

                <label
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "10px 12px",
                    borderRadius: 14,
                    border: "1px solid rgba(255,215,0,0.22)",
                    background: isRoundFinal ? "rgba(255,215,0,0.14)" : "rgba(255,255,255,0.06)",
                    color: "white",
                    cursor: "pointer",
                    fontWeight: 900,
                    letterSpacing: 0.4,
                    textTransform: "uppercase",
                    fontSize: 12,
                    boxShadow: isRoundFinal ? "0 0 18px rgba(255,215,0,0.10)" : "none",
                    userSelect: "none",
                  }}
                  title="Attiva layout speciale PNG per le finali di round"
                >
                  <input
                    type="checkbox"
                    checked={isRoundFinal}
                    onChange={(e) => setIsRoundFinal(e.target.checked)}
                    style={{ transform: "scale(1.1)" }}
                  />
                  Finali di Round
                </label>
              </div>
            )}
                        {warning && (
              <div
                style={{
                  whiteSpace: "pre-wrap",
                  color: "#ffd166",
                  background: "rgba(0,0,0,0.35)",
                  border: "1px solid rgba(255,255,255,0.10)",
                  padding: 12,
                  borderRadius: 14,
                }}
              >
                ⚠️ Controlla gli screen caricati: alcuni dati potrebbero non essere corretti.
              </div>
            )}

            {displayRows.length > 0 && matchSummary.fields.gara === "warn" && (
              <div
                style={{
                  borderRadius: 14,
                  border: "1px solid rgba(255,215,0,0.28)",
                  background: "rgba(255,215,0,0.08)",
                  padding: 12,
                  display: "flex",
                  gap: 12,
                  flexWrap: "wrap",
                  alignItems: "center",
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 800 }}>
                  Numero gara sospetto o mancante. Inseriscilo manualmente:
                </div>

                <input
                  type="text"
                  inputMode="numeric"
                  value={manualGaraOverride}
                  onChange={(e) => setManualGaraOverride(e.target.value.replace(/[^\d]/g, ""))}
                  placeholder="Es. 5"
                  style={{
                    width: 90,
                    padding: "10px 12px",
                    borderRadius: 10,
                    border: "1px solid rgba(255,255,255,0.16)",
                    background: "rgba(0,0,0,0.22)",
                    color: "white",
                    fontWeight: 800,
                  }}
                />

                {manualGaraOverride.trim() && (
                  <button
                    onClick={() => setManualGaraOverride("")}
                    style={{
                      padding: "10px 12px",
                      borderRadius: 10,
                      border: "1px solid rgba(255,255,255,0.14)",
                      background: "rgba(255,255,255,0.06)",
                      color: "white",
                      cursor: "pointer",
                      fontWeight: 800,
                      textTransform: "uppercase",
                      fontSize: 12,
                    }}
                  >
                    Rimuovi override
                  </button>
                )}
              </div>
            )}

            {displayRows.length > 0 && (
  <div
    style={{
      borderRadius: 14,
      border:
        matchSummary.fields.auto === "warn"
          ? "1px solid rgba(255,215,0,0.28)"
          : "1px solid rgba(255,255,255,0.10)",
      background:
        matchSummary.fields.auto === "warn"
          ? "rgba(255,215,0,0.08)"
          : "rgba(255,255,255,0.05)",
      padding: 12,
      display: "flex",
      gap: 12,
      flexWrap: "wrap",
      alignItems: "center",
    }}
  >
    <div style={{ fontSize: 13, fontWeight: 800 }}>
      {matchSummary.fields.auto === "warn"
        ? "Correzioni Manuali disponibili. Auto sospette rilevate."
        : "Correzioni Manuali"}
    </div>

    <button
      onClick={openPilotCorrectionModal}
      style={{
        padding: "10px 12px",
        borderRadius: 10,
        border: "1px solid rgba(255,255,255,0.16)",
        background: "rgba(255,255,255,0.08)",
        color: "white",
        cursor: "pointer",
        fontWeight: 800,
        textTransform: "uppercase",
        fontSize: 12,
      }}
    >
      Modifica Pilota
    </button>

    <button
      onClick={openAutoCorrectionModal}
      style={{
        padding: "10px 12px",
        borderRadius: 10,
        border: "1px solid rgba(255,255,255,0.16)",
        background:
          matchSummary.fields.auto === "warn"
            ? "rgba(160,90,255,0.18)"
            : "rgba(255,255,255,0.08)",
        color: "white",
        cursor: "pointer",
        fontWeight: 800,
        textTransform: "uppercase",
        fontSize: 12,
        boxShadow:
          matchSummary.fields.auto === "warn"
            ? "0 0 20px rgba(160,90,255,0.10)"
            : "none",
      }}
    >
      Modifica Auto
    </button>

    <button
      onClick={openDistaccoCorrectionModal}
      style={{
        padding: "10px 12px",
        borderRadius: 10,
        border: "1px solid rgba(255,255,255,0.16)",
        background: "rgba(255,255,255,0.08)",
        color: "white",
        cursor: "pointer",
        fontWeight: 800,
        textTransform: "uppercase",
        fontSize: 12,
      }}
    >
      Modifica Distacco
    </button>

    <button
      onClick={resetAllManualCorrections}
      style={{
        padding: "10px 12px",
        borderRadius: 10,
        border: "1px solid rgba(239,68,68,0.35)",
        background: "rgba(239,68,68,0.14)",
        color: "white",
        cursor: "pointer",
        fontWeight: 800,
        textTransform: "uppercase",
        fontSize: 12,
      }}
    >
      Rimuovi modifiche
    </button>
  </div>
)}

            {displayRows.length > 0 && (
              <div
                style={{
                  borderRadius: 16,
                  padding: 12,
                  ...overallBoxStyle(matchSummary.overallStatus),
                  boxShadow: "0 10px 30px rgba(0,0,0,0.22)",
                  display: "grid",
                  gap: 10,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{ fontSize: 18, fontWeight: 900, letterSpacing: 0.2 }}>
                    {matchSummary.overallStatus === "ok"
                      ? "✅ MATCH 100%"
                      : matchSummary.overallStatus === "warn"
                        ? "⚠️ DA CONTROLLARE"
                        : "❌ ERRORE REALE"}
                  </div>

                  <div style={{ fontSize: 14, fontWeight: 900 }}>
                    Match esatto al {matchSummary.percentage}%
                  </div>
                </div>

                <div
                  style={{
                    position: "relative",
                    display: "grid",
                    gridTemplateColumns: "repeat(9, minmax(0, 1fr))",
                    gap: 8,
                    padding: "8px 10px",
                    overflow: "hidden",
                    borderRadius: 14,
                    border: "1px solid rgba(255,255,255,0.10)",
                    background: "rgba(0,0,0,0.20)",
                    boxShadow: "0 0 24px rgba(255,215,0,0.06)",
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      borderRadius: 14,
                      background:
                        "linear-gradient(90deg, transparent, rgba(255,215,0,0.18), transparent)",
                      opacity: 0.35,
                      animation: "unionGlowMove 4s linear infinite",
                      pointerEvents: "none",
                    }}
                  />

                  {[
                    ["#", matchSummary.fields.posizione],
                    ["Nome pilota", matchSummary.fields.nomePilota],
                    ["Auto", matchSummary.fields.auto],
                    ["Distacchi", matchSummary.fields.distacchi],
                    ["-PP-", matchSummary.fields.pp],
                    ["-GV-", matchSummary.fields.gv],
                    ["Gara", matchSummary.fields.gara],
                    ["Lobby", matchSummary.fields.lobby],
                    ["Lega", matchSummary.fields.lega],
                  ].map(([label, status]) => (
                    <div
                      key={String(label)}
                      style={{
                        position: "relative",
                        zIndex: 1,
                        borderRadius: 10,
                        padding: "8px 10px",
                        fontSize: 12,
                        fontWeight: 800,
                        letterSpacing: 0.3,
                        whiteSpace: "nowrap",
                        textAlign: "center",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        backdropFilter: "blur(6px)",
                        ...matchCellStyle(status as MatchFieldStatus),
                      }}
                    >
                      {label} {statusBadge(status as MatchFieldStatus)}
                    </div>
                  ))}
                </div>

                {matchSummary.notes.length > 0 && (
                  <div
                    style={{
                      fontSize: 11,
                      opacity: 0.9,
                      lineHeight: 1.4,
                    }}
                  >
                    <b>Note:</b>
                    <ul style={{ margin: "6px 0 0 18px", padding: 0 }}>
                      {matchSummary.notes.map((note, idx) => (
                        <li key={`${note}-${idx}`}>{note}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {showTable && finalRows.length > 0 && (
              <ResultsTable
                previewRows={finalRows}
                tableTitle={`Classifica definitiva Union - ${unionMeta.lega ? unionMeta.lega + " " : ""}Lobby ${formatLobbyShort(unionMeta.lobby)} Gara ${effectiveGara || "-"}`}
              />
            )}

            {displayRows.length > 0 && (
              <div
                style={{
                  borderRadius: 16,
                  border: "1px solid rgba(255,255,255,0.10)",
                  background: "rgba(0,0,0,0.18)",
                  padding: 14,
                  display: "grid",
                  gap: 12,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ fontWeight: 900, opacity: 0.96 }}>Direzione Gara</div>
                  <div style={{ fontSize: 12, opacity: 0.78 }}>
                    P e S modificano entrambi la classifica. DSQ manda il pilota in fondo.
                  </div>
                </div>

                <div
                  style={{
                    borderRadius: 12,
                    border: "1px solid rgba(255,255,255,0.08)",
                    overflow: "hidden",
                  }}
                >
                  <table
                    style={{
                      width: "100%",
                      borderCollapse: "collapse",
                      tableLayout: "fixed",
                    }}
                  >
                    <thead
                      style={{
                        background: "rgba(10,12,18,0.95)",
                      }}
                    >
                      <tr>
                        <th style={{ padding: "12px 12px", textAlign: "left", fontSize: 12, opacity: 0.82, width: "44%" }}>
                          Pilota
                        </th>
                        <th style={{ padding: "12px 12px", textAlign: "center", fontSize: 12, opacity: 0.82, width: "18%" }}>
                          Penalità
                        </th>
                        <th style={{ padding: "12px 12px", textAlign: "center", fontSize: 12, opacity: 0.82, width: "18%" }}>
                          Segnalazioni
                        </th>
                        <th style={{ padding: "12px 12px", textAlign: "center", fontSize: 12, opacity: 0.82, width: "20%" }}>
                          Gap finale doppiato
                        </th>
                        <th style={{ padding: "12px 12px", textAlign: "center", fontSize: 12, opacity: 0.82, width: "6%" }}>
                          X
                        </th>
                      </tr>
                    </thead>

                    <tbody>
                      {dgTableRows.map((row, idx) => {
                        const key = getRowStableKey(row.sourcePosizione ?? row.posizione)
                        const selectedKind = dgKinds[key] || "-"
                        const selectedSeconds = dgSeconds[key] || "-"
                        const isDoppiato = isDoppiatoValue(row.distacchi)
                        const manualGap = dgLapOverrides[key] || ""
                        const manualGapValid = manualGap.trim() === "" ? true : parseManualGapMs(manualGap) != null

                        return (
                          <tr
                            key={`dg-${row.sourcePosizione ?? row.posizione}-${row.nomePilota}-${idx}`}
                            style={{
                              background: idx % 2 === 0 ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.10)",
                            }}
                          >
                            <TableCell style={{ fontWeight: 700 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                                <PosBadge pos={row.posizione} />
                                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  {row.nomePilota}
                                </span>
                              </div>
                            </TableCell>

                            <TableCell align="center">
                              <div style={{ display: "inline-flex", gap: 8, alignItems: "center", justifyContent: "center" }}>
                                <select
                                  value={selectedKind === "P" || selectedKind === "DSQ" ? selectedKind : "-"}
                                  onChange={(e) => {
                                    const nextKind = e.target.value as DGKind
                                    setDgKinds((prev) => {
                                      const next = { ...prev }
                                      if (nextKind === "-") {
                                        if (next[key] === "P" || next[key] === "DSQ") delete next[key]
                                      } else {
                                        next[key] = nextKind
                                      }
                                      return next
                                    })
                                    if (nextKind === "DSQ") {
                                      setDgSeconds((prev) => ({ ...prev, [key]: "-" }))
                                    }
                                  }}
                                  style={{
                                    width: 74,
                                    padding: "8px 8px",
                                    borderRadius: 10,
                                    border: "1px solid rgba(255,255,255,0.14)",
                                    background: "rgba(0,0,0,0.26)",
                                    color: "white",
                                  }}
                                >
                                  <option value="-" style={{ background: "#11151d", color: "white" }}>-</option>
                                  <option value="P" style={{ background: "#11151d", color: "white" }}>P</option>
                                  <option value="DSQ" style={{ background: "#11151d", color: "white" }}>DSQ</option>
                                </select>

                                <select
                                  value={selectedKind === "P" ? selectedSeconds : "-"}
                                  disabled={selectedKind !== "P"}
                                  onChange={(e) =>
                                    setDgSeconds((prev) => ({
                                      ...prev,
                                      [key]: e.target.value,
                                    }))
                                  }
                                  style={{
                                    width: 84,
                                    padding: "8px 8px",
                                    borderRadius: 10,
                                    border: "1px solid rgba(255,255,255,0.14)",
                                    background: selectedKind !== "P" ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.26)",
                                    color: "white",
                                    opacity: selectedKind !== "P" ? 0.65 : 1,
                                  }}
                                >
                                  {DG_SECOND_OPTIONS.map((v) => (
                                    <option key={v} value={v} style={{ background: "#11151d", color: "white" }}>
                                      {v === "-" ? "-" : `${v}s`}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            </TableCell>

                            <TableCell align="center">
                              <div style={{ display: "inline-flex", gap: 8, alignItems: "center", justifyContent: "center" }}>
                                <select
                                  value={selectedKind === "S" ? "S" : "-"}
                                  onChange={(e) => {
                                    const nextKind = e.target.value as DGKind
                                    setDgKinds((prev) => {
                                      const next = { ...prev }
                                      if (nextKind === "-") {
                                        if (next[key] === "S") delete next[key]
                                      } else {
                                        next[key] = nextKind
                                      }
                                      return next
                                    })
                                    if (nextKind === "-") {
                                      setDgSeconds((prev) => {
                                        if (selectedKind === "S") {
                                          return { ...prev, [key]: "-" }
                                        }
                                        return prev
                                      })
                                    }
                                  }}
                                  style={{
                                    width: 74,
                                    padding: "8px 8px",
                                    borderRadius: 10,
                                    border: "1px solid rgba(255,255,255,0.14)",
                                    background: "rgba(0,0,0,0.26)",
                                    color: "white",
                                  }}
                                >
                                  <option value="-" style={{ background: "#11151d", color: "white" }}>-</option>
                                  <option value="S" style={{ background: "#11151d", color: "white" }}>S</option>
                                </select>

                                <select
                                  value={selectedKind === "S" ? selectedSeconds : "-"}
                                  disabled={selectedKind !== "S"}
                                  onChange={(e) =>
                                    setDgSeconds((prev) => ({
                                      ...prev,
                                      [key]: e.target.value,
                                    }))
                                  }
                                  style={{
                                    width: 84,
                                    padding: "8px 8px",
                                    borderRadius: 10,
                                    border: "1px solid rgba(255,255,255,0.14)",
                                    background: selectedKind !== "S" ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.26)",
                                    color: "white",
                                    opacity: selectedKind !== "S" ? 0.65 : 1,
                                  }}
                                >
                                  {DG_SECOND_OPTIONS.map((v) => (
                                    <option key={v} value={v} style={{ background: "#11151d", color: "white" }}>
                                      {v === "-" ? "-" : `${v}s`}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            </TableCell>

                            <TableCell align="center">
                              {isDoppiato ? (
                                <div style={{ display: "grid", gap: 6, justifyItems: "center" }}>
                                  <input
                                    value={manualGap}
                                    onChange={(e) =>
                                      setDgLapOverrides((prev) => ({
                                        ...prev,
                                        [key]: e.target.value,
                                      }))
                                    }
                                    placeholder="1:14.960"
                                    style={{
                                      width: 120,
                                      padding: "8px 10px",
                                      borderRadius: 10,
                                      border: "1px solid rgba(255,255,255,0.14)",
                                      background: "rgba(0,0,0,0.26)",
                                      color: "white",
                                      textAlign: "center",
                                      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                                    }}
                                  />
                                  <div
                                    style={{
                                      fontSize: 11,
                                      opacity: manualGapValid ? 0.65 : 1,
                                      color: manualGapValid ? "rgba(255,255,255,0.65)" : "#ff8a8a",
                                    }}
                                  >
                                    {manualGap.trim()
                                      ? manualGapValid
                                        ? "Gap valido"
                                        : "Usa m:ss.mmm"
                                      : "Inserisci gap finale"}
                                  </div>
                                </div>
                              ) : (
                                "-"
                              )}
                            </TableCell>

                            <TableCell align="center">
                              <button
                                onClick={() => {
                                  setDgKinds((prev) => {
                                    const next = { ...prev }
                                    delete next[key]
                                    return next
                                  })
                                  setDgSeconds((prev) => {
                                    const next = { ...prev }
                                    delete next[key]
                                    return next
                                  })
                                  setDgLapOverrides((prev) => {
                                    const next = { ...prev }
                                    delete next[key]
                                    return next
                                  })
                                }}
                                style={{
                                  width: 34,
                                  height: 34,
                                  borderRadius: 10,
                                  border: "1px solid rgba(255,255,255,0.14)",
                                  background: "rgba(255,255,255,0.06)",
                                  color: "white",
                                  cursor: "pointer",
                                  fontWeight: 900,
                                  fontSize: 16,
                                  lineHeight: 1,
                                }}
                                title="Reset DG"
                              >
                                ×
                              </button>
                            </TableCell>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {error && (
              <pre
                style={{
                  whiteSpace: "pre-wrap",
                  color: "#ff6b6b",
                  background: "rgba(0,0,0,0.35)",
                  border: "1px solid rgba(255,255,255,0.10)",
                  padding: 12,
                  borderRadius: 14,
                  overflowX: "auto",
                }}
              >
                {error}
              </pre>
            )}

            {finalCsv && (
              <div
                style={{
                  borderRadius: 16,
                  border: "1px solid rgba(255,255,255,0.10)",
                  background: "rgba(0,0,0,0.22)",
                  padding: 14,
                  display: "grid",
                  gap: 10,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ fontWeight: 900 }}>CSV Union Output</div>
                  <a
                    href={"data:text/csv;charset=utf-8," + encodeURIComponent(finalCsv)}
                    download={`${formatLobbyShort(unionMeta.lobby).replace(/[^\w-]/g, "_")}.csv`}
                    style={{
                      color: "white",
                      textDecoration: "none",
                      padding: "8px 12px",
                      borderRadius: 12,
                      border: "1px solid rgba(255,255,255,0.14)",
                      background: "rgba(255,255,255,0.06)",
                      fontSize: 13,
                    }}
                  >
                    Scarica CSV
                  </a>
                </div>

                <textarea
                  value={finalCsv}
                  readOnly
                  rows={14}
                  style={{
                    width: "100%",
                    borderRadius: 14,
                    border: "1px solid rgba(255,255,255,0.10)",
                    background: "rgba(0,0,0,0.35)",
                    color: "white",
                    padding: 12,
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                    fontSize: 12,
                  }}
                />
              </div>
            )}

            <div
              style={{
                borderRadius: 14,
                border: "1px solid rgba(255,255,255,0.10)",
                background: "rgba(0,0,0,0.18)",
                padding: "10px 12px",
              }}
            >
              <LegendBare />
            </div>
          </div>
        </div>
      </div>

      {showPilotModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.72)",
            backdropFilter: "blur(6px)",
            display: "grid",
            placeItems: "center",
            zIndex: 9999,
            padding: 20,
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 1100,
              borderRadius: 22,
              border: "1px solid rgba(255,255,255,0.12)",
              background: "linear-gradient(180deg, rgba(18,22,31,0.98), rgba(8,10,15,0.98))",
              boxShadow: "0 20px 80px rgba(0,0,0,0.55)",
              padding: 20,
              display: "grid",
              gap: 16,
            }}
          >
            <div>
              <div style={{ fontSize: 22, fontWeight: 900 }}>Correzione Pilota Manuale</div>
              <div style={{ marginTop: 6, fontSize: 13, opacity: 0.76 }}>
                Modifica manualmente il nome pilota. Le correzioni verranno applicate a tabella, DG, CSV e PNG.
              </div>
            </div>

            <div
              style={{
                borderRadius: 16,
                border: "1px solid rgba(255,255,255,0.10)",
                background: "rgba(0,0,0,0.22)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  maxHeight: "60vh",
                  overflowY: "auto",
                  overflowX: "hidden",
                }}
              >
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    tableLayout: "fixed",
                  }}
                >
                  <thead
                    style={{
                      position: "sticky",
                      top: 0,
                      zIndex: 2,
                      background: "rgba(10,12,18,0.96)",
                      backdropFilter: "blur(10px)",
                    }}
                  >
                    <tr>
                      <th style={{ padding: "12px", textAlign: "left", fontSize: 12, opacity: 0.8, width: 70 }}>#</th>
                      <th style={{ padding: "12px", textAlign: "left", fontSize: 12, opacity: 0.8, width: 320 }}>Pilota OCR</th>
                      <th style={{ padding: "12px", textAlign: "left", fontSize: 12, opacity: 0.8 }}>Pilota corretto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayRows.map((row) => {
                      const currentValue = String(manualPilotDraft[row.posizione] ?? "").trim()
                      const originalValue = String(row.nomePilota ?? "").trim()
                      const changed = currentValue !== originalValue

                      return (
                        <tr
                          key={`manual-pilot-${row.posizione}`}
                          style={{
                            background: changed
                              ? "linear-gradient(90deg, rgba(160,90,255,0.10), rgba(255,255,255,0.02))"
                              : "transparent",
                          }}
                        >
                          <td style={{ padding: "12px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                            <PosBadge pos={row.posizione} />
                          </td>

                          <td
                            style={{
                              padding: "12px",
                              borderBottom: "1px solid rgba(255,255,255,0.08)",
                              color: "rgba(255,255,255,0.86)",
                              fontWeight: 700,
                            }}
                          >
                            {row.nomePilota || "-"}
                          </td>

                          <td
  style={{
    padding: "12px",
    borderBottom: "1px solid rgba(255,255,255,0.08)",
  }}
>
  <div style={{ display: "grid", gap: 8 }}>
    <input
      value={manualPilotDraft[row.posizione] ?? ""}
      onChange={(e) =>
        setManualPilotDraft((prev) => ({
          ...prev,
          [row.posizione]: e.target.value,
        }))
      }
      style={{
        width: "100%",
        padding: "10px 12px",
        borderRadius: 10,
        border: changed
          ? "1px solid rgba(160,90,255,0.30)"
          : "1px solid rgba(255,255,255,0.14)",
        background: "rgba(0,0,0,0.24)",
        color: "white",
        boxSizing: "border-box",
      }}
    />

    <select
      defaultValue=""
      onChange={(e) => {
  const selected = e.target.value
  if (!selected) return

  const currentPos = row.posizione

  const otherRow = displayRows.find(
  (candidate) =>
    candidate.posizione !== currentPos &&
    String(candidate.nomePilota ?? "").trim() === selected
)

  if (!otherRow) {
    e.currentTarget.value = ""
    return
  }

  const otherPos = otherRow.posizione

  setManualPilotDraft((prev) => {
    const currentPilot = String(prev[currentPos] ?? row.nomePilota ?? "").trim()
    const otherPilot = String(prev[otherPos] ?? otherRow.nomePilota ?? "").trim()

    return {
      ...prev,
      [currentPos]: otherPilot,
      [otherPos]: currentPilot,
    }
  })

  e.currentTarget.value = ""
}}
      style={{
        width: "100%",
        padding: "10px 12px",
        borderRadius: 10,
        border: "1px solid rgba(255,255,255,0.14)",
        background: "rgba(0,0,0,0.24)",
        color: "white",
        boxSizing: "border-box",
      }}
    >
      <option value="" style={{ background: "#11151d", color: "white" }}>
        Sostituisci con...
      </option>

      {displayRows
  .filter((candidate) => candidate.posizione !== row.posizione)
  .map((candidate) => (
          <option
            key={`pilot-option-${row.posizione}-${candidate.posizione}`}
            value={candidate.nomePilota}
            style={{ background: "#11151d", color: "white" }}
          >
            {candidate.nomePilota}
          </option>
        ))}
    </select>
  </div>
</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, flexWrap: "wrap" }}>
              <button
                onClick={() => setShowPilotModal(false)}
                style={{
                  padding: "12px 16px",
                  borderRadius: 14,
                  border: "1px solid rgba(255,255,255,0.14)",
                  background: "rgba(255,255,255,0.06)",
                  color: "white",
                  cursor: "pointer",
                  fontWeight: 900,
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                }}
              >
                Chiudi
              </button>

              <button
                onClick={resetPilotCorrections}
                style={{
                  padding: "12px 16px",
                  borderRadius: 14,
                  border: "1px solid rgba(255,255,255,0.14)",
                  background: "rgba(255,255,255,0.06)",
                  color: "white",
                  cursor: "pointer",
                  fontWeight: 900,
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                }}
              >
                Reset
              </button>

              <button
                onClick={applyPilotCorrections}
                style={{
                  padding: "12px 16px",
                  borderRadius: 14,
                  border: "1px solid rgba(160,90,255,0.30)",
                  background: "rgba(160,90,255,0.20)",
                  color: "white",
                  cursor: "pointer",
                  fontWeight: 900,
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                  boxShadow: "0 0 22px rgba(160,90,255,0.12)",
                }}
              >
                Applica correzioni
              </button>
            </div>
          </div>
        </div>
      )}

      {showDistaccoModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.72)",
            backdropFilter: "blur(6px)",
            display: "grid",
            placeItems: "center",
            zIndex: 9999,
            padding: 20,
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 1100,
              borderRadius: 22,
              border: "1px solid rgba(255,255,255,0.12)",
              background: "linear-gradient(180deg, rgba(18,22,31,0.98), rgba(8,10,15,0.98))",
              boxShadow: "0 20px 80px rgba(0,0,0,0.55)",
              padding: 20,
              display: "grid",
              gap: 16,
            }}
          >
            <div>
              <div style={{ fontSize: 22, fontWeight: 900 }}>Correzione Distacco Manuale</div>
              <div style={{ marginTop: 6, fontSize: 13, opacity: 0.76 }}>
                Inserisci un distacco manuale oppure uno stato come DOPPIATO, DNF o BOX. Le correzioni verranno applicate a tabella, DG, CSV e PNG.
              </div>
            </div>

            <div
              style={{
                borderRadius: 16,
                border: "1px solid rgba(255,255,255,0.10)",
                background: "rgba(0,0,0,0.22)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  maxHeight: "60vh",
                  overflowY: "auto",
                  overflowX: "hidden",
                }}
              >
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    tableLayout: "fixed",
                  }}
                >
                  <thead
                    style={{
                      position: "sticky",
                      top: 0,
                      zIndex: 2,
                      background: "rgba(10,12,18,0.96)",
                      backdropFilter: "blur(10px)",
                    }}
                  >
                    <tr>
                      <th style={{ padding: "12px", textAlign: "left", fontSize: 12, opacity: 0.8, width: 70 }}>#</th>
                      <th style={{ padding: "12px", textAlign: "left", fontSize: 12, opacity: 0.8, width: 280 }}>Pilota</th>
                      <th style={{ padding: "12px", textAlign: "left", fontSize: 12, opacity: 0.8, width: 220 }}>Distacco OCR</th>
                      <th style={{ padding: "12px", textAlign: "left", fontSize: 12, opacity: 0.8 }}>Distacco corretto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayRows.map((row) => {
                      const currentValue = String(manualDistaccoDraft[row.posizione] ?? "").trim()
                      const originalValue = String(row.distacchi ?? "").trim()
                      const changed = currentValue !== originalValue

                      return (
                        <tr
                          key={`manual-distacco-${row.posizione}`}
                          style={{
                            background: changed
                              ? "linear-gradient(90deg, rgba(160,90,255,0.10), rgba(255,255,255,0.02))"
                              : "transparent",
                          }}
                        >
                          <td style={{ padding: "12px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                            <PosBadge pos={row.posizione} />
                          </td>

                          <td
                            style={{
                              padding: "12px",
                              borderBottom: "1px solid rgba(255,255,255,0.08)",
                              color: "rgba(255,255,255,0.86)",
                              fontWeight: 700,
                            }}
                          >
                            {row.nomePilota || "-"}
                          </td>

                          <td
                            style={{
                              padding: "12px",
                              borderBottom: "1px solid rgba(255,255,255,0.08)",
                              color: "rgba(255,255,255,0.86)",
                              fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                              fontSize: 13,
                            }}
                          >
                            {row.distacchi || "-"}
                          </td>

                          <td
  style={{
    padding: "12px",
    borderBottom: "1px solid rgba(255,255,255,0.08)",
    display: "grid",
    gap: 8,
  }}
>
  <input
    value={manualDistaccoDraft[row.posizione] ?? ""}
    onChange={(e) =>
      setManualDistaccoDraft((prev) => ({
        ...prev,
        [row.posizione]: e.target.value,
      }))
    }
    placeholder="Es. +12.345 / +01:14.960 / DOPPIATO / DNF / BOX"
    style={{
      width: "100%",
      padding: "10px 12px",
      borderRadius: 10,
      border: changed
        ? "1px solid rgba(160,90,255,0.30)"
        : "1px solid rgba(255,255,255,0.14)",
      background: "rgba(0,0,0,0.24)",
      color: "white",
      boxSizing: "border-box",
    }}
  />

  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
    {["DOPPIATO", "DNF", "BOX"].map((label) => (
      <button
        key={label}
        onClick={() =>
          setManualDistaccoDraft((prev) => ({
            ...prev,
            [row.posizione]: label,
          }))
        }
        style={{
          padding: "6px 10px",
          borderRadius: 8,
          border: "1px solid rgba(255,255,255,0.16)",
          background: "rgba(255,255,255,0.08)",
          color: "white",
          cursor: "pointer",
          fontSize: 11,
          fontWeight: 800,
          textTransform: "uppercase",
        }}
      >
        {label}
      </button>
    ))}
  </div>
</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, flexWrap: "wrap" }}>
              <button
                onClick={() => setShowDistaccoModal(false)}
                style={{
                  padding: "12px 16px",
                  borderRadius: 14,
                  border: "1px solid rgba(255,255,255,0.14)",
                  background: "rgba(255,255,255,0.06)",
                  color: "white",
                  cursor: "pointer",
                  fontWeight: 900,
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                }}
              >
                Chiudi
              </button>

              <button
                onClick={resetDistaccoCorrections}
                style={{
                  padding: "12px 16px",
                  borderRadius: 14,
                  border: "1px solid rgba(255,255,255,0.14)",
                  background: "rgba(255,255,255,0.06)",
                  color: "white",
                  cursor: "pointer",
                  fontWeight: 900,
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                }}
              >
                Reset
              </button>

              <button
                onClick={applyDistaccoCorrections}
                style={{
                  padding: "12px 16px",
                  borderRadius: 14,
                  border: "1px solid rgba(160,90,255,0.30)",
                  background: "rgba(160,90,255,0.20)",
                  color: "white",
                  cursor: "pointer",
                  fontWeight: 900,
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                  boxShadow: "0 0 22px rgba(160,90,255,0.12)",
                }}
              >
                Applica correzioni
              </button>
            </div>
          </div>
        </div>
      )}
      
      {showAutoModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.72)",
            backdropFilter: "blur(6px)",
            display: "grid",
            placeItems: "center",
            zIndex: 9999,
            padding: 20,
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 1100,
              borderRadius: 22,
              border: "1px solid rgba(255,255,255,0.12)",
              background: "linear-gradient(180deg, rgba(18,22,31,0.98), rgba(8,10,15,0.98))",
              boxShadow: "0 20px 80px rgba(0,0,0,0.55)",
              padding: 20,
              display: "grid",
              gap: 16,
            }}
          >
            <div>
              <div style={{ fontSize: 22, fontWeight: 900 }}>Advanced Manual Tweaks</div>
              <div style={{ marginTop: 6, fontSize: 13, opacity: 0.76 }}>
                Modifica solo le auto non corrette rilevate da OCR. Le correzioni verranno applicate a tabella, CSV e PNG.
              </div>
            </div>

            <div
              style={{
                borderRadius: 16,
                border: "1px solid rgba(255,255,255,0.10)",
                background: "rgba(0,0,0,0.22)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  maxHeight: "60vh",
                  overflowY: "auto",
                  overflowX: "hidden",
                }}
              >
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    tableLayout: "fixed",
                  }}
                >
                  <thead
                    style={{
                      position: "sticky",
                      top: 0,
                      zIndex: 2,
                      background: "rgba(10,12,18,0.96)",
                      backdropFilter: "blur(10px)",
                    }}
                  >
                    <tr>
                      <th style={{ padding: "12px", textAlign: "left", fontSize: 12, opacity: 0.8, width: 70 }}>#</th>
                      <th style={{ padding: "12px", textAlign: "left", fontSize: 12, opacity: 0.8, width: 220 }}>Pilota</th>
                      <th style={{ padding: "12px", textAlign: "left", fontSize: 12, opacity: 0.8, width: 280 }}>Auto OCR</th>
                      <th style={{ padding: "12px", textAlign: "left", fontSize: 12, opacity: 0.8 }}>Auto corretta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const suspicious = isClearlySuspiciousCar(row.auto || "")
                      return (
                        <tr
                          key={`manual-auto-${row.posizione}`}
                          style={{
                            background: suspicious
                              ? "linear-gradient(90deg, rgba(255,215,0,0.10), rgba(255,255,255,0.02))"
                              : "transparent",
                          }}
                        >
                          <td style={{ padding: "12px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                            <PosBadge pos={row.posizione} />
                          </td>

                          <td
                            style={{
                              padding: "12px",
                              borderBottom: "1px solid rgba(255,255,255,0.08)",
                              fontWeight: 700,
                            }}
                          >
                            {row.nomePilota}
                          </td>

                          <td
                            style={{
                              padding: "12px",
                              borderBottom: "1px solid rgba(255,255,255,0.08)",
                              color: suspicious ? "#fde68a" : "rgba(255,255,255,0.86)",
                              fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                              fontSize: 13,
                            }}
                          >
                            {row.auto || "-"}
                          </td>

                          <td
                            style={{
                              padding: "12px",
                              borderBottom: "1px solid rgba(255,255,255,0.08)",
                            }}
                          >
                            <input
                              value={manualAutoDraft[row.posizione] ?? ""}
                              onChange={(e) =>
                                setManualAutoDraft((prev) => ({
                                  ...prev,
                                  [row.posizione]: e.target.value,
                                }))
                              }
                              style={{
                                width: "100%",
                                padding: "10px 12px",
                                borderRadius: 10,
                                border: suspicious
                                  ? "1px solid rgba(255,215,0,0.30)"
                                  : "1px solid rgba(255,255,255,0.14)",
                                background: "rgba(0,0,0,0.24)",
                                color: "white",
                                boxSizing: "border-box",
                              }}
                            />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, flexWrap: "wrap" }}>
              <button
                onClick={() => setShowAutoModal(false)}
                style={{
                  padding: "12px 16px",
                  borderRadius: 14,
                  border: "1px solid rgba(255,255,255,0.14)",
                  background: "rgba(255,255,255,0.06)",
                  color: "white",
                  cursor: "pointer",
                  fontWeight: 900,
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                }}
              >
                Chiudi
              </button>

              <button
                onClick={resetAutoCorrections}
                style={{
                  padding: "12px 16px",
                  borderRadius: 14,
                  border: "1px solid rgba(255,255,255,0.14)",
                  background: "rgba(255,255,255,0.06)",
                  color: "white",
                  cursor: "pointer",
                  fontWeight: 900,
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                }}
              >
                Reset
              </button>

              <button
                onClick={applyAutoCorrections}
                style={{
                  padding: "12px 16px",
                  borderRadius: 14,
                  border: "1px solid rgba(160,90,255,0.30)",
                  background: "rgba(160,90,255,0.20)",
                  color: "white",
                  cursor: "pointer",
                  fontWeight: 900,
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                  boxShadow: "0 0 22px rgba(160,90,255,0.12)",
                }}
              >
                Applica correzioni
              </button>
            </div>
          </div>
        </div>
      )}

      {showExportModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.72)",
            backdropFilter: "blur(6px)",
            display: "grid",
            placeItems: "center",
            zIndex: 9999,
            padding: 20,
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 720,
              borderRadius: 22,
              border: "1px solid rgba(255,255,255,0.12)",
              background: "linear-gradient(180deg, rgba(18,22,31,0.98), rgba(8,10,15,0.98))",
              boxShadow: "0 20px 80px rgba(0,0,0,0.55)",
              padding: 20,
              display: "grid",
              gap: 16,
            }}
          >
            <div>
              <div style={{ fontSize: 20, fontWeight: 900 }}>Personalizza intestazione PNG</div>
              <div style={{ marginTop: 6, fontSize: 13, opacity: 0.76 }}>
                Modifichi solo il contenuto dei testi. Font, dimensioni e stile restano invariati.
              </div>
            </div>

            <div style={{ display: "grid", gap: 12 }}>
              <div style={{ display: "grid", gap: 6 }}>
                <label style={{ fontSize: 12, opacity: 0.82, textTransform: "uppercase", fontWeight: 900 }}>
                  Titolo principale
                </label>
                <input
                  value={exportTextsDraft.mainTitle}
                  onChange={(e) => setExportTextsDraft((prev) => ({ ...prev, mainTitle: e.target.value }))}
                  style={{
                    width: "100%",
                    padding: "12px 14px",
                    borderRadius: 12,
                    border: "1px solid rgba(255,255,255,0.14)",
                    background: "rgba(0,0,0,0.26)",
                    color: "white",
                  }}
                />
              </div>

              <div style={{ display: "grid", gap: 6 }}>
                <label style={{ fontSize: 12, opacity: 0.82, textTransform: "uppercase", fontWeight: 900 }}>
                  Testo accanto
                </label>
                <input
                  value={exportTextsDraft.sideLabel}
                  onChange={(e) => setExportTextsDraft((prev) => ({ ...prev, sideLabel: e.target.value }))}
                  style={{
                    width: "100%",
                    padding: "12px 14px",
                    borderRadius: 12,
                    border: "1px solid rgba(255,255,255,0.14)",
                    background: "rgba(0,0,0,0.26)",
                    color: "white",
                  }}
                />
              </div>

              <div style={{ display: "grid", gap: 6 }}>
                <label style={{ fontSize: 12, opacity: 0.82, textTransform: "uppercase", fontWeight: 900 }}>
                  Testo piccolo sotto
                </label>
                <input
                  value={exportTextsDraft.subtitle}
                  onChange={(e) => setExportTextsDraft((prev) => ({ ...prev, subtitle: e.target.value }))}
                  style={{
                    width: "100%",
                    padding: "12px 14px",
                    borderRadius: 12,
                    border: "1px solid rgba(255,255,255,0.14)",
                    background: "rgba(0,0,0,0.26)",
                    color: "white",
                  }}
                />
              </div>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, flexWrap: "wrap" }}>
              <button
                onClick={() => setShowExportModal(false)}
                style={{
                  padding: "12px 16px",
                  borderRadius: 14,
                  border: "1px solid rgba(255,255,255,0.14)",
                  background: "rgba(255,255,255,0.06)",
                  color: "white",
                  cursor: "pointer",
                  fontWeight: 900,
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                }}
              >
                Annulla
              </button>

              <button
                onClick={confirmExportPng}
                style={{
                  padding: "12px 16px",
                  borderRadius: 14,
                  border: "1px solid rgba(160,90,255,0.30)",
                  background: "rgba(160,90,255,0.20)",
                  color: "white",
                  cursor: "pointer",
                  fontWeight: 900,
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                  boxShadow: "0 0 22px rgba(160,90,255,0.12)",
                }}
              >
                Esporta PNG
              </button>
            </div>
          </div>
        </div>
      )}

      <div
        style={{
          position: "fixed",
          left: "-20000px",
          top: 0,
          width: 1920,
          height: 1080,
          pointerEvents: "none",
          zIndex: -1,
          opacity: 1,
        }}
      >
        <div ref={exportRef}>
          {finalRows.length > 0 && (
            <div
              style={{
                width: 1920,
                height: 1080,
                boxSizing: "border-box",
                display: "grid",
                gap: 12,
                padding: "10px 18px 12px 18px",
                alignContent: "start",
                borderRadius: 22,
                background:
                  "radial-gradient(1200px 600px at 15% 10%, rgba(255,215,0,0.14), transparent 50%)," +
                  "radial-gradient(900px 500px at 85% 20%, rgba(160,90,255,0.16), transparent 50%)," +
                  "linear-gradient(180deg, #0b0d12 0%, #07080c 100%)",
                border: "1px solid rgba(255,255,255,0.10)",
                boxShadow: "0 14px 60px rgba(0,0,0,0.45)",
                overflow: "hidden",
              }}
            >
              <AppHeader
                mainTitle={exportTexts.mainTitle}
                sideLabel={exportTexts.sideLabel}
                subtitle={exportTexts.subtitle}
              />

              <SummaryStrip
                winnerPilot={winnerPilot}
                ppPilot={ppPilot}
                gvPilot={gvPilot}
                unionMeta={{ ...unionMeta, gara: effectiveGara }}
                exporting={true}
              />

              <ResultsTable
                previewRows={finalRows}
                exporting={true}
                roundFinalMode={isRoundFinal}
                tableTitle={
                  isRoundFinal
                    ? `Finali di Round – Union Manufacturers Trophy - ${unionMeta.lega ? unionMeta.lega + " " : ""}Lobby ${formatLobbyShort(unionMeta.lobby)}`
                    : `Classifica definitiva Union - ${unionMeta.lega ? unionMeta.lega + " " : ""}Lobby ${formatLobbyShort(unionMeta.lobby)}${effectiveGara ? ` Gara ${effectiveGara}` : ""}`
                }
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}