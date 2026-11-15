# Fondkoll

Månadssparande i fonder och aktier: köp den 25:e, redovisning per tillgångsslag, analys och förslag om omviktning.

- **Appen** är en statisk sida (index.html, app.js, core.js, style.css) som körs på GitHub Pages.
- **Dina uppgifter** (belopp, köp, innehav) sparas bara i din webbläsare. Inget om ditt sparande finns i repot.
- **Kurser** hämtas av `.github/workflows/kurser.yml` varje vardagskväll och på köpdagen, och sparas i `data/prices.json`.
- **Fler fonder eller aktier** med automatiska kurser: lägg till en rad i `data/catalog.json` med `id`, `name`, `type` (`ranta`, `aktiefond` eller `aktie`) och `isin` eller Yahoo-`symbol`.
- **Tester:** `node test/core.test.js`.

Förslagen i appen räknas fram med fasta regler och är inte finansiell rådgivning.
