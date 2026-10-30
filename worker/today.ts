/** De datum van vandaag in België (YYYY-MM-DD): daar wonen de mensen van deze app, en daar is het 's morgens. */
export const brusselsToday = (now = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Brussels", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
