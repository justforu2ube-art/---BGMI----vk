# Vanguard Tactical Character Studio

Interactive 3D tactical character studio built with React, TypeScript, Tailwind CSS, and Three.js. Includes procedural PBR materials, a 56-bone humanoid finger-rigged skeleton, facial morph targets, 11 biomechanical animations, a third-person combat controller, multi-environment PBR lighting presets, and `.GLB` export.

## Deploy to GitHub Pages (Get a Live Link)

This repository includes a preconfigured GitHub Actions workflow at `.github/workflows/deploy.yml` that builds the app and deploys it to GitHub Pages automatically.

1. **Push this project to a GitHub repository** on the `main` (or `master`) branch.
2. In your GitHub repository, open **Settings → Pages**.
3. Under **Build and deployment → Source**, select **GitHub Actions**.
4. Open the **Actions** tab, select **Deploy to GitHub Pages**, and click **Run workflow** (or push a new commit to `main`).
5. Once the workflow finishes, click the live URL shown under the **deploy** job (typically `https://<your-username>.github.io/<your-repo-name>/`).

## Local Development

```bash
npm install
npm run dev
```

## Production Build

```bash
npm run build
npm run preview
```
