# KumoYomi

Extension navigateur PC **100 % locale** (Chrome, Brave, Edge et Firefox) agissant comme une coquille neutre : l'interface plein écran embarquée (`app.html`) héberge votre bibliothèque, la recherche parallèle multi-sources et un lecteur de scans anti-hotlink, tandis que les sites sont pilotés uniquement par des fichiers de configuration JSON hébergés dans un dépôt tiers séparé.

## Téléchargement (Releases automatiques)

Les archives prêtes à l'emploi pour Chrome et Firefox sont publiées dans l'onglet **Releases** via le workflow GitHub Actions [`Build & Release Extension`](.github/workflows/release.yml) (déclenchable manuellement depuis l'onglet **Actions → Run workflow** ou via un tag `v*`).

## Développement & Compilation locale

```bash
pnpm install
pnpm test
pnpm build          # Chrome / Brave / Edge MV3 -> .output/chrome-mv3
pnpm build:firefox  # Firefox PC MV3            -> .output/firefox-mv3
pnpm zip            # Génère les archives .zip dans .output/
```

### Charger dans Chrome / Brave / Edge
1. Ouvrez `chrome://extensions`
2. Activez le **Mode développeur**
3. Cliquez sur **Charger l'extension non empaquetée** et sélectionnez `.output/chrome-mv3` (ou le contenu du `.zip` Chrome décompressé)

### Charger dans Firefox PC
1. Ouvrez `about:debugging#/runtime/this-firefox`
2. Cliquez sur **Charger un module complémentaire temporaire…**
3. Sélectionnez `.output/firefox-mv3/manifest.json` (ou directement l'archive `*-firefox.zip`)

## Ajouter un dépôt de sources

L'extension démarre volontairement vide et ne contient aucun site en dur.
1. Ouvrez KumoYomi (clic sur l'icône de l'extension) → onglet **Sources & Dépôts**.
2. Ajoutez l'URL du dépôt communautaire de sources :
   `https://github.com/KumoYomi-Sources/extensions-source`
3. Pour proposer un nouveau site ou corriger un sélecteur, ouvrez une **Pull Request** sur [`KumoYomi-Sources/extensions-source`](https://github.com/KumoYomi-Sources/extensions-source).
