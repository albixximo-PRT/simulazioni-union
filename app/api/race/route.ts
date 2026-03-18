import { NextRequest } from "next/server"
import sharp from "sharp"

export const runtime = "nodejs"

function normalizeErrorMessage(x: any) {
  if (!x) return ""
  if (Array.isArray(x)) return x.join(" | ")
  if (typeof x === "string") return x
  return JSON.stringify(x)
}

async function fetchWithTimeout(url: string, opts: RequestInit, ms: number) {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), ms)
  try {
    return await fetch(url, { ...opts, signal: controller.signal })
  } finally {
    clearTimeout(id)
  }
}

async function callOcrSpace(apiKey: string, jpegBuffer: Buffer, engine: "1" | "2") {
  const fd = new FormData()
  fd.append("apikey", apiKey)
  fd.append("language", "eng")
  fd.append("OCREngine", engine)
  fd.append("scale", "false")
  fd.append("isTable", "false")
  fd.append("file", new Blob([jpegBuffer], { type: "image/jpeg" }), "gt7.jpg")

  const res = await fetchWithTimeout(
    "https://api.ocr.space/parse/image",
    { method: "POST", body: fd },
    60000
  )
  const data = await res.json().catch(() => ({}))
  return { res, data }
}

async function preprocessForOcr(input: Buffer) {
  const img = sharp(input)
  const meta = await img.metadata()
  const w = meta.width ?? 0
  const h = meta.height ?? 0

  if (!w || !h) {
    return await sharp(input)
      .resize({ width: 1100, withoutEnlargement: true })
      .grayscale()
      .jpeg({ quality: 65 })
      .toBuffer()
  }

  const left = Math.round(w * 0.04)
  const right = Math.round(w * 0.04)
  const top = Math.round(h * 0.10)
  const bottom = Math.round(h * 0.12)

  const cropW = Math.max(1, w - left - right)
  const cropH = Math.max(1, h - top - bottom)

  return await sharp(input)
    .extract({ left, top, width: cropW, height: cropH })
    .resize({ width: 1100, withoutEnlargement: true })
    .grayscale()
    .sharpen()
    .jpeg({ quality: 65 })
    .toBuffer()
}

type RaceRow = {
  pos: number
  pilota: string
  auto: string
  tempoTotale: string
  distacco: string
  migliorGiro: string
}

function normalizePilot(s: string) {
  return s.replace(/_0I\b/g, "_01")
}

function cleanCar(s: string) {
  return s
    .replace(/\s+/g, " ")
    // fix anno senza apostrofo dopo ")"
    .replace(/\)\s*(\d{2})\b/g, ") '$1")
    .trim()
}

function toCsv(rows: RaceRow[]) {
  const header = "pos,pilota,auto,tempoTotale,distacco,migliorGiro"
  const body = rows
    .map(r => [r.pos, r.pilota, r.auto, r.tempoTotale, r.distacco, r.migliorGiro])
    .map(arr =>
      arr
        .map(v => {
          const s = String(v ?? "").replace(/"/g, '""')
          return s.includes(",") ? `"${s}"` : s
        })
        .join(",")
    )
    .join("\n")
  return header + "\n" + body
}

/**
 * Estrae un blocco di N righe dopo un header, fino al prossimo header.
 */
function takeBlock(lines: string[], headerIdx: number, stopRe: RegExp, n: number) {
  if (headerIdx === -1) return [] as string[]
  const out: string[] = []
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const s = lines[i].trim()
    if (!s) continue
    if (stopRe.test(s)) break
    out.push(s)
    if (out.length >= n) break
  }
  return out
}

function parseGaraFromColumnText(rawText: string): RaceRow[] {
  const lines = rawText
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean)

  // trova inizio blocco (1 o 9)
  const startCandidates = [1, 9]
  let startIndex = -1
  let startNum = 0
  for (const s of startCandidates) {
    const idx = lines.findIndex(l => l === String(s))
    if (idx !== -1) {
      startIndex = idx
      startNum = s
      break
    }
  }
  if (startIndex === -1) return []

  // posizioni consecutive finché presenti
  const positions: number[] = []
  let cursor = startIndex
  let expected = startNum

  while (cursor < lines.length) {
    if (lines[cursor] === String(expected)) {
      positions.push(expected)
      expected++
      cursor++
      if (positions.length >= 16) break
      continue
    }
    if (/TEMPO|PENALIT|MIGLIOR\s+GIRO/i.test(lines[cursor])) break
    cursor++
    if (positions.length > 0 && cursor - startIndex > 80) break
  }
  if (!positions.length) return []

  // cursor dopo ultima posizione
  const lastPos = positions[positions.length - 1]
  const lastPosIdx = lines.findIndex((l, i) => i >= startIndex && l === String(lastPos))
  cursor = lastPosIdx === -1 ? startIndex : lastPosIdx + 1

  const n = positions.length

  const idxTempo = lines.findIndex(l => /^TEMPO$/i.test(l) || /TEMPO/i.test(l))
  const idxPen = lines.findIndex(l => /PENALIT/i.test(l))
  const idxBest = lines.findIndex(l => /MIGLIOR\s+GIRO/i.test(l))

  const stopAnyHeader = /^(TEMPO|PENALITÀ|PENALITA|MIGLIOR\s+GIRO)$/i

  // ---------- NOMI ----------
  const isName = (s: string) => {
    if (/^\d+$/.test(s)) return false
    if (stopAnyHeader.test(s)) return false
    if (s.includes(":")) return false
    if (/^\+/.test(s)) return false
    if (/GT3|LMS|RSR|\(\d{3}\)|'\d{2}/i.test(s)) return false
    // consenti anche "CAPITAN FINDUS"
    return /^[A-Za-z0-9_\-#]+$/.test(s) || /^[A-Za-z0-9_\-#]+\s+[A-Za-z0-9_\-#]+$/.test(s)
  }

  const names: string[] = []
  while (cursor < lines.length && names.length < n) {
    const s = lines[cursor]
    if (isName(s)) {
      // "CAPITAN FINDUS" -> "CAPITAN_FINDUS"
      names.push(normalizePilot(s.replace(/\s+/g, "_")))
    }
    cursor++
    if (idxTempo !== -1 && cursor >= idxTempo) break
  }
  while (names.length < n) names.push("")

  // ---------- AUTO (ROBUSTO) ----------
  const carsEnd = idxTempo !== -1 ? idxTempo : (idxPen !== -1 ? idxPen : (idxBest !== -1 ? idxBest : lines.length))
  const carTokens = lines.slice(cursor, carsEnd).filter(s => !stopAnyHeader.test(s))

  const looksLikeModel = (s: string) =>
    /\b(GT3|RSR|LMS|Evo)\b/i.test(s) || /\bR8\b/i.test(s) || /\b911\b/i.test(s)

  const hasId = (s: string) =>
    /\(\d{3}\)/.test(s) || /'\d{2}\b/.test(s) || /\b\d{2}\b/.test(s) // include "22" senza apostrofo

  const isCompleteCar = (s: string) => looksLikeModel(s) && hasId(s)

  const looksLikeCarStart = (tok: string) => {
    const t = tok.trim()
    return (
      t === "911" ||
      t === "R8" ||
      /^911\b/.test(t) ||
      /^R8\b/.test(t) ||
      /\bLMS\b/i.test(t) ||
      /\bRSR\b/i.test(t) ||
      /\bGT3\b/i.test(t)
    )
  }

  const cars: string[] = []
  let currentParts: string[] = []

  const flush = () => {
    cars.push(cleanCar(currentParts.join(" ")))
    currentParts = []
  }

  for (let i = 0; i < carTokens.length; i++) {
    const tok = carTokens[i]

    if (currentParts.length > 0) {
      const curr = cleanCar(currentParts.join(" "))
      const currHasSomething = looksLikeModel(curr) || hasId(curr)

      if (looksLikeCarStart(tok) && currHasSomething && isCompleteCar(curr)) {
        flush()
      }
    }

    currentParts.push(tok)

    const now = cleanCar(currentParts.join(" "))

    if (isCompleteCar(now)) {
      const next = carTokens[i + 1]?.trim() ?? ""
      const nextIsYear = /^'?\d{2}$/.test(next)
      if (nextIsYear) {
        currentParts.push(next)
        i++
      }
      flush()
    }
  }
  if (currentParts.length) flush()

  while (cars.length < n) cars.push("")
  if (cars.length > n) cars.length = n

  // ---------- TEMPO ----------
  const tempoRaw = takeBlock(lines, idxTempo, /^(PENALITÀ|PENALITA|MIGLIOR\s+GIRO)$/i, n)

  // ---------- MIGLIOR GIRO ----------
  const bestRaw = takeBlock(lines, idxBest, /^(TEMPO|PENALITÀ|PENALITA)$/i, n).map(s => {
    // pulisci "--:--.--THE REAL..." prendendo solo il pezzo iniziale
    const m = s.match(/^(\d:\d{2}\.\d{3}|--:--\.\-\-)/)
    return (m?.[1] ?? s).trim()
  })

  const best = bestRaw.map(s => (s.startsWith("--") ? "" : s))

  // ---------- OUTPUT ----------
  const out: RaceRow[] = []

  for (let i = 0; i < n; i++) {
    const pos = positions[i]
    const pilota = names[i] ?? ""
    const auto = cars[i] ?? ""
    const tempoCell = (tempoRaw[i] ?? "").trim()

    let tempoTotale = ""
    let distacco = ""

    if (pos === 1) {
      if (/^(?:\d+:)?\d{1,2}:\d{2}\.\d{3}$/.test(tempoCell)) tempoTotale = tempoCell
      distacco = ""
    } else {
      if (tempoCell.startsWith("+")) {
        distacco = tempoCell
      } else {
        const giroMatch = tempoCell.match(/^(\d+)\s*giro/i) || tempoCell.match(/^(\d+)\s*giri/i)

if (giroMatch) {
  const n = giroMatch[1]
  distacco = `${n}giro`
}
else if (/non\s+finito/i.test(tempoCell)) {
  distacco = "DNF"
} 
        else distacco = tempoCell
      }
    }

    out.push({
      pos,
      pilota,
      auto,
      tempoTotale,
      distacco,
      migliorGiro: best[i] ?? "",
    })
  }

  return out
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()

    const files = formData.getAll("files").filter(Boolean) as File[]
    if (!files.length) {
      const single = formData.get("file") as File | null
      if (!single) return Response.json({ error: "Nessun file ricevuto" }, { status: 400 })
      files.push(single)
    }

    const apiKey = process.env.NEXT_PUBLIC_OCR_API_KEY || process.env.OCR_API_KEY
    if (!apiKey) return Response.json({ error: "Manca OCR_API_KEY in env" }, { status: 500 })

    const merged = new Map<number, RaceRow>()
    const debugTexts: string[] = []

    for (const f of files) {
      const input = Buffer.from(await f.arrayBuffer())
      const prepped = await preprocessForOcr(input)

      // OCR con retry E101/E500
      let { res, data } = await callOcrSpace(apiKey, prepped, "2")

      const err1 = normalizeErrorMessage(data?.ErrorMessage)
      const bad1 = !res.ok || data?.IsErroredOnProcessing
      const e500_1 = err1.includes("E500") || err1.toLowerCase().includes("resource")
      const e101_1 = err1.includes("E101") || err1.toLowerCase().includes("timed")

      if (bad1 && (e500_1 || e101_1)) {
        ;({ res, data } = await callOcrSpace(apiKey, prepped, "2"))

        const err2 = normalizeErrorMessage(data?.ErrorMessage)
        const bad2 = !res.ok || data?.IsErroredOnProcessing
        const e500_2 = err2.includes("E500") || err2.toLowerCase().includes("resource")
        const e101_2 = err2.includes("E101") || err2.toLowerCase().includes("timed")

        if (bad2 && (e500_2 || e101_2)) {
          ;({ res, data } = await callOcrSpace(apiKey, prepped, "1"))
        }
      }

      if (!res.ok || data?.IsErroredOnProcessing) {
        return Response.json(
          {
            error: "OCR.space error",
            httpStatus: res.status,
            ocrStatus: {
              IsErroredOnProcessing: data?.IsErroredOnProcessing,
              ErrorMessage: data?.ErrorMessage,
              ErrorDetails: data?.ErrorDetails,
            },
          },
          { status: 502 }
        )
      }

      const text: string = data?.ParsedResults?.[0]?.ParsedText || ""
      debugTexts.push(text)

      const part = parseGaraFromColumnText(text)
      for (const r of part) merged.set(r.pos, r)
    }

    const finalRows = Array.from(merged.values())
      .sort((a, b) => a.pos - b.pos)
      .filter(r => r.pos >= 1 && r.pos <= 16 && (r.pilota || r.auto || r.tempoTotale || r.distacco || r.migliorGiro))

    const csv = toCsv(finalRows)

    return Response.json({
      count: finalRows.length,
      rows: finalRows,
      csv,
      debugText: debugTexts.join("\n\n===== NEXT FILE =====\n\n"),
    })
  } catch (err: any) {
    const msg = String(err?.name || "") === "AbortError" ? "Timeout chiamata OCR.space" : "Errore server"
    return Response.json(
      { error: msg, details: String(err?.stack || err?.message || err) },
      { status: 500 }
    )
  }
}