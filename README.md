# Octopus

Octopus is a freely accessible web application for designing balanced, randomized
plate layouts for mass spectrometry workflows. It combines proportional allocation of
covariate groups across plates with spatial optimization to minimize same-group
clustering within plates. It supports repeated-measures designs where samples from the
same subject must remain together, and provides real-time visualization,
drag-and-drop editing, and integrated quality metrics. All processing happens locally
in the browser, requiring no installation and ensuring that data never leaves the
user's computer.

**Live app: https://uwpr.github.io/octopus**

## What it does

From a sample sheet (CSV), Octopus:

- Balances each combination of chosen covariates across plates and rows, so every
  plate reflects the makeup of the whole experiment (block randomization).
- Separates samples of the same kind within a plate, so they do not cluster in a row,
  column, or corner (spatial randomization).
- Handles quality-control and reference samples, and repeated-measures designs with a
  same-row or same-plate constraint that keeps a subject's samples together.
- Scores every plate for balance and clustering, highlights any covariate group or
  subject across all plates, re-randomizes a single plate, and lets you drag a sample
  to a new well with the scores updating live.
- Exports color-coded CSV and Excel files, saves and reloads a layout as a JSON audit
  record, and writes a mass-spectrometer injection sequence (Thermo Xcalibur format).

## Running locally

Prerequisites: Node.js 18 or newer and npm.

```
git clone https://github.com/UWPR/octopus.git
cd octopus
npm install
npm start
```

This opens the app at http://localhost:3000 with hot reload.

To produce the deployable static build:

```
npm run build
```

The optimized site is written to the `build/` folder. This is what is published to
GitHub Pages.

## Deployment

The app is hosted on GitHub Pages at https://uwpr.github.io/octopus. Tagged versions
are on the [Releases](https://github.com/UWPR/octopus/releases) page.

## Available scripts

- `npm start` runs the dev server at http://localhost:3000.
- `npm run build` creates the production build in `build/`.

Octopus is a Create React App, so the standard `npm test` (test runner) and
`npm run eject` (one-way config ejection, not recommended) are also available but not
part of the normal workflow.

## License

Octopus is open source under the [Apache 2.0 license](LICENSE).
