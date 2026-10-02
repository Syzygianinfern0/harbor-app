# Landing page

The public site at https://spsharan.com/harbor-app/ is built from `site/`. The owner's content and design decisions for it are in [AGENTS.md](../AGENTS.md#landing-page-site); read them before changing the page.

`site/` is the static landing page: `index.html`, `styles.css`, and `demo.js` (the interactive tab demo and the close-the-lid simulator, both simulated in the browser). Open `site/index.html` directly or serve the folder, for example `python3 -m http.server -d site`. Pushing changes under `site/` to `main` deploys it to GitHub Pages through `.github/workflows/pages.yml`.

The screenshots in `site/assets/shots/` come from the real app running a made-up demo workspace: `npm run build && npm run site:shots` (needs `cwebp` and ImageMagick, `brew install webp imagemagick`). The script uses a temporary profile and its own tmux socket, scripts every terminal's output, and replaces usage data with demo numbers, so no real chats or costs appear. Download buttons link to `Harbor-arm64.dmg` on the latest GitHub release, and the install section shows the `install.sh` one-liner (`site/install.sh`, served next to the page).
