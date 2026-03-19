"use client"

import React, { useMemo, useRef, useState } from "react"
import { toPng } from "html-to-image"

const APP_PASSWORD = "Gabus"

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

type UnionMeta = {
  gara: string
  lobby: string
  lega: string
}

function TableCell({
  children,
  align,
  mono,
  dim,
  style,
}: {
  children: React.ReactNode
  align?: "left" | "center" | "right"
  mono?: boolean
  dim?: boolean
  style?: React.CSSProperties
}) {
  return (
    <td
      style={{
        padding: "12px 12px",
        borderBottom: "1px solid rgba(255,255,255,0.08)",
        textAlign: align ?? "left",
        fontFamily: mono ? "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" : undefined,
        fontSize: 13,
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
}: {
  label: string
  value: string
  variant: "gold" | "violet"
}) {
  const palette =
    variant === "gold"
      ? { border: "rgba(255,215,0,0.70)", glow: "rgba(255,215,0,0.16)" }
      : { border: "rgba(160,90,255,0.70)", glow: "rgba(160,90,255,0.14)" }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "7px 11px",
          borderRadius: 999,
          border: `1px solid ${palette.border}`,
          background: "rgba(0,0,0,0.20)",
          boxShadow: `0 0 22px ${palette.glow}`,
          color: "white",
          fontWeight: 900,
          fontSize: 12,
          letterSpacing: 0.6,
          textTransform: "uppercase",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>

      <span
        style={{
          color: "white",
          fontWeight: 900,
          fontSize: 14,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          letterSpacing: 0.2,
          whiteSpace: "nowrap",
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
}: {
  left: string
  right?: string
  variant: "gold" | "violet" | "orange" | "teal" | "fuchsia"
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
        gap: 10,
        padding: "8px 12px",
        borderRadius: 14,
        fontSize: 12,
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

function renderDistaccoCell(value: string) {
  const t = (value || "").trim()
  const u = t.toUpperCase()

  if (!t || t === "-") return "-"

  if (u === "DNF") return <Pill left="DNF" variant="teal" />
  if (u === "BOX") return <Pill left="BOX" variant="fuchsia" />
  if (u === "DOPPIATO") return <Pill left="DOPPIATO" variant="orange" />
  if (/^\d+giro$/i.test(t)) return <Pill left="DOPPIATO" variant="orange" />

  return t
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

function AppHeader() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 18,
        flexWrap: "wrap",
        marginBottom: 18,
        padding: 16,
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

      <div style={{ position: "relative" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div
            style={{
              fontSize: 34,
              fontWeight: 900,
              letterSpacing: 0.4,
              textTransform: "uppercase",
              lineHeight: 1.05,
              textShadow: "0 0 18px rgba(255,215,0,0.22)",
            }}
          >
            Albixximo Union Tools
          </div>

          <span
            style={{
              fontSize: 12,
              padding: "6px 10px",
              borderRadius: 999,
              border: "1px solid rgba(255,255,255,0.14)",
              background: "rgba(255,255,255,0.06)",
              opacity: 0.95,
              letterSpacing: 0.6,
              textTransform: "uppercase",
            }}
          >
            Union CSV Extractor
          </span>
        </div>

        <div style={{ marginTop: 6, fontSize: 13, opacity: 0.9 }}>PRT Timing Assistant</div>

        <div
          style={{
            marginTop: 12,
            height: 10,
            borderRadius: 999,
            background:
              "linear-gradient(90deg, rgba(255,215,0,0.0) 0%, rgba(255,215,0,0.35) 18%, rgba(255,255,255,0.14) 50%, rgba(160,90,255,0.30) 82%, rgba(160,90,255,0.0) 100%)",
            boxShadow: "0 0 18px rgba(255,215,0,0.14)",
            opacity: 0.9,
          }}
        />
      </div>

      <a
        href="/prt_logo.png"
        target="_blank"
        rel="noreferrer"
        title="PRT Logo"
        style={{
          position: "relative",
          display: "grid",
          placeItems: "center",
          padding: 10,
          borderRadius: 18,
          border: "1px solid rgba(255,255,255,0.12)",
          background: "rgba(0,0,0,0.18)",
          textDecoration: "none",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: -6,
            borderRadius: 22,
            background: "radial-gradient(circle at 50% 40%, rgba(255,215,0,0.35), transparent 60%)",
            filter: "blur(10px)",
            opacity: 0.95,
            pointerEvents: "none",
          }}
        />
        <img
          src="/prt_logo.png"
          alt="PRT"
          style={{
            height: 74,
            width: "auto",
            opacity: 0.95,
            filter:
              "drop-shadow(0 0 14px rgba(255,215,0,0.45)) drop-shadow(0 0 34px rgba(255,215,0,0.18))",
          }}
        />
      </a>
    </div>
  )
}

function ResultsTable({
  previewRows,
  exporting = false,
}: {
  previewRows: UnionRow[]
  exporting?: boolean
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
          padding: "12px 14px",
          borderBottom: "1px solid rgba(255,255,255,0.10)",
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ fontWeight: 900 }}>Classifica Union (output)</div>
        <div style={{ fontSize: 12, opacity: 0.8 }}>{previewRows.length} righe</div>
      </div>

      <div style={{ overflow: "visible" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
          <thead
            style={{
              position: "static",
              top: 0,
              zIndex: 2,
              background: "rgba(10,12,18,0.92)",
              backdropFilter: exporting ? undefined : "blur(10px)",
            }}
          >
            <tr>
              <th style={{ padding: "12px 12px", textAlign: "left", fontSize: 12, opacity: 0.8, width: 64 }}>#</th>
              <th style={{ padding: "12px 12px", textAlign: "left", fontSize: 12, opacity: 0.8, width: 220 }}>
                Nome pilota
              </th>
              <th style={{ padding: "12px 12px", textAlign: "left", fontSize: 12, opacity: 0.8 }}>Auto</th>
              <th style={{ padding: "12px 12px", textAlign: "right", fontSize: 12, opacity: 0.8, width: 170 }}>
                Distacchi
              </th>
              <th style={{ padding: "12px 12px", textAlign: "center", fontSize: 12, opacity: 0.8, width: 90 }}>PP</th>
              <th style={{ padding: "12px 12px", textAlign: "center", fontSize: 12, opacity: 0.8, width: 90 }}>GV</th>
              <th style={{ padding: "12px 12px", textAlign: "center", fontSize: 12, opacity: 0.8, width: 90 }}>
                Gara
              </th>
              <th style={{ padding: "12px 12px", textAlign: "center", fontSize: 12, opacity: 0.8, width: 90 }}>
                Lobby
              </th>
              <th style={{ padding: "12px 12px", textAlign: "center", fontSize: 12, opacity: 0.8, width: 120 }}>
                Lega
              </th>
            </tr>
          </thead>

          <tbody>
            {previewRows.map((r, i) => {
              const isPp = (r.pp || "").trim().toUpperCase() === "PP"
              const isGv = (r.gv || "").trim().toUpperCase() === "GV"
              const fallbackBg = i % 2 === 0 ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.10)"

              return (
                <tr key={`${r.posizione}-${r.nomePilota}-${i}`} style={rowStyleForPos(r.posizione, fallbackBg)}>
                  <TableCell>
                    <PosBadge pos={r.posizione} />
                  </TableCell>

                  <TableCell>{r.nomePilota}</TableCell>

                  <TableCell dim={!r.auto} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {r.auto || "-"}
                  </TableCell>

                  <TableCell align="right" mono style={{ whiteSpace: "nowrap" }}>
                    {renderDistaccoCell(r.distacchi)}
                  </TableCell>

                  <TableCell align="center" mono dim={!isPp}>
                    {isPp ? <Pill left="PP" variant="gold" /> : "-"}
                  </TableCell>

                  <TableCell align="center" mono dim={!isGv}>
                    {isGv ? <Pill left="GV" variant="violet" /> : "-"}
                  </TableCell>

                  <TableCell align="center" mono dim={!r.gara}>
                    {r.gara || "-"}
                  </TableCell>

                  <TableCell align="center" mono dim={!r.lobby}>
                    {r.lobby || "-"}
                  </TableCell>

                  <TableCell align="center" mono dim={!r.lega}>
                    {r.lega || "-"}
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
  const [inputPassword, setInputPassword] = useState("")
  const [loginError, setLoginError] = useState("")

  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const exportRef = useRef<HTMLDivElement | null>(null)

  const canRun = useMemo(() => files.length > 0, [files])

  const ppPilot = useMemo(() => {
    const row = rows.find((r) => (r.pp || "").trim().toUpperCase() === "PP")
    return row?.nomePilota || ""
  }, [rows])

  const gvPilot = useMemo(() => {
    const row = rows.find((r) => (r.gv || "").trim().toUpperCase() === "GV")
    return row?.nomePilota || ""
  }, [rows])

  function handleLogin() {
    if (inputPassword === APP_PASSWORD) {
      setAuthorized(true)
      setLoginError("")
      return
    }

    setLoginError("Password errata")
  }

  async function exportTablePng() {
    if (!exportRef.current || rows.length === 0) return

    try {
      setExporting(true)
      await new Promise((resolve) => setTimeout(resolve, 120))

      const dataUrl = await toPng(exportRef.current, {
        cacheBust: true,
        pixelRatio: 2,
        backgroundColor: "#07080c",
      })

      const link = document.createElement("a")
      link.download = "albixximo_union_output.png"
      link.href = dataUrl
      link.click()
    } catch (e: any) {
      setError(`Errore esportazione PNG: ${String(e?.message || e)}`)
    } finally {
      setExporting(false)
    }
  }

  async function run() {
    setLoading(true)
    setError("")
    setWarning("")
    setCsv("")
    setRows([])
    setUnionMeta({ gara: "", lobby: "", lega: "" })

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
    }
  }

  function resetAll() {
    window.location.reload()
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
          maxWidth: 640,
          borderRadius: 28,
          padding: "44px 42px",
          background: "rgba(14, 18, 32, 0.88)",
          border: "1px solid rgba(163, 95, 255, 0.34)",
          boxShadow:
            "0 0 60px rgba(120,70,255,0.20), 0 0 140px rgba(255,215,0,0.08)",
          backdropFilter: "blur(14px)",
          position: "relative",
          zIndex: 1,
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div
            style={{
              width: "100%",
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              marginBottom: 20,
            }}
          >
            <img
              src="/union_logo.png"
              alt="Union"
              style={{
                width: 220,
                height: "auto",
                display: "block",
                filter:
                  "drop-shadow(0 0 30px rgba(255,255,255,0.16)) drop-shadow(0 0 42px rgba(160,90,255,0.28))",
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
              marginBottom: 16,
            }}
          >
            Accesso riservato
          </div>

          <h1
            style={{
              margin: 0,
              fontSize: 42,
              fontWeight: 900,
              letterSpacing: "-0.04em",
              textTransform: "uppercase",
              textShadow: "0 0 20px rgba(255,215,0,0.18)",
              lineHeight: 1.02,
            }}
          >
            UNION RACE TIMING
          </h1>

          <p
            style={{
              margin: "16px 0 0 0",
              fontSize: 15,
              color: "rgba(255,255,255,0.75)",
            }}
          >
            Inserisci password per accedere
          </p>
        </div>

        <div style={{ display: "grid", gap: 14 }}>
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
              height: 60,
              borderRadius: 16,
              border: "1px solid rgba(255,215,0,0.28)",
              background: "rgba(255,255,255,0.04)",
              color: "#ffffff",
              padding: "0 18px",
              fontSize: 16,
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
              height: 60,
              borderRadius: 16,
              border: "1px solid rgba(255,215,0,0.35)",
              background: !inputPassword.trim()
                ? "rgba(255,255,255,0.08)"
                : "linear-gradient(135deg, rgba(255,215,0,0.96), rgba(255,190,40,0.94))",
              color: "#111522",
              fontSize: 16,
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
            marginTop: 20,
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
                <HeaderBadge label="PP" value={ppPilot} variant="gold" />
                <HeaderBadge label="GV" value={gvPilot} variant="violet" />
                <HeaderBadge label="GARA" value={unionMeta.gara} variant="gold" />
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
                {loading ? "Elaborazione..." : "Genera CSV Union"}
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

              {!canRun && <div style={{ fontSize: 12, opacity: 0.75 }}>Seleziona almeno 2 immagini (Quali + Gara).</div>}
            </div>

            {rows.length > 0 && (
              <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                <button
                  onClick={exportTablePng}
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
                {warning}
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

            {showTable && rows.length > 0 && <ResultsTable previewRows={rows} />}

            {csv && (
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
                    href={"data:text/csv;charset=utf-8," + encodeURIComponent(csv)}
                    download="albixximo_union.csv"
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
                  value={csv}
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

      <div
        style={{
          position: "fixed",
          left: "-20000px",
          top: 0,
          width: 1320,
          pointerEvents: "none",
          zIndex: -1,
          opacity: 1,
        }}
      >
        <div ref={exportRef}>
          {rows.length > 0 && (
            <div
              style={{
                display: "grid",
                gap: 16,
                padding: 20,
                borderRadius: 22,
                background:
                  "radial-gradient(1200px 600px at 15% 10%, rgba(255,215,0,0.14), transparent 50%)," +
                  "radial-gradient(900px 500px at 85% 20%, rgba(160,90,255,0.16), transparent 50%)," +
                  "linear-gradient(180deg, #0b0d12 0%, #07080c 100%)",
                border: "1px solid rgba(255,255,255,0.10)",
                boxShadow: "0 14px 60px rgba(0,0,0,0.45)",
              }}
            >
              <AppHeader />
              <ResultsTable previewRows={rows} exporting={true} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}