# South Sudan Settlement Tracker

The static map displays published building change maps and can submit new comparisons to the Hugging Face Space. GitHub Actions tests the frontend and builds and publishes `dist/` to GitHub Pages.

To preview the site, run `npm ci` and `npm run build`, then `python3 -m http.server 8765 --bind 127.0.0.1 --directory dist` and open `http://localhost:8765/`. Run the frontend tests with `npm test`.

The Space API and public OAuth client ID are configured in `site/assets/config.json`. The OAuth client needs the exact callback URL for each deployment, including the trailing slash on the Pages project URL. Local preview uses `http://localhost:8765/`. The build embeds the tracker CSS and JavaScript, MapLibre GL, PMTiles, map configuration, coverage and both basemap styles in `dist/index.html`. Proj4 and the flooding protocol ship as separate files that load when needed. The public client uses PKCE and requests OpenID and public profile access. The browser keeps the access token in memory.

The `prepare_selection_v1`, `infer_v1`, and `finish_v1` endpoints share one Gradio session per run. The preparation response contains the imagery preview, and the finish response contains the map overlays and temporary export links. The Space validates coverage with a copy of `site/assets/coverage.geojson`. Update both copies when changing coverage.
