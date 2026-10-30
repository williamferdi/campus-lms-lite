const dateTimeFmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
const dateFmt = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" });
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

export const toDate = (v: string | Date | null | undefined) => (v ? (v instanceof Date ? v : new Date(v)) : null);

export const formatDateTime = (v: string | Date | null | undefined) => {
  const d = toDate(v);
  return d ? dateTimeFmt.format(d) : "—";
};
export const formatDate = (v: string | Date | null | undefined) => {
  const d = toDate(v);
  return d ? dateFmt.format(d) : "—";
};
export const formatTime = (v: string | Date | null | undefined) => {
  const d = toDate(v);
  return d ? timeFmt.format(d) : "";
};

export function relative(v: string | Date | null | undefined): string {
  const d = toDate(v);
  if (!d) return "";
  const diff = d.getTime() - Date.now();
  const abs = Math.abs(diff);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["day", 86_400_000],
    ["hour", 3_600_000],
    ["minute", 60_000],
  ];
  for (const [unit, ms] of units) if (abs >= ms) return rtf.format(Math.round(diff / ms), unit);
  return "just now";
}

/** ISO string -> value for <input type="datetime-local"> in the user's local time. */
export function toLocalInput(v: string | null | undefined): string {
  const d = toDate(v);
  if (!d) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** <input type="datetime-local"> value -> ISO string (or null when empty). */
export const fromLocalInput = (v: string): string | null => (v ? new Date(v).toISOString() : null);

export const formatPoints = (n: number | null | undefined) => (n === null || n === undefined ? "—" : Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, ""));

export const formatPercent = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${formatPoints(n)}%`);

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export const roleLabel = (r: string) =>
  ({ admin: "Administrator", instructor: "Instructor", student: "Student", teacher: "Teacher", ta: "Teaching assistant" })[r] ?? r;

export const plural = (n: number, word: string, pluralWord = `${word}s`) => `${n} ${n === 1 ? word : pluralWord}`;
