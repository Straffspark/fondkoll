# Fondkoll

Månadssparande i fonder och aktier: köp den 25:e, redovisning per tillgångsslag, analys och förslag om omviktning.

- **Appen** är en statisk sida (index.html, app.js, core.js, style.css) som körs på GitHub Pages.
- **Dina uppgifter** (belopp, köp, innehav) sparas bara i din webbläsare, krypterade med ditt lösenord (AES-GCM, nyckel via PBKDF2). Lösenordet går inte att återställa. Inget om ditt sparande finns i repot.
- **Kurser** hämtas av `.github/workflows/kurser.yml` två gånger varje dag, och sparas i `data/prices.json`.
- **Sök i appen:** under Innehav går det att söka bland fonder som säljs i Sverige och aktier på Stockholmsbörsen. Kurserna för dessa hämtas direkt i webbläsaren från Morningstar.
- **Fler fonder eller aktier i den färdiga listan** med automatiska kurser: lägg till en rad i `data/catalog.json` med `id`, `name`, `type` (`ranta`, `aktiefond` eller `aktie`) och `isin` eller Yahoo-`symbol`.
- **Tester:** `node test/core.test.js`.

Förslagen i appen räknas fram med fasta regler och är inte finansiell rådgivning.
