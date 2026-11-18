// Hoe Heystack werkt (/uitleg): de logica van heel de app, per onderwerp één regel, met een tik meer. De enige plek met
// uitleg in de interface (STIJLBOEK.md, principe 11). Verandert de logica, pas dan ook deze tekst aan.

import type { ReactNode } from "react";
import { CardHead } from "../components/Controls";
import { Disclosure } from "../components/Disclosure";
import { AiMark } from "../components/Fields";
import { PageHead } from "../components/Page";

type Topic = { title: ReactNode; points: ReactNode[] };

const PARTS: { title: string; topics: Topic[] }[] = [
  {
    title: "De basis",
    topics: [
      {
        title: "Een lijst bewaart items met dezelfde kolommen",
        points: [
          "Kolommen zijn tekst, getallen, datums, keuzes, personen, verwijzingen naar items in een andere lijst of een berekening.",
          "Tags groeperen lijsten en formulieren; een lijst kan meer tags hebben. Een tag toont al de items van haar lijsten samen.",
          "Een lijst is een tabel: filteren (ook op een periode, zoals vorige maand of de laatste 7 dagen), sorteren op meer kolommen, kolommen tonen of verbergen, groeperen, als agenda, en dat bewaren als weergave.",
        ],
      },
      {
        title: "Een item kan delen hebben: Deel van",
        points: [
          "Een item is zelf geen lijst. Hoort iets bij iets anders, dan maak je het er een deel van: Colruyt Herentals is een deel van Colruyt, de pedalen zijn een deel van de fiets.",
          "Op de fiche van een item staat Delen. Met Toevoegen maak je een nieuw item in dezelfde lijst dat er een deel van is; daarna kom je terug op de fiche. Bij Bewerken kies je Deel van ook zelf, uit al je lijsten.",
          "In de lijst staat een deel ingesprongen onder zijn item, ook dieper (Winkels → Colruyt → Colruyt Herentals → Kassa 3), en dat blijft zo als je sorteert, groepeert of filtert. Staat het item zelf er niet bij, dan staat het deel gewoon op zijn plaats.",
          "Een deel heeft dezelfde kolommen als zijn lijst. Iets dat enkel één item heeft (je klantnummer bij Colruyt), is gewoon een kolom die bij de andere leeg blijft: de fiche toont enkel wat ingevuld is.",
          "Een kring kan niet: Colruyt kan geen deel zijn van zijn eigen filiaal.",
        ],
      },
      {
        title: "Met een formulier log je wat er gebeurde",
        points: [
          "Elke keer dat je logt, is een gebeurtenis. Alles wat met een formulier gelogd werd, staat in zijn logboek.",
          "Het logboek van een lijst is wat haar items raakte, met welk formulier ook.",
          "Een formulier heeft velden, en eventueel een bedrag, een einde (een activiteit of een timer) of iemand naar wie iets gaat.",
          "Een gebeurtenis is gebeurd, gepland (te doen, een boodschap) of afgevinkt (een boodschap die gekocht is).",
          "Twee formulieren voeg je samen in Instellen: het logboek, de mensen en de velden komen bij het ene.",
        ],
      },
      {
        title: "Een formulier kiest items uit lijsten en vult hun kolommen in",
        points: [
          "Per lijst kies je: een bestaand item kiezen of telkens een nieuwe rij maken, en één item of meerdere. Zoveel lijsten als je wil, ook dezelfde lijst twee keer (een wagen en een aanhangwagen).",
          "Elke kolom koppel je aan een veld, de datum, hoeveel, de prijs, het bedrag of een vaste waarde: Zet op, of bij een getal Tel bij of Tel af. Een kolom zonder koppeling verschijnt niet.",
          "Eén veld kan kolommen in meer lijsten tegelijk invullen.",
          "Kies je bij het loggen een item, dan begint zo'n veld met wat het item nu heeft.",
        ],
      },
    ],
  },
  {
    title: "Wat vanzelf gaat",
    topics: [
      {
        title: "Wat het logboek invult, rekent de app altijd opnieuw uit",
        points: [
          "De waarde is wat in het item stond of de laatste Zet, plus wat er daarna bij en af ging, in volgorde van de datum. Enkel wat gebeurd is, telt.",
          "Pas je een gebeurtenis aan of verwijder je ze, dan volgt de lijst vanzelf.",
          "Pas je zo'n kolom in het item zelf aan, dan komt er een Aanpassing in het logboek.",
        ],
      },
      {
        title: "Voorraad: kopen telt bij, gebruiken telt af, tellen zet",
        points: [
          "Een lijst die voorraad telt, rekent om tussen kg, g, l, ml, stuk en een verpakking.",
          "Onder het minimum staat een item bijna op.",
          "Bij een aankoop bepalen de lijnen welke voorraad stijgt.",
        ],
      },
      {
        title: "Geld: wie betaalde telt bij, wie deelt telt af",
        points: [
          "Een lijst met een saldo per persoon (zoals Uitgaven) houdt een rij per persoon bij.",
          "Een uitgave is standaard gelijk verdeeld over wie met het formulier logt; een lijn van één persoon telt enkel voor die persoon.",
          "Wie moet wie telt de saldo's van al je lijsten samen. Terugbetaald logt een overdracht.",
        ],
      },
      {
        title: "Eten: een formulier dat eet, telt kcal",
        points: [
          "De kcal komen uit het formulier, of uit de kcal per 100 g van de items die van de voorraad gaan.",
          "Productinfo komt uit Open Food Facts (enkel een barcode of productnaam) of NEVO; de app toont altijd of iets uit een databank komt of geschat is.",
        ],
      },
    ],
  },
  {
    title: "Samen",
    topics: [
      {
        title: "Per lijst en per formulier: beheerder, lid of gast",
        points: [
          "Een beheerder stelt in en zet mensen erbij, een lid voegt items toe of logt, een gast kijkt. Geen is een uitzondering.",
          "Een regel op een tag geeft iemand een rol op alles met die tag, maar enkel waar wie de regel maakte zelf beheerder is.",
          "Wie je bij een lijst zet, komt ook bij de formulieren die ze invullen en die jij beheert.",
          "Er blijft altijd iemand rechtstreeks beheerder.",
        ],
      },
      {
        title: "Een gebeurtenis zie je als je het formulier ziet én een lijst die ze raakt",
        points: [
          "Raakt ze geen lijst (sport), dan volgt ze het formulier.",
          "Wat iemand uit een eigen lijst haalde, zie jij dus niet, ook al loggen jullie met hetzelfde formulier.",
          "Zie je het formulier niet, dan zie je in het logboek van je lijst enkel wat die lijst raakte, zonder bedrag of naam.",
          "Hetzelfde geldt voor meldingen en herinneringen.",
        ],
      },
      {
        title: "Meldingen bij iets nieuws",
        points: [
          "Een formulier meldt aan iedereen die het ziet, of aan wie in de verdeling staat; nooit aan wie het logde.",
          "Stilzetten kan per formulier of per tag.",
          "Om 7 u komen herinneringen voor datums van items en wat vandaag gepland staat.",
        ],
      },
    ],
  },
  {
    title: "Ingangen",
    topics: [
      {
        title: "De + zoekt, logt, maakt iets nieuws of opent",
        points: [
          "Loggen met een formulier; noemt je tekst een item, dan logt het meteen daarmee.",
          "Stap voor stap vul je veld na veld in; Alles invullen opent het hele formulier met wat er al staat.",
          "Op een lijst toont de + enkel wat bij die lijst hoort.",
        ],
      },
      {
        title: "Typ wat je weet, de app vult in",
        points: [
          "Een datum, een uur, een bedrag, items met hoeveelheid en prijs, en de velden van het formulier.",
          "Enkel wat je tekst zette, verandert mee als je verder typt.",
        ],
      },
      {
        title: "Een bord toont weergaven en acties",
        points: [
          "Een weergave bouw je in vier stappen: de lijsten (en wat: de items, het logboek, de voorraad, wie moet wie, wat er gegeten is, alles met een datum), de voorwaarden, de kolommen en hoe je het toont (een lijst, een tabel, een getal, een grafiek, een agenda …).",
          "Eerst filteren de voorwaarden de rijen, dan tellen de kolommen: elke kolom toon je, of je neemt de som, het gemiddelde, de kleinste, de grootste, het aantal of van–tot (de eerste en laatste datum).",
          "Een formule is een kolom die rekent met de kolommen ervoor, zoals [Bedrag] ÷ [Liter]. Per rij geeft ze de prijs per liter van die tankbeurt; samen met Tonen rekent ze op de totalen (het totale bedrag gedeeld door de totale liters), met Som telt ze haar uitkomsten per rij op.",
          "Groeperen per een keuze of een datum (per dag, week, maand of jaar) geeft een tabel een rij per groep met haar totalen; zonder groeperen krijgt ze onderaan een totaalrij. Een getal toont elke kolom die samen telt, een grafiek een reeks per kolom.",
          "Over meer lijsten is een kolom met dezelfde naam en soort één kolom (de Prijs in Wijnen en in de kelder); heet ze anders, dan kies je per lijst welk veld meetelt.",
          "Een actie logt met één tik, eventueel gepland.",
          "Alles wordt uitgerekend met jouw rechten.",
        ],
      },
      {
        title: (
          <>
            AI leest enkel als je erom vraagt <AiMark />
          </>
        ),
        points: [
          "Een kasticket, een gerecht of een foto van een item; elke knop die AI gebruikt, draagt ✨.",
          "Per persoon aan of uit, hoogstens 25 keer per dag per persoon.",
          "Een kasticket koppelt enkel aan items die jij ziet en onthoudt de naam op het ticket voor de volgende keer.",
        ],
      },
    ],
  },
  {
    title: "De rest",
    topics: [
      {
        title: "Herhalen",
        points: [
          "Een gebeurde gebeurtenis die herhaalt, krijgt kopieën tot vandaag, met de rechten die wie ze maakte nu heeft.",
          "Een geplande maakt de volgende als je ze afvinkt.",
        ],
      },
      {
        title: "Items uit een andere lijst",
        points: [
          "Kopiëren en verplaatsen gebeuren één keer.",
          "Koppelen blijft: de doellijst volgt de bron, met de rechten van wie koppelde. Een gekoppeld item pas je aan in de bron.",
        ],
      },
      {
        title: "Verbanden",
        points: ["Op Lijsten zie je hoe je lijsten en formulieren samenhangen: verwijzingen, wat een formulier invult en welke weergaven ze tonen."],
      },
      {
        title: "Offline en back-up",
        points: [
          "Wat je eerder bekeek, opent ook zonder internet; wat je dan bewaart, wacht tot er weer internet is.",
          "Een back-up bevat de lijsten en formulieren die je beheert. Terugzetten maakt altijd een nieuwe kopie.",
        ],
      },
    ],
  },
];

export function ExplainPage() {
  return (
    <div className="page">
      <PageHead title="Hoe Heystack werkt" back={{ to: "/ik", label: "Jouw gegevens" }} />
      {/* Eén kolom om te lezen, met ruimte tussen de kaarten. */}
      <div className="form">
        {PARTS.map((part) => (
          <section key={part.title} className="card">
            <CardHead title={part.title} />
            <ul className="rows">
              {part.topics.map((t, i) => (
                <li key={i}>
                  <Disclosure title={t.title}>
                    <ul>
                      {t.points.map((p, k) => (
                        <li key={k}>{p}</li>
                      ))}
                    </ul>
                  </Disclosure>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
