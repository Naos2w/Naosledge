export function formatDate(date?: string | null, withYear = true) {
  if (!date) return "尚未發布";
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T12:00:00+08:00`) : new Date(date);
  if (Number.isNaN(parsed.getTime())) return "未知日期";
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: withYear ? "numeric" : undefined,
    month: "short",
    day: "numeric",
  }).format(parsed);
}

export function todayTaipei() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function slugify(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 120);
}

export function readingMinutes(text: string) {
  return Math.max(1, Math.ceil(text.length / 450));
}
