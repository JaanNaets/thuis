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

- Navigeren altijd met `Link`, `NavLink` en `useNavigate` uit `src/router.tsx` (vloeiende schermwissels), nooit
  rechtstreeks uit `react-router`. Een nieuw scherm komt in `src/routes.tsx`.

- Bedragen in cent, datums als `YYYY-MM-DD`. Opmaak via `src/format.ts`.
- Alles hoort bij een huishouden. Elke route onder het huishouden gebruikt `c.get("household")` en filtert daarop
  (zie `worker/context.ts`); wat van buiten komt (ids van categorieën, leden, potten) controleer je met `assertOwned`.
  Een gast (`access = 'projects'`) mag bij zijn projecten (`requireFull` of `canUseProject`) en mag de uitgaven
  zien waarin hij zelf betaalde of een deel heeft, maar enkel aanpassen wat in zijn projecten staat. Bij twijfel: weigeren.
- Verkopers bewaren nooit een wachtwoord, enkel het klantnummer en waarmee je aanmeldt.
- Schemawijziging = nieuw bestand in `migrations/` (nooit een bestaand aanpassen); eerst lokaal testen met
  `npm run db:migrate:local`. Een push naar `main` rolt uit en voert de migratie online uit.
- Gedeelde types en logica in `shared/`, met tests in `test/` (`npm test`).
- Controle voor oplevering: `npx tsc -b`, `npm test`, `npm run build`.
