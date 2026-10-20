# Thuis: werkafspraken

Huishoud-app op Cloudflare (Workers, D1, R2). Alles in het Nederlands (Vlaams, "je"): code-commentaar, teksten,
commits en uitleg.

## Ontwerp: lees eerst het stijlboek

**Lees `STIJLBOEK.md` voor je een scherm, component, formulier of tekst toevoegt of verandert, en volg het.**

- Gebruik de bestaande componenten (`src/components/`) en tokens (`:root` in `src/styles.css`); verzin geen
  nieuwe kleuren, maten of patronen.
- Loop de checklist onderaan het stijlboek af voor je iets oplevert.
- Introduceer je toch een nieuw patroon, bouw het dan als component en voeg het toe aan `STIJLBOEK.md`.
- Bekijk het resultaat op gsm (390px) en tablet (1280px en 820px) voor je het oplevert.

## Code

- Bedragen in cent, datums als `YYYY-MM-DD`. Opmaak via `src/format.ts`.
- Schemawijziging = nieuw bestand in `migrations/` (nooit een bestaand aanpassen); eerst lokaal testen met
  `npm run db:migrate:local`. Een push naar `main` rolt uit en voert de migratie online uit.
- Gedeelde types en logica in `shared/`, met tests in `test/` (`npm test`).
- Controle voor oplevering: `npx tsc -b`, `npm test`, `npm run build`.
