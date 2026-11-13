# South Sudan Settlement Tracker

The static map displays published building change maps and can submit new comparisons to the Hugging Face Space. GitHub Actions tests the frontend and publishes the contents of `site/` to GitHub Pages.

To preview the site, run `python3 -m http.server 8765 --bind 127.0.0.1 --directory site` and open `http://localhost:8765/`. Run the frontend tests with `npm test`.

The Space API and public OAuth client ID are configured in `site/assets/config.json`. The OAuth client needs the exact callback URL for each deployment, including the trailing slash on the Pages project URL. Local preview uses `http://localhost:8765/`. The public client uses PKCE and requests OpenID and public profile access. The browser keeps the access token in memory.

The `prepare_selection_v1`, `infer_v1`, and `finish_v1` endpoints share one Gradio session per run. The preparation response contains the imagery preview, and the finish response contains the map overlays and temporary export links. The Space validates coverage with a copy of `site/assets/coverage.geojson`. Update both copies when changing coverage.
