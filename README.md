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

### Charger dans Firefox PC (Temporaire ou Signé via AMO)
1. **Temporaire (développement)** : ouvrez `about:debugging#/runtime/this-firefox` → **Charger un module complémentaire temporaire…** → sélectionnez `.output/firefox-mv3/manifest.json` (ou `*-firefox.zip`). Note : Firefox Release supprime les extensions temporaires au redémarrage.
2. **Permanent (Firefox Add-ons / AMO)** : soumettez l'archive `kumoyomi-<version>-firefox.zip` sur [addons.mozilla.org](https://addons.mozilla.org/developers/) (en *Unlisted / Self-distribution* pour un `.xpi` privé signé automatiquement, ou *Listed* pour le store public). Comme le bundle Vite est minifié, joignez l'archive source du dépôt et la commande de reproduction exacte :
   ```bash
   pnpm install --frozen-lockfile && pnpm build:firefox
   ```
   (Sortie vérifiable dans `.output/firefox-mv3`).

## Ajouter un dépôt de sources

L'extension démarre volontairement vide et ne contient aucun site en dur.
1. Ouvrez KumoYomi (clic sur l'icône de l'extension) → onglet **Sources & Dépôts**.
2. Ajoutez l'URL du dépôt communautaire de sources :
   `https://github.com/KumoYomi-Sources/extensions-source`
3. Pour proposer un nouveau site ou corriger un sélecteur, ouvrez une **Pull Request** sur [`KumoYomi-Sources/extensions-source`](https://github.com/KumoYomi-Sources/extensions-source).
