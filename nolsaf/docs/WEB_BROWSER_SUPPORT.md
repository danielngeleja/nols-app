# Web browser support

The web app uses Tailwind CSS 4. Supported browser minimums are Safari 16.4,
Chrome 111, and Firefox 128. These minimums were accepted for the 2026-10-08
release candidate. Test affected staging pages in supported browsers before
production promotion.

`apps/web/styles/globals.css` imports Tailwind's theme and utilities without
preflight, preserving the app's existing element styles. Its `@source inline`
directive preserves classes that the Tailwind 3 config previously safelisted.
The PostCSS plugin is `@tailwindcss/postcss`.

See the [Tailwind CSS upgrade guide](https://tailwindcss.com/docs/upgrade-guide)
for browser requirements and configuration changes.
