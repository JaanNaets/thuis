// Uitrollen enkel vanaf main: Workers Builds bouwt ook andere takken (WORKERS_CI_BRANCH), en die mogen nooit de
// databank online migreren of de app vervangen. Lokaal (zonder die variabele) gaat het gewoon door.
const branch = process.env.WORKERS_CI_BRANCH;
if (branch && branch !== "main") {
  console.error(`Geen uitrol vanaf de tak "${branch}": enkel main gaat online.`);
  process.exit(1);
}
