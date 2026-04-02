import { NextRequest } from "next/server"
import sharp from "sharp"

export const runtime = "nodejs"

const OCR_PRO_ENDPOINTS = [
  "https://apipro1.ocr.space/parse/image",
  "https://apipro2.ocr.space/parse/image",
] as const

/* -------------------- Helpers OCR -------------------- */

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
  const TIMEOUT = 60000

  function buildFormData() {
    const fd = new FormData()
    fd.append("apikey", apiKey)
    fd.append("language", "eng")
    fd.append("OCREngine", engine)
    fd.append("scale", "false")
    fd.append("isTable", "false")

    const jpegUint8 = new Uint8Array(jpegBuffer)
    fd.append("file", new Blob([jpegUint8], { type: "image/jpeg" }), "gt7.jpg")

    return fd
  }

  // 🔁 PRO 1 → 2 tentativi
  for (let i = 0; i < 2; i++) {
    try {
      const res = await fetchWithTimeout(
        OCR_PRO_ENDPOINTS[0],
        { method: "POST", body: buildFormData() },
        TIMEOUT
      )

      const data = await res.json().catch(() => ({}))

      if (res.ok && data?.ParsedResults?.length) {
        return { res, data }
      }
    } catch {
      // retry PRO 1
    }
  }

  // 🔄 PRO 2 → fallback
  try {
    const res = await fetchWithTimeout(
      OCR_PRO_ENDPOINTS[1],
      { method: "POST", body: buildFormData() },
      TIMEOUT
    )

    const data = await res.json().catch(() => ({}))

    if (res.ok && data?.ParsedResults?.length) {
      return { res, data }
    }
  } catch {
    // fallback fallito
  }

  throw new Error("OCR.Space non disponibile o risposta non valida")
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

async function preprocessForOcrQualiAlt(input: Buffer) {
  return await sharp(input)
    .resize({ width: 1600, withoutEnlargement: true })
    .grayscale()
    .sharpen()
    .jpeg({ quality: 80 })
    .toBuffer()
}

async function preprocessForOcrQualiTimesOnly(input: Buffer) {
  const img = sharp(input)
  const meta = await img.metadata()
  const w = meta.width ?? 0
  const h = meta.height ?? 0

  if (!w || !h) {
    return await sharp(input)
      .resize({ width: 1800, withoutEnlargement: true })
      .grayscale()
      .sharpen()
      .jpeg({ quality: 85 })
      .toBuffer()
  }

  const left = Math.round(w * 0.02)
  const top = Math.round(h * 0.16)
  const cropW = Math.round(w * 0.96)
  const cropH = Math.round(h * 0.62)

  return await sharp(input)
    .extract({
      left,
      top,
      width: Math.max(1, cropW),
      height: Math.max(1, cropH),
    })
    .resize({ width: 1800, withoutEnlargement: true })
    .grayscale()
    .normalize()
    .sharpen()
    .jpeg({ quality: 85 })
    .toBuffer()
}

async function ocrWithRetry(apiKey: string, prepped: Buffer) {
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
    return { ok: false as const, res, data, text: "" }
  }

  const text: string = data?.ParsedResults?.[0]?.ParsedText || ""
  return { ok: true as const, res, data, text }
}

/* -------------------- Normalization -------------------- */

function normalizePilot(s: string) {
  return String(s || "")
    .replace(/\?/g, "7")
    .replace(/_0I\b/g, "_01")
    .trim()
}

function pilotKey(s: string) {
  return normalizePilot(String(s || "").trim().replace(/\s+/g, "_"))
}

function normalizePilotLoose(s: string) {
  return String(s || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/_/g, "")
    .replace(/-/g, "")
    .replace(/\./g, "")
    .trim()
}

function oneEditAwayOrLess(a: string, b: string) {
  if (a === b) return true

  const la = a.length
  const lb = b.length
  if (Math.abs(la - lb) > 1) return false

  let i = 0
  let j = 0
  let edits = 0

  while (i < la && j < lb) {
    if (a[i] === b[j]) {
      i++
      j++
      continue
    }

    edits++
    if (edits > 1) return false

    if (la > lb) {
      i++
    } else if (lb > la) {
      j++
    } else {
      i++
      j++
    }
  }

  if (i < la || j < lb) edits++

  return edits <= 1
}

function betterPilotMatch(a: string, b: string) {
  const aa = normalizePilotLoose(a)
  const bb = normalizePilotLoose(b)

  if (!aa || !bb) return false
  if (aa === bb) return true

  if (aa.length >= 6 && bb.length >= 6 && oneEditAwayOrLess(aa, bb)) {
    return true
  }

  return false
}

function cleanCar(s: string) {
  let out = String(s || "")
    .replace(/\s+/g, " ")
    .replace(/["“”]/g, "'")
    .replace(/\*/g, " ")
    .replace(/_/g, " ")
    .replace(/\s+'/g, " '")
    .replace(/\b(Megane)\b/gi, "Mégane")
    .replace(/\bHuracan\b/gi, "Huracán")
    .replace(/\bGr ?4\b/gi, "Gr.4")
    .replace(/\bGT ?4\b/gi, "GT4")
    .replace(/\bTC ?'?24\b/gi, "TC '24")
    .replace(/\bTrophy ?'?11\b/gi, "Trophy '11")
    .replace(/\bCup ?'?16\b/gi, "Cup '16")
    .replace(/\bClubsport ?'?16\b/gi, "Clubsport '16")
    .replace(/\)\s*(\d{2})\b/g, ") '$1")
    .replace(/\s+\)/g, ")")
    .replace(/\s+/g, " ")
    .trim()

  // recupero generico OCR per finale anno a 2 cifre scritto male:
  // R1816 -> R18 '16
  // R18 16 -> R18 '16
  // R18*16 -> R18 '16
  // TS05016 -> TS050 '16
  const compactYearMatch = out.match(/^(.+?)[\s'*.`-]?(\d{2})$/)
  if (compactYearMatch) {
    const base = compactYearMatch[1].trim()
    const year = compactYearMatch[2]

    const looksLikeCar =
      /[A-Za-z]/.test(base) &&
      (
        /\d/.test(base) ||
        /\b(Gr\.4|GT4|GT3|LMS|RSR|Hybrid|HYBRID|Vision|Touring|Cup|Trophy|Clubsport|Italia|Huracán|Huracan|Mégane|Megane)\b/i.test(base)
      )

    if (looksLikeCar && !/'\d{2}$/.test(out)) {
      out = `${base} '${year}`
    }
  }

  return out
}

function csvEscape(v: any) {
  const s = String(v ?? "").replace(/"/g, '""')
  return s.includes(",") ? `"${s}"` : s
}

/* -------------------- Known cars -------------------- */

const KNOWN_CARS = [
  // Union storiche / GT3-like
  "911 GT3 R (992) '22",
  "R8 LMS Evo '19",
  "M6 GT3 Sprint Model '16",
  "AMG GT3 '20",
  "Huracán GT3 '15",
  "RC F GT3 '17",
  "Supra Racing Concept '18",
  "NSX GT3 '17",
  "GT-R NISMO GT3 '18",
  "458 Italia GT3 '13",
  "Vantage GT3 '12",
  "650S GT3 '15",
  "Genesis X Gran Berlinetta Vision Gran Turismo",
  "Genesis X Gran Racer Vision Gran Turismo Concept",
  "Mazda LM55 Vision Gran Turismo",
  "McLaren Ultimate Vision Gran Turismo",
  "Bugatti Vision Gran Turismo",
  "SRT Tomahawk Vision Gran Turismo Gr.1",
  "Peugeot L500R HYbrid Vision Gran Turismo",
  "Audi Vision Gran Turismo",
  "Volkswagen GTI Vision Gran Turismo Gr.3",
  "R18 '16",
  "919 Hybrid '16",
  "TS050 Hybrid '16",
  "GR010 HYBRID '21",

  // PRT aggiunte
  "Cayman GT4 Clubsport '16",
  "Mégane Trophy '11",
  "Swift Sport Gr.4",
  "458 Italia Gr.4",
  "TT Cup '16",
  "4C Gr.4",
  "ELANTRA N TC '24",
  "Huracán Gr.4",
  "NSX Gr.4",
  "Silvia spec-R Aero (S15) Touring Car",
  "Atenza Gr.4",
  "MAZDA3 Gr.4",
  "GT-R Gr.4",
  "650S Gr.4",
]

function normalizeCarLoose(s: string) {
  return cleanCar(String(s || ""))
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/["“”]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
}

function scoreCarCandidate(raw: string, known: string) {
  const a = normalizeCarLoose(raw)
  const b = normalizeCarLoose(known)

  let score = 0

  if (a === b) score += 100
  if (a.includes(b)) score += 80
  if (b.includes(a) && a.length >= 6) score += 40

  const aWords = new Set(a.split(" "))
  const bWords = b.split(" ")

  for (const w of bWords) {
    if (aWords.has(w)) score += 6
  }

  return score
}

function normalizeKnownCar(raw: string) {
  const s = cleanCar(raw)
  if (!s) return ""

  let best = ""
  let bestScore = 0

  for (const known of KNOWN_CARS) {
    const sc = scoreCarCandidate(s, known)
    if (sc > bestScore) {
      bestScore = sc
      best = known
    }
  }

  return bestScore >= 12 ? best : s
}

function pickFirstKnownCar(raw: string) {
  const s = cleanCar(raw)
  if (!s) return ""

  const matches = KNOWN_CARS
    .map((known) => {
      const idx = s.indexOf(known)
      return idx >= 0 ? { known, idx } : null
    })
    .filter(Boolean) as { known: string; idx: number }[]

  if (!matches.length) return normalizeKnownCar(s)

  matches.sort((a, b) => a.idx - b.idx)
  return matches[0].known
}

function looksLikeKnownCarToken(s: string) {
  const t = normalizeCarLoose(s)
  if (!t) return false

  return (
    t.includes("gr.4") ||
    t.includes("gr4") ||
    t.includes("gt4") ||
    t.includes("gt3") ||
    t.includes("lms") ||
    t.includes("rsr") ||
    t.includes("clubsport") ||
    t.includes("trophy") ||
    t.includes("italia") ||
    t.includes("elantra") ||
    t.includes("nsx") ||
    t.includes("huracan") ||
    t.includes("huracán") ||
    t.includes("mazda3") ||
    t.includes("mazda 3") ||
    t.includes("gt-r") ||
    t.includes("gtr") ||
    t.includes("650s") ||
    t.includes("atenza") ||
    t.includes("silvia") ||
    t.includes("touring car") ||
    t.includes("tt cup") ||
    t.includes("4c") ||
    t.includes("911") ||
    t.includes("r8") ||
    t.includes("amg") ||
    t.includes("supra") ||
    t.includes("vantage") ||
    t.includes("vision gran turismo") ||
    t.includes("tomahawk") ||
    t.includes("lm55") ||
    t.includes("r18") ||
    t.includes("919") ||
    t.includes("ts050") ||
    t.includes("gr010") ||
    t.includes("hybrid")
  )
}

function isDefinitelyCarTokenForNameFilter(s: string) {
  const t = normalizeCarLoose(s)
  if (!t) return false

  if (/\(\d{3}\)/.test(t)) return true
  if (/'\d{2}\b/.test(t)) return true
  if (/\bgr\.?4\b/i.test(t)) return true
  if (/\bgt4\b/i.test(t)) return true
  if (/\bgt3\b/i.test(t)) return true
  if (/\blms\b/i.test(t)) return true
  if (/\brsr\b/i.test(t)) return true
  if (/\btouring car\b/i.test(t)) return true
  if (/\bvision gran turismo\b/i.test(t)) return true

  if (
    /\b911\b/i.test(t) ||
    /\br8\b/i.test(t) ||
    /\bamg\b/i.test(t) ||
    /\bsupra\b/i.test(t) ||
    /\bvantage\b/i.test(t) ||
    /\belantra\b/i.test(t) ||
    /\bhuracan\b/i.test(t) ||
    /\bhuracán\b/i.test(t) ||
    /\bmazda3\b/i.test(t) ||
    /\b650s\b/i.test(t) ||
    /\bcayman\b/i.test(t) ||
    /\bmegane\b/i.test(t) ||
    /\bmégane\b/i.test(t) ||
    /\bitalia\b/i.test(t) ||
    /\bclubsport\b/i.test(t) ||
    /\btrophy\b/i.test(t) ||
    /\batenza\b/i.test(t) ||
    /\bsilvia\b/i.test(t) ||
    /\btt cup\b/i.test(t) ||
    /\b4c\b/i.test(t) ||
    /\btomahawk\b/i.test(t) ||
    /\blm55\b/i.test(t)
  ) {
    return true
  }

  if (
    /\br18\b/i.test(t) ||
    /\b919\b/i.test(t) ||
    /\bts050\b/i.test(t) ||
    /\bgr010\b/i.test(t) ||
    /\bhybrid\b/i.test(t)
  ) {
    return true
  }

  if (/\bgt-r\b/i.test(t)) return true

  return false
}

/* -------------------- Time utils -------------------- */

function parseRaceTotalToMs(s: string): number | null {
  const t = (s || "").trim()
  if (!t) return null

  const h = t.match(/^(\d+):(\d{2}):(\d{2})\.(\d{3})$/)
  if (h) {
    const hh = Number(h[1]), mm = Number(h[2]), ss = Number(h[3]), ms = Number(h[4])
    if ([hh, mm, ss, ms].some(Number.isNaN)) return null
    return (((hh * 60 + mm) * 60 + ss) * 1000 + ms)
  }

  const m = t.match(/^(\d+):(\d{2})\.(\d{3})$/)
  if (m) {
    const mm = Number(m[1]), ss = Number(m[2]), ms = Number(m[3])
    if ([mm, ss, ms].some(Number.isNaN)) return null
    return ((mm * 60 + ss) * 1000 + ms)
  }

  return null
}

function formatMsToRaceTime(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0

  const totalSeconds = Math.floor(ms / 1000)
  const milli = ms % 1000

  const ss = totalSeconds % 60
  const totalMinutes = Math.floor(totalSeconds / 60)
  const mm = totalMinutes % 60
  const hh = Math.floor(totalMinutes / 60)

  const pad2 = (n: number) => String(n).padStart(2, "0")
  const pad3 = (n: number) => String(n).padStart(3, "0")

  if (hh > 0) return `${hh}:${pad2(mm)}:${pad2(ss)}.${pad3(milli)}`
  return `${mm}:${pad2(ss)}.${pad3(milli)}`
}

function parseGapToMs(gap: string): number | null {
  const s = (gap || "").trim()
  if (!s) return null

  const short = s.match(/^\+(\d+)\.(\d{3})$/)
  if (short) {
    const sec = Number(short[1])
    const ms = Number(short[2])
    if ([sec, ms].some(Number.isNaN)) return null
    return sec * 1000 + ms
  }

  const long = s.match(/^\+(\d+):(\d{2})\.(\d{3})$/)
  if (long) {
    const min = Number(long[1])
    const sec = Number(long[2])
    const ms = Number(long[3])
    if ([min, sec, ms].some(Number.isNaN)) return null
    return (min * 60 + sec) * 1000 + ms
  }

  return null
}

function parseLapTimeToMs(s: string): number | null {
  const t = (s || "").trim()
  if (!t) return null

  const mmss = t.match(/^(\d{1,2}):(\d{2})\.(\d{3})$/)
  if (mmss) {
    const mm = Number(mmss[1])
    const ss = Number(mmss[2])
    const ms = Number(mmss[3])
    if ([mm, ss, ms].some(Number.isNaN)) return null
    return (mm * 60 + ss) * 1000 + ms
  }

  const hhmmss = t.match(/^(\d+):(\d{2}):(\d{2})\.(\d{3})$/)
  if (hhmmss) {
    const hh = Number(hhmmss[1])
    const mm = Number(hhmmss[2])
    const ss = Number(hhmmss[3])
    const ms = Number(hhmmss[4])
    if ([hh, mm, ss, ms].some(Number.isNaN)) return null
    return (((hh * 60 + mm) * 60) + ss) * 1000 + ms
  }

  return null
}

/* -------------------- UNION META -------------------- */

type UnionMeta = {
  gara: string
  lobby: string
  lega: string
}

function normalizeUnionLeague(raw: string) {
  const s = (raw || "").toUpperCase().replace(/\s+/g, " ").trim()

  if (/(^|\b)PRO[\s\-_]?GOLD(\b|$)/i.test(s)) return "PRO-GOLD"
  if (/(^|\b)PRO[\s\-_]?SILVER(\b|$)/i.test(s)) return "PRO-SILVER"
  if (/(^|\b)PRO[\s\-_]?AMA(\b|$)/i.test(s)) return "PRO-AMA"
  if (/(^|\b)STAR(\b|$)/i.test(s)) return "STAR"
  if (/(^|\b)ELITE(\b|$)/i.test(s)) return "ELITE"
  if (/(^|\b)AMA(\b|$)/i.test(s)) return "AMA"

  return ""
}

function extractUnionMetaFromText(text: string): Partial<UnionMeta> {
  const raw = String(text || "")
  const upper = raw.toUpperCase()

  let gara = ""
  let lobby = ""
  let lega = ""

  const garaMatch =
    upper.match(/\bGARA\s*([1-9]\d?)\b/) ||
    upper.match(/\bR(?:OUND)?\s*([1-9]\d?)\b/)
  if (garaMatch) gara = garaMatch[1]

  const lobbyMatch =
    upper.match(/\bLOBBY\s*A?\s*0?(\d{1,2})\b/) ||
    upper.match(/\bA0?(\d{1,2})\b/)
  if (lobbyMatch) {
    lobby = `A${String(Number(lobbyMatch[1])).padStart(2, "0")}`
  }

  const legaCandidates = [
    "PRO GOLD",
    "PRO-GOLD",
    "PRO_GOLD",
    "PRO SILVER",
    "PRO-SILVER",
    "PRO_SILVER",
    "PRO AMA",
    "PRO-AMA",
    "PRO_AMA",
    "STAR",
    "ELITE",
    "AMA",
  ]

  for (const c of legaCandidates) {
    if (upper.includes(c)) {
      lega = normalizeUnionLeague(c)
      break
    }
  }

  return { gara, lobby, lega }
}

function mergeUnionMeta(texts: string[]): UnionMeta {
  let gara = ""
  let lobby = ""
  let lega = ""

  for (const text of texts) {
    const meta = extractUnionMetaFromText(text)
    if (!gara && meta.gara) gara = meta.gara
    if (!lobby && meta.lobby) lobby = meta.lobby
    if (!lega && meta.lega) lega = meta.lega
    if (gara && lobby && lega) break
  }

  return { gara, lobby, lega }
}

/* -------------------- QUALIFICA PARSER -------------------- */

type QualiRow = {
  pos: number
  pilota: string
  auto: string
  tempo: string
  distacco: string
}

function parseQualificaFromColumnText(rawText: string): QualiRow[] {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !/^POLE$/i.test(l))
    .filter((l) => !/^BEST\s*LAP$/i.test(l))
    .filter((l) => !/^DNF$/i.test(l))
    .filter((l) => !/^CHIUDI$/i.test(l))
    .filter((l) => !/^AVANTI$/i.test(l))
    .filter((l) => !/^ALTERNA/i.test(l))

  const findPosBlock = () => {
    const candidates = [1, 9]
    for (const startNum of candidates) {
      for (let i = 0; i < lines.length; i++) {
        if (lines[i] !== String(startNum)) continue
        let count = 0
        while (count < 8 && lines[i + count] === String(startNum + count)) count++
        if (count >= 2) return { start: i, end: i + count, startNum, count }
      }
    }
    return null
  }

  const posBlock = findPosBlock()
  if (!posBlock) return []

  const count = posBlock.count
  const positions = lines.slice(posBlock.start, posBlock.end).map((x) => Number(x))
  let cursor = posBlock.end

  const isName = (s: string) => {
    const t = String(s || "").trim()

    if (!t) return false
    if (/^\d+$/.test(t)) return false
    if (/^\+/.test(t)) return false
    if (t.includes(":")) return false
    if (/^[\-\.\s]+$/.test(t)) return false
    if (/DISTACCO|MIGLIOR|GRAN|UNION|Dragon|Chiudi|Avanti|Alterna|Blue Moon|Speedway|Interno/i.test(t)) return false
    if (isDefinitelyCarTokenForNameFilter(t)) return false

    return /[A-Za-z]/.test(t)
  }

  const names: string[] = []
  while (cursor < lines.length && names.length < count) {
    const s = lines[cursor]
    if (isName(s)) names.push(normalizePilot(s))
    cursor++
  }
  while (names.length < count) names.push("")

  const isCar = (s: string) => {
    const t = String(s || "").trim()
    if (!t) return false
    if (/MIGLIOR|DISTACCO|GRAN TURISMO|BLUE MOON|SPEEDWAY|INTERNO|CHIUDI|AVANTI|ALTERNA/i.test(t)) return false
    if (/^\d+$/.test(t)) return false
    if (/^\+/.test(t)) return false
    if (t.includes(":")) return false
    if (looksLikeKnownCarToken(t)) return true
    if (/GT3|LMS|RSR/i.test(t)) return true
    if (/'\d{2}/.test(t)) return true
    if (/\(\d{3}\)/.test(t)) return true
    if (/\bGr\.?4\b/i.test(t)) return true
    if (/\bTouring Car\b/i.test(t)) return true
    return false
  }

  const cars: string[] = []
  while (cursor < lines.length && cars.length < count) {
    const s = lines[cursor]
    if (isCar(s)) cars.push(normalizeKnownCar(s))
    cursor++
  }
  while (cars.length < count) cars.push("")

  const isLapTime = (s: string) => /^\d:\d{2}\.\d{3}$/.test(s)
  const times: string[] = []
  while (cursor < lines.length && times.length < count) {
    if (isLapTime(lines[cursor])) times.push(lines[cursor])
    cursor++
  }
  while (times.length < count) times.push("")

  let gapsRaw: string[] = []
  const idxDistacco = lines.findIndex((l) => /DISTACCO/i.test(l))
  if (idxDistacco !== -1) {
    const after = lines.slice(idxDistacco + 1)
    const gapRegex = /^(--\.\-\-\-|--\.\-\-\-|\+\d{2}\s*\.\s*\d{3}|\+\d+:\d{2}\.\d{3})$/
    gapsRaw = after
      .filter((l) => gapRegex.test(l))
      .map((l) => l.replace(/\s+/g, ""))
      .slice(0, count)
  }

  let distacchi: string[] = Array(count).fill("")
  const hasLeaderMarker = gapsRaw.some((g) => g.startsWith("--"))
  if (hasLeaderMarker) {
    const onlyPlus = gapsRaw.filter((g) => g.startsWith("+")).slice(0, Math.max(0, count - 1))
    distacchi = [""].concat(onlyPlus)
    while (distacchi.length < count) distacchi.push("")
    distacchi = distacchi.slice(0, count)
  } else {
    distacchi = gapsRaw.slice(0, count)
    while (distacchi.length < count) distacchi.push("")
  }

  const out: QualiRow[] = []
  for (let i = 0; i < count; i++) {
    const pos = positions[i]
    if (!pos || Number.isNaN(pos)) continue
    out.push({
      pos,
      pilota: names[i] ?? "",
      auto: normalizeKnownCar(cars[i] ?? ""),
      tempo: times[i] ?? "",
      distacco: distacchi[i] ?? "",
    })
  }
  return out
}

function extractQualiTimesByPos(rawText: string) {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)

  const out = new Map<number, string>()
  const timeRe = /\b(\d{1,2}:\d{2}\.\d{3})\b/

  let pendingPos: number | null = null

  for (const line of lines) {
    const clean = line.replace(/\s+/g, " ").trim()

    if (pendingPos != null) {
      const mt = clean.match(timeRe)
      if (mt) {
        if (!out.has(pendingPos)) out.set(pendingPos, mt[1])
        pendingPos = null
        continue
      }
    }

    const soloNum = clean.match(/^(\d{1,2})$/)
    if (soloNum) {
      const p = Number(soloNum[1])
      if (p >= 1 && p <= 16) pendingPos = p
      continue
    }

    const sameLine = clean.match(/^(\d{1,2})\b.*?(\d{1,2}:\d{2}\.\d{3})/)
    if (sameLine) {
      const p = Number(sameLine[1])
      if (p >= 1 && p <= 16 && !out.has(p)) {
        out.set(p, sameLine[2])
      }
      pendingPos = null
      continue
    }

    const posOnlyStart = clean.match(/^(\d{1,2})\b/)
    if (posOnlyStart) {
      const p = Number(posOnlyStart[1])
      if (p >= 1 && p <= 16) pendingPos = p
    }
  }

  return out
}

function mergeQualiPosMaps(...maps: Map<number, string>[]) {
  const out = new Map<number, string>()
  for (const m of maps) {
    for (const [pos, tempo] of m.entries()) {
      if (!out.has(pos) && tempo) out.set(pos, tempo)
    }
  }
  return out
}

function mergeQualiRowSafe(map: Map<number, QualiRow>, incoming: QualiRow) {
  const existing = map.get(incoming.pos)

  const cleanedIncoming: QualiRow = {
    ...incoming,
    pilota: normalizePilot(incoming.pilota || ""),
    auto: normalizeKnownCar(incoming.auto || ""),
    tempo: (incoming.tempo || "").trim(),
    distacco: (incoming.distacco || "").trim(),
  }

  if (!existing) {
    map.set(incoming.pos, cleanedIncoming)
    return
  }

  const merged: QualiRow = {
    pos: existing.pos,
    pilota:
      existing.pilota && existing.pilota.trim().length > 0
        ? existing.pilota
        : cleanedIncoming.pilota,
    auto:
      existing.auto && existing.auto.trim().length > 0
        ? existing.auto
        : cleanedIncoming.auto,
    tempo:
      existing.tempo && existing.tempo.trim().length > 0
        ? existing.tempo
        : cleanedIncoming.tempo,
    distacco:
      existing.distacco && existing.distacco.trim().length > 0
        ? existing.distacco
        : cleanedIncoming.distacco,
  }

  map.set(incoming.pos, merged)
}

/* -------------------- GARA PARSER -------------------- */

type RaceRow = {
  pos: number
  pilota: string
  auto: string
  tempoTotale: string
  distacco: string
  migliorGiro: string
}

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
    .map((l) => l.trim())
    .filter(Boolean)

  const startCandidates = [1, 9]
  let startIndex = -1
  let startNum = 0
  for (const s of startCandidates) {
    const idx = lines.findIndex((l) => l === String(s))
    if (idx !== -1) {
      startIndex = idx
      startNum = s
      break
    }
  }
  if (startIndex === -1) return []

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

  const lastPos = positions[positions.length - 1]
  const lastPosIdx = lines.findIndex((l, i) => i >= startIndex && l === String(lastPos))
  cursor = lastPosIdx === -1 ? startIndex : lastPosIdx + 1

  const n = positions.length

  const idxTempo = lines.findIndex((l) => /^TEMPO$/i.test(l) || /TEMPO/i.test(l))
  const idxPen = lines.findIndex((l) => /PENALIT/i.test(l))
  const idxBest = lines.findIndex((l) => /MIGLIOR\s+GIRO/i.test(l))

  const stopAnyHeader = /^(TEMPO|PENALITÀ|PENALITA|MIGLIOR\s+GIRO)$/i

  const isName = (s: string) => {
    const t = String(s || "").trim()

    if (!t) return false
    if (/^\d+$/.test(t)) return false
    if (stopAnyHeader.test(t)) return false
    if (t.includes(":")) return false
    if (/^\+/.test(t)) return false
    if (/^[\-\.\s]+$/.test(t)) return false
    if (isDefinitelyCarTokenForNameFilter(t)) return false

    return /[A-Za-z]/.test(t)
  }

  const names: string[] = []
  while (cursor < lines.length && names.length < n) {
    const s = lines[cursor]
    if (isName(s)) names.push(normalizePilot(s.replace(/\s+/g, "_")))
    cursor++
    if (idxTempo !== -1 && cursor >= idxTempo) break
  }
  while (names.length < n) names.push("")

  const carsEnd = idxTempo !== -1 ? idxTempo : idxPen !== -1 ? idxPen : idxBest !== -1 ? idxBest : lines.length
  const carTokens = lines
    .slice(cursor, carsEnd)
    .filter((s) => !stopAnyHeader.test(s))
    .filter((s) => !/Blue Moon|Speedway|Interno|Chiudi|Avanti|Alterna/i.test(s))

  const looksLikeModel = (s: string) => {
    const t = normalizeCarLoose(s)
    return (
      /\b(gt3|rsr|lms|evo)\b/i.test(t) ||
      /\br8\b/i.test(t) ||
      /\b911\b/i.test(t) ||
      t.includes("gr.4") ||
      t.includes("gr4") ||
      t.includes("gt4") ||
      t.includes("clubsport") ||
      t.includes("trophy") ||
      t.includes("italia") ||
      t.includes("elantra") ||
      t.includes("nsx") ||
      t.includes("huracan") ||
      t.includes("huracán") ||
      t.includes("mazda3") ||
      t.includes("mazda 3") ||
      t.includes("gtr") ||
      t.includes("gt-r") ||
      t.includes("650s") ||
      t.includes("atenza") ||
      t.includes("silvia") ||
      t.includes("touring car") ||
      t.includes("tt cup") ||
      t === "4c" ||
      t.startsWith("4c ") ||
      t.includes("supra") ||
      t.includes("amg") ||
      t.includes("vantage") ||
      t.includes("vision gran turismo") ||
      t.includes("tomahawk") ||
      t.includes("lm55") ||
      t.includes("r18") ||
      t.includes("919") ||
      t.includes("ts050") ||
      t.includes("gr010") ||
      t.includes("hybrid")
    )
  }

  const hasId = (s: string) =>
    /\(\d{3}\)/.test(s) || /'\d{2}\b/.test(s) || /\b\d{2}\b/.test(s) || /\bGr\.?4\b/i.test(s)

  const isCompleteCar = (s: string) => looksLikeModel(s) && hasId(s)

  const looksLikeCarStart = (tok: string) => {
    const t = normalizeCarLoose(tok)
    return (
      t === "911" ||
      t === "r8" ||
      /^911\b/.test(t) ||
      /^r8\b/.test(t) ||
      /\blms\b/i.test(t) ||
      /\brsr\b/i.test(t) ||
      /\bgt3\b/i.test(t) ||
      t.includes("cayman") ||
      t.includes("megane") ||
      t.includes("mégane") ||
      t.includes("swift") ||
      t.includes("458") ||
      t.includes("tt") ||
      t === "4c" ||
      t.includes("elantra") ||
      t.includes("huracan") ||
      t.includes("huracán") ||
      t.includes("nsx") ||
      t.includes("silvia") ||
      t.includes("atenza") ||
      t.includes("mazda3") ||
      t.includes("mazda 3") ||
      t.includes("gt-r") ||
      t.includes("gtr") ||
      t.includes("650s") ||
      t.includes("supra") ||
      t.includes("amg") ||
      t.includes("vantage") ||
      t.includes("vision") ||
      t.includes("tomahawk") ||
      t.includes("lm55") ||
      t.includes("r18") ||
      t.includes("919") ||
      t.includes("ts050") ||
      t.includes("gr010") ||
      t.includes("hybrid")
    )
  }

  const cars: string[] = []
  let currentParts: string[] = []

  const flush = () => {
    const raw = cleanCar(currentParts.join(" "))
    cars.push(raw)
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

  let carsFixed = [...cars]

  if (carsFixed.length > n && carsFixed.length >= 2) {
    const first = cleanCar(carsFixed[0] ?? "")
    carsFixed = [first, ...carsFixed.slice(carsFixed.length - (n - 1))]
  }

  while (carsFixed.length < n) carsFixed.push("")
  if (carsFixed.length > n) carsFixed.length = n

  const tempoRaw = takeBlock(lines, idxTempo, /^(PENALITÀ|PENALITA|MIGLIOR\s+GIRO)$/i, n)

  const bestRaw = takeBlock(lines, idxBest, /^(TEMPO|PENALITÀ|PENALITA)$/i, n).map((s) => {
    const m = s.match(/^(\d:\d{2}\.\d{3}|--:--\.\-\-)/)
    return (m?.[1] ?? s).trim()
  })
  const best = bestRaw.map((s) => (s.startsWith("--") ? "" : s))

  const out: RaceRow[] = []

  for (let i = 0; i < n; i++) {
    const pos = positions[i]
    const pilota = names[i] ?? ""

    const autoRaw = cleanCar(carsFixed[i] ?? "")
    let auto = normalizeKnownCar(autoRaw)

    if (i === 0) {
      const knownMatches = KNOWN_CARS.filter((known) => autoRaw.includes(known))
      if (knownMatches.length >= 2) {
        auto = pickFirstKnownCar(autoRaw)
      }
    }

    const tempoCell = (tempoRaw[i] ?? "").trim()

    let tempoTotale = ""
    let distacco = ""

    if (pos === 1) {
  if (/^(?:\d+:)?\d{1,2}:\d{2}\.\d{3}$/.test(tempoCell)) tempoTotale = tempoCell
  distacco = ""
} else {
  if (tempoCell.startsWith("+")) {
    distacco = tempoCell.replace(/\+\s*/g, "+").trim()
  } else if (/in\s+gara/i.test(tempoCell)) {
    distacco = "BOX"
  } else {
    const giroMatch = tempoCell.match(/^(\d+)\s*giro/i) || tempoCell.match(/^(\d+)\s*giri/i)
    if (giroMatch) distacco = `${giroMatch[1]}giro`
    else if (/non\s+finito/i.test(tempoCell)) distacco = "DNF"
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

/* -------------------- Classification -------------------- */

function classifyText(text: string): "quali" | "race" | "unknown" {
  const t = (text || "").toUpperCase()
  const isQuali = t.includes("DISTACCO") && t.includes("MIGLIOR GIRO")
  const isRace = t.includes("TEMPO") && (t.includes("PENALIT") || t.includes("PENALITA")) && t.includes("MIGLIOR GIRO")
  if (isQuali && !isRace) return "quali"
  if (isRace) return "race"
  if (t.includes("DISTACCO")) return "quali"
  if (t.includes("PENALIT") || t.includes("NON FINITO") || t.includes("IN GARA")) return "race"
  return "unknown"
}

/* -------------------- Final CSV -------------------- */

type ExtractRow = {
  posGara: number
  pilota: string
  auto: string
  tempoTotaleGara: string
  distaccoDalPrimo: string
  migliorGiroGara: string
  tempoQualifica: string
  pole: string
}

type UnionCsvRow = {
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

function toUnionCsv(rows: UnionCsvRow[]) {
  const header = ["#", "Nome pilota", "Auto", "Distacchi", "-PP-", "-GV-", "Gara", "Lobby", "Lega"]
  const body = rows
    .map((r) => [
      r.posizione,
      r.nomePilota,
      r.auto,
      r.distacchi,
      r.pp,
      r.gv,
      r.gara,
      r.lobby,
      r.lega,
    ])
    .map((arr) => arr.map(csvEscape).join(","))
    .join("\n")
  return header + "\n" + body
}

function formatGapMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0

  const totalSeconds = Math.floor(ms / 1000)
  const milli = ms % 1000
  const ss = totalSeconds % 60
  const mm = Math.floor(totalSeconds / 60)

  const pad2 = (n: number) => String(n).padStart(2, "0")
  const pad3 = (n: number) => String(n).padStart(3, "0")

  if (mm > 0) return `+${mm}:${pad2(ss)}.${pad3(milli)}`
  return `+${ss}.${pad3(milli)}`
}

function synthesizeRaceTimesForCsv(rows: ExtractRow[]): ExtractRow[] {
  if (!rows.length) return rows

  const out = rows.map((r) => ({ ...r }))

  let lastRealGapMs = 0
  let dnfCount = 0
  let boxCount = 0

  for (const r of out) {
    if (r.posGara === 1) continue

    const d = (r.distaccoDalPrimo || "").trim()

    if (d.startsWith("+")) {
      const gapMs = parseGapToMs(d)
      if (gapMs != null) {
        lastRealGapMs = gapMs
        continue
      }
    }

    if (/^\d+giro$/i.test(d)) {
      lastRealGapMs += 10000
      r.distaccoDalPrimo = formatGapMs(lastRealGapMs)
      continue
    }

    if (d.toUpperCase() === "DNF") {
      const abs = 60 * 60 * 1000 + dnfCount * 60 * 1000
      dnfCount++
      r.distaccoDalPrimo = formatMsToRaceTime(abs)
      continue
    }

    if (d.toUpperCase() === "BOX") {
      const abs = 2 * 60 * 60 * 1000 + boxCount * 60 * 1000
      boxCount++
      r.distaccoDalPrimo = formatMsToRaceTime(abs)
      continue
    }
  }

  return out
}

function findQualiByPilotLoose(pilota: string, rows: QualiRow[]) {
  for (const q of rows) {
    if (betterPilotMatch(q.pilota, pilota)) return q
  }
  return undefined
}

function findFastestLapPilot(rows: ExtractRow[]) {
  let bestPilot = ""
  let bestMs: number | null = null

  for (const r of rows) {
    const ms = parseLapTimeToMs(r.migliorGiroGara || "")
    if (ms == null) continue
    if (bestMs == null || ms < bestMs) {
      bestMs = ms
      bestPilot = r.pilota || ""
    }
  }

  return bestPilot
}

function buildUnionDistaccoValue(r: ExtractRow) {
  if (r.posGara === 1) return (r.tempoTotaleGara || "").trim()
  const d = (r.distaccoDalPrimo || "").trim()
  if (!d) return ""
  return d.toUpperCase() === "BOX" ? "BOX" : d
}

/* -------------------- Route Handler -------------------- */

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const files = formData.getAll("files").filter(Boolean) as File[]

    if (!files.length) {
      return Response.json({ error: "Nessun file ricevuto" }, { status: 400 })
    }

    const apiKey = process.env.OCR_API_KEY || process.env.NEXT_PUBLIC_OCR_API_KEY
    if (!apiKey) {
      return Response.json({ error: "Manca OCR_API_KEY in env" }, { status: 500 })
    }

    const debugChunks: string[] = []
    const allTexts: string[] = []
    const qualiRowsMerged = new Map<number, QualiRow>()
    const raceRowsMerged = new Map<number, RaceRow>()
    const qualiTexts: string[] = []
    let polePilot = ""

    for (let idx = 0; idx < files.length; idx++) {
      const f = files[idx]
      const input = Buffer.from(await f.arrayBuffer())
      const prepped = await preprocessForOcr(input)

      const ocr = await ocrWithRetry(apiKey, prepped)
      if (!ocr.ok) {
        return Response.json(
          {
            error: "OCR.space error",
            httpStatus: ocr.res.status,
            ocrStatus: {
              IsErroredOnProcessing: ocr.data?.IsErroredOnProcessing,
              ErrorMessage: ocr.data?.ErrorMessage,
              ErrorDetails: ocr.data?.ErrorDetails,
            },
          },
          { status: 502 }
        )
      }

      const text = ocr.text
      allTexts.push(text)

      const kind = classifyText(text)
      const U = (text || "").toUpperCase()
      const hasRaceHeaders = U.includes("TEMPO") || U.includes("PENALIT") || U.includes("PENALITA")

      debugChunks.push(`FILE #${idx + 1} (${kind.toUpperCase()}) — ${f.name}\n\n${text}`)

      if (kind === "quali") {
        qualiTexts.push(text)

        const part = parseQualificaFromColumnText(text)
        if (!polePilot) {
          const p1 = part.find((r) => r.pos === 1 && r.pilota)
          if (p1?.pilota) polePilot = p1.pilota
        }
        for (const r of part) {
          mergeQualiRowSafe(qualiRowsMerged, r)
        }

        const preppedAlt = await preprocessForOcrQualiAlt(input)
        const ocrAlt = await ocrWithRetry(apiKey, preppedAlt)
        if (ocrAlt.ok) {
          const textAlt = ocrAlt.text
          qualiTexts.push(textAlt)
          allTexts.push(textAlt)

          const partAlt = parseQualificaFromColumnText(textAlt)
          if (!polePilot) {
            const p1Alt = partAlt.find((r) => r.pos === 1 && r.pilota)
            if (p1Alt?.pilota) polePilot = p1Alt.pilota
          }

          for (const r of partAlt) {
            mergeQualiRowSafe(qualiRowsMerged, r)
          }

          debugChunks.push(`FILE #${idx + 1} QUALI ALT — ${f.name}\n\n${textAlt}`)
        }

        const preppedTimes = await preprocessForOcrQualiTimesOnly(input)
        const ocrTimes = await ocrWithRetry(apiKey, preppedTimes)
        if (ocrTimes.ok) {
          const textTimes = ocrTimes.text
          qualiTexts.push(textTimes)
          allTexts.push(textTimes)
          debugChunks.push(`FILE #${idx + 1} QUALI TIMES ONLY — ${f.name}\n\n${textTimes}`)
        }
      } else if (kind === "race") {
        const part = parseGaraFromColumnText(text)
        for (const r of part) {
          raceRowsMerged.set(r.pos, { ...r, auto: normalizeKnownCar(r.auto) })
        }
      } else {
        const q = parseQualificaFromColumnText(text)
        const g = hasRaceHeaders ? parseGaraFromColumnText(text) : []

        if (!hasRaceHeaders) {
          qualiTexts.push(text)

          if (!polePilot) {
            const p1 = q.find((r) => r.pos === 1 && r.pilota)
            if (p1?.pilota) polePilot = p1.pilota
          }

          for (const r of q) {
            mergeQualiRowSafe(qualiRowsMerged, r)
          }

          const preppedAlt = await preprocessForOcrQualiAlt(input)
          const ocrAlt = await ocrWithRetry(apiKey, preppedAlt)
          if (ocrAlt.ok) {
            const textAlt = ocrAlt.text
            qualiTexts.push(textAlt)
            allTexts.push(textAlt)

            const partAlt = parseQualificaFromColumnText(textAlt)
            if (!polePilot) {
              const p1Alt = partAlt.find((r) => r.pos === 1 && r.pilota)
              if (p1Alt?.pilota) polePilot = p1Alt.pilota
            }

            for (const r of partAlt) {
              mergeQualiRowSafe(qualiRowsMerged, r)
            }

            debugChunks.push(`FILE #${idx + 1} QUALI ALT UNKNOWN — ${f.name}\n\n${textAlt}`)
          }

          const preppedTimes = await preprocessForOcrQualiTimesOnly(input)
          const ocrTimes = await ocrWithRetry(apiKey, preppedTimes)
          if (ocrTimes.ok) {
            const textTimes = ocrTimes.text
            qualiTexts.push(textTimes)
            allTexts.push(textTimes)
            debugChunks.push(`FILE #${idx + 1} QUALI TIMES ONLY UNKNOWN — ${f.name}\n\n${textTimes}`)
          }
        } else if (g.length >= q.length && g.length > 0) {
          for (const r of g) {
            raceRowsMerged.set(r.pos, { ...r, auto: normalizeKnownCar(r.auto) })
          }
        } else {
          qualiTexts.push(text)

          if (!polePilot) {
            const p1 = q.find((r) => r.pos === 1 && r.pilota)
            if (p1?.pilota) polePilot = p1.pilota
          }

          for (const r of q) {
            mergeQualiRowSafe(qualiRowsMerged, r)
          }

          const preppedAlt = await preprocessForOcrQualiAlt(input)
          const ocrAlt = await ocrWithRetry(apiKey, preppedAlt)
          if (ocrAlt.ok) {
            const textAlt = ocrAlt.text
            qualiTexts.push(textAlt)
            allTexts.push(textAlt)

            const partAlt = parseQualificaFromColumnText(textAlt)
            if (!polePilot) {
              const p1Alt = partAlt.find((r) => r.pos === 1 && r.pilota)
              if (p1Alt?.pilota) polePilot = p1Alt.pilota
            }

            for (const r of partAlt) {
              mergeQualiRowSafe(qualiRowsMerged, r)
            }

            debugChunks.push(`FILE #${idx + 1} QUALI ALT FALLBACK — ${f.name}\n\n${textAlt}`)
          }

          const preppedTimes = await preprocessForOcrQualiTimesOnly(input)
          const ocrTimes = await ocrWithRetry(apiKey, preppedTimes)
          if (ocrTimes.ok) {
            const textTimes = ocrTimes.text
            qualiTexts.push(textTimes)
            allTexts.push(textTimes)
            debugChunks.push(`FILE #${idx + 1} QUALI TIMES ONLY FALLBACK — ${f.name}\n\n${textTimes}`)
          }
        }
      }
    }

    const qualiRows = Array.from(qualiRowsMerged.values()).sort((a, b) => a.pos - b.pos)
    const raceRows = Array.from(raceRowsMerged.values()).sort((a, b) => a.pos - b.pos)

    if (!raceRows.length) {
      return Response.json(
        {
          error: "Non ho trovato nessuno screen GARA (manca TEMPO/PENALITÀ/MIGLIOR GIRO nel testo OCR).",
          debugText: debugChunks.join("\n\n===== NEXT FILE =====\n\n"),
        },
        { status: 400 }
      )
    }

    const qualiByPilot = new Map<string, QualiRow>()
    for (const q of qualiRows) {
      if (!q.pilota) continue
      qualiByPilot.set(pilotKey(q.pilota), q)
    }

    const qualiByPosDirect = new Map<number, QualiRow>()
    for (const q of qualiRows) {
      qualiByPosDirect.set(q.pos, q)
    }

    const qualiPosMaps = qualiTexts.map((t) => extractQualiTimesByPos(t))
    const qualiByPos = mergeQualiPosMaps(...qualiPosMaps)

    const outBase: ExtractRow[] = raceRows.map((r) => {
      const k = r.pilota ? pilotKey(r.pilota) : ""

      const qExact = k ? qualiByPilot.get(k) : undefined
      const qLoose = !qExact && r.pilota ? findQualiByPilotLoose(r.pilota, qualiRows) : undefined
      const qPos = qualiByPosDirect.get(r.pos)

      const tempoQualifica =
        (qExact?.tempo ?? "").trim() ||
        (qLoose?.tempo ?? "").trim() ||
        (qPos?.tempo ?? "").trim() ||
        (qualiByPos.get(r.pos) ?? "").trim() ||
        ""

      const auto = normalizeKnownCar(
        (qExact?.auto || "").trim() ||
        (qLoose?.auto || "").trim() ||
        (qPos?.auto || "").trim() ||
        (r.auto || "").trim() ||
        ""
      )

      const isPole =
        !!polePilot &&
        !!r.pilota &&
        betterPilotMatch(r.pilota, polePilot)

      return {
        posGara: r.pos,
        pilota: r.pilota ?? "",
        auto,
        tempoTotaleGara: r.tempoTotale ?? "",
        distaccoDalPrimo: r.distacco ?? "",
        migliorGiroGara: r.migliorGiro ?? "",
        tempoQualifica,
        pole: isPole ? "POLE" : "",
      }
    })

    const outTable = outBase.map((r) => ({
      ...r,
      tempoTotaleGara: (r.distaccoDalPrimo || "").toUpperCase() === "BOX" ? "BOX" : r.tempoTotaleGara,
    }))

    const outCsvRows = synthesizeRaceTimesForCsv(outBase)

    const unionMeta = mergeUnionMeta(allTexts)
    const fastestLapPilot = findFastestLapPilot(outBase)

    const unionRows: UnionCsvRow[] = outBase.map((r) => {
      const isPole =
        !!polePilot &&
        !!r.pilota &&
        betterPilotMatch(r.pilota, polePilot)

      const isFastest =
        !!fastestLapPilot &&
        !!r.pilota &&
        betterPilotMatch(r.pilota, fastestLapPilot)

      let previewDistacco = ""
      if (r.posGara === 1) {
        previewDistacco = (r.tempoTotaleGara || "").trim()
      } else if (/^\d+giro$/i.test((r.distaccoDalPrimo || "").trim())) {
        previewDistacco = "DOPPIATO"
      } else {
        previewDistacco = (r.distaccoDalPrimo || "").trim()
      }

      return {
        posizione: r.posGara,
        nomePilota: r.pilota ?? "",
        auto: r.auto ?? "",
        distacchi: previewDistacco,
        pp: isPole ? "PP" : "",
        gv: isFastest ? "GV" : "",
        gara: unionMeta.gara,
        lobby: unionMeta.lobby,
        lega: unionMeta.lega,
      }
    })

    const unionCsvRows: UnionCsvRow[] = outCsvRows.map((r) => {
      const isPole =
        !!polePilot &&
        !!r.pilota &&
        betterPilotMatch(r.pilota, polePilot)

      const isFastest =
        !!fastestLapPilot &&
        !!r.pilota &&
        betterPilotMatch(r.pilota, fastestLapPilot)

      const distacchiCsv =
        r.posGara === 1
          ? (r.tempoTotaleGara || "").trim()
          : (r.distaccoDalPrimo || "").trim()

      return {
        posizione: r.posGara,
        nomePilota: r.pilota ?? "",
        auto: r.auto ?? "",
        distacchi: distacchiCsv,
        pp: isPole ? "PP" : "",
        gv: isFastest ? "GV" : "",
        gara: unionMeta.gara,
        lobby: unionMeta.lobby,
        lega: unionMeta.lega,
      }
    })

    const csv = toUnionCsv(unionCsvRows)

    const qualiFound = outTable.filter((r) => (r.tempoQualifica || "").trim().length > 0).length
    const qualiMissing = Math.max(0, outTable.length - qualiFound)
    const qualiComplete = qualiMissing === 0

    const warning = qualiComplete
      ? ""
      : `⚠️ Qualifiche incomplete: trovate ${qualiFound} su ${outTable.length}. Controlla e completa manualmente i tempi mancanti prima dell’uso definitivo del CSV.`

    return Response.json({
      tool: "Albixximo Union Tools — Union CSV Extractor",
      count: outTable.length,
      rows: outTable,
      unionRows,
      unionMeta,
      csv,
      polePilot,
      fastestLapPilot,
      detectedPoleDriver: polePilot || "",
      detectedBestLapDriver: fastestLapPilot || "",
      detectedRaceOrder: outBase.map((r) => r.pilota || ""),
      detectedRaceCars: outBase.map((r) => r.auto || ""),
      warning,
      stats: {
        qualiRows: qualiRows.length,
        raceRows: raceRows.length,
        filesReceived: files.length,
        qualiTexts: qualiTexts.length,
        qualiByPos: qualiByPos.size,
        qualiFound,
        qualiMissing,
        qualiComplete,
        gara: unionMeta.gara,
        lobby: unionMeta.lobby,
        lega: unionMeta.lega,
      },
      debugText: debugChunks.join("\n\n===== NEXT FILE =====\n\n"),
    })
  } catch (err: any) {
    const msg = String(err?.name || "") === "AbortError" ? "Timeout chiamata OCR.space" : "Errore server"
    return Response.json(
      { error: msg, details: String(err?.stack || err?.message || err) },
      { status: 500 }
    )
  }
}