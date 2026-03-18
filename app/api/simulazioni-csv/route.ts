import { NextResponse } from "next/server";

export const runtime = "nodejs";

/* ===============================
   CSV / SHEETS UTIL
=================================*/
function csvEscape(value: unknown) {
  const s = String(value ?? "");
  if (/[;"\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function normalizeName(s: string) {
  return s.replace(/\s+/g, " ").replace(/[|]/g, "I").trim();
}

function parseTimeToMs(t: string): number | null {
  const s = (t ?? "").trim();
  if (!s) return null;
  const parts = s.split(",");
  const base = parts[0];
  const ms = parts[1] ? Number(parts[1]) : 0;
  if (Number.isNaN(ms)) return null;

  const chunks = base.split(":").map((x) => Number(x));
  if (chunks.some((n) => Number.isNaN(n))) return null;

  if (chunks.length === 2) {
    const [mm, ss] = chunks;
    return (mm * 60 + ss) * 1000 + ms;
  }
  if (chunks.length === 3) {
    const [hh, mm, ss] = chunks;
    return (hh * 3600 + mm * 60 + ss) * 1000 + ms;
  }
  return null;
}

/* ===============================
   MODELS
=================================*/
type ScreenType = "QUALIFICA" | "GARA" | "UNKNOWN";

type ParsedRow = {
  pos?: number;
  pilota?: string;
  auto?: string;

  tempoQualifica?: string;
  tempoTotaleGara?: string;
  distaccoDalPrimo?: string;
  migliorGiroGara?: string;
};

type ParsedDoc = {
  name: string;
  type: ScreenType;
  rows: ParsedRow[];
};

type UnionRow = {
  posGara: number | "NF" | "";
  pilota: string;
  auto: string;
  tempoTotaleGara: string;
  distaccoDalPrimo: string;
  migliorGiroGara: string;
  tempoQualifica: string;
  gv: "" | "GV";
  pp: "" | "PP";
  pgv: "" | "PGV";
};

function emptyRow(name: string): UnionRow {
  return {
    posGara: "",
    pilota: name,
    auto: "",
    tempoTotaleGara: "",
    distaccoDalPrimo: "",
    migliorGiroGara: "",
    tempoQualifica: "",
    gv: "",
    pp: "",
    pgv: "",
  };
}

/* ===============================
   BUILD UNION CSV
=================================*/
function buildUnionCsv(lega: string, lobby: string, rows: UnionRow[]) {
  const header = [
    "Pos Gara",
    "Pilota",
    "Auto",
    "TempoTotaleGara (hh:mm:ss,000)",
    "DistaccoDalPrimo (mm:ss,000)",
    "MigliorGiroGara",
    "Tempo Qualifica",
    "GV",
    "PP",
    "PGV",
    "Penalità",
    "TempoTotale",
    "PosFinale",
    "Pilota (replica)",
    "Lega",
    "Lobby",
  ]
    .map(csvEscape)
    .join(";");

  const body = rows
    .map((r, idx) => {
      const rowIndex = idx + 2;

      const tempoTotaleFormula =
        `=IF(D${rowIndex}="";"";IF(D${rowIndex}="NF";"NF";D${rowIndex}))`;

      const posFinaleFormula =
        `=IF(L${rowIndex}="";"";IF(L${rowIndex}="NF";"NF";IFERROR(RANK.EQ(L${rowIndex};$L$2:$L$17;1);"")))`;

      const cols = [
        r.posGara,
        r.pilota,
        r.auto,
        r.tempoTotaleGara,
        r.distaccoDalPrimo,
        r.migliorGiroGara,
        r.tempoQualifica,
        r.gv,
        r.pp,
        r.pgv,
        "", // penalità: sempre vuoto (penalità rosse escluse)
        tempoTotaleFormula,
        posFinaleFormula,
        r.pilota,
        lega,
        lobby,
      ];

      return cols.map(csvEscape).join(";");
    })
    .join("\r\n");

  return header + "\r\n" + body;
}

/* ===============================
   POST
=================================*/
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body) return new NextResponse("Body JSON non valido", { status: 400 });

  const lega = String(body.lega ?? "STAR");
  const lobby = String(body.lobby ?? "A1");

  const docs: ParsedDoc[] = Array.isArray(body.docs) ? body.docs : [];
  if (docs.length === 0) return new NextResponse("Nessun doc ricevuto.", { status: 400 });

  const map = new Map<string, UnionRow>();
  const upsert = (name: string) => {
    const key = normalizeName(name).toLowerCase();
    if (!map.has(key)) map.set(key, emptyRow(normalizeName(name)));
    return map.get(key)!;
  };

  // merge
  for (const doc of docs) {
    for (const rr of doc.rows ?? []) {
      const pil = normalizeName(String(rr.pilota ?? "")).trim();
      if (!pil) continue;

      const row = upsert(pil);
      row.pilota = pil;

      const auto = normalizeName(String(rr.auto ?? "")).trim();
      if (auto && !row.auto) row.auto = auto;

      if (typeof rr.pos === "number" && !Number.isNaN(rr.pos)) row.posGara = rr.pos;

      if (rr.tempoQualifica) row.tempoQualifica = String(rr.tempoQualifica);
      if (rr.tempoTotaleGara) row.tempoTotaleGara = String(rr.tempoTotaleGara);
      if (rr.distaccoDalPrimo) row.distaccoDalPrimo = String(rr.distaccoDalPrimo);
      if (rr.migliorGiroGara) row.migliorGiroGara = String(rr.migliorGiroGara);
    }
  }

  const rows = Array.from(map.values());

  // PP (min tempo qualifica)
  const qualTimes = rows
    .map((r) => ({ r, ms: r.tempoQualifica ? parseTimeToMs(r.tempoQualifica) : null }))
    .filter((x) => x.ms !== null) as { r: UnionRow; ms: number }[];

  if (qualTimes.length) {
    qualTimes.sort((a, b) => a.ms - b.ms);
    qualTimes[0].r.pp = "PP";
  }

  // GV (min miglior giro gara)
  const raceLaps = rows
    .map((r) => ({ r, ms: r.migliorGiroGara ? parseTimeToMs(r.migliorGiroGara) : null }))
    .filter((x) => x.ms !== null) as { r: UnionRow; ms: number }[];

  if (raceLaps.length) {
    raceLaps.sort((a, b) => a.ms - b.ms);
    raceLaps[0].r.gv = "GV";
  }

  // PGV se stesso pilota ha PP e GV
  for (const r of rows) {
    if (r.pp && r.gv) {
      r.pgv = "PGV";
      r.pp = "";
      r.gv = "";
    }
  }

  // sort: pos se presente, altrimenti nome
  rows.sort((a, b) => {
    const ap = typeof a.posGara === "number" ? a.posGara : 999;
    const bp = typeof b.posGara === "number" ? b.posGara : 999;
    if (ap !== bp) return ap - bp;
    return a.pilota.localeCompare(b.pilota);
  });

  const csv = buildUnionCsv(lega, lobby, rows);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename=SIMULAZIONI_PRT_${lega}_${lobby}.csv`,
    },
  });
}