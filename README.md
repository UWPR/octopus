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

Prerequisites: Node.js 22 or newer and npm.

```
git clone https://github.com/UWPR/octopus.git
cd octopus
npm install
npm start
```

This opens the app at http://localhost:3000 with hot reload.

## Testing

- `npm run typecheck` runs the TypeScript type check.
- `npm run lint` runs ESLint with the rules in `package.json` plus the stricter rules in
  `eslint-strict.json`, which check for unhandled promises and for mistakes in the
  end-to-end tests. The dev server and editors use only the rules in `package.json`.
- `npm run test:ci` runs the unit tests once, without the end-to-end tests.
- `npx playwright test` runs the end-to-end tests in Google Chrome, which must be
  installed. It starts the dev server on port 3000, or uses one that is already running.

Use `npm run test:ci` rather than `npm test`. `npm test` also picks up the end-to-end
tests in `src/tests/e2e/`, which fail under the unit test runner.

Every pull request runs `npm run typecheck`, `npm run lint` and `npm run test:ci` on
GitHub, and the result is shown as a check on the pull request. A lint error fails the
check, and a lint warning does not. The end-to-end tests do not run there.

## Hosted app and offline copy

The app is hosted on GitHub Pages at https://uwpr.github.io/octopus. Tagged versions
are on the [Releases](https://github.com/UWPR/octopus/releases) page.

Each release also includes a single-file offline build, `octopus-<version>.html`. You
can download that one file and open it in any modern browser with no installation and
no network connection.

## Releasing

The hosted site and the offline copy are updated only by publishing a release.

1. Merge the changes into `main`.
2. Set `version` in `package.json` to the new version. It names the offline copy and is
   shown in the documentation.
3. Publish a release on GitHub with a tag on a commit on `main`.

The release workflow then checks that the commit is on `main`, runs the type check and
the unit tests, builds the hosted site and the offline copy, deploys the hosted site to
GitHub Pages, and attaches `octopus-<version>.html` to the release. A pre-release gets
the offline copy but does not update the hosted site.

`npm run deploy:manual` is for emergencies only. It uploads whatever is in `build/`
without building, and `npm run build:singlefile` writes its single-file build into the
same folder. Run `npm run build` immediately before `npm run deploy:manual`, from a
clean checkout of `main`.

## Available scripts

- `npm start` runs the dev server at http://localhost:3000.
- `npm run build` creates the production build in `build/`, to check a build locally.
- `npm run build:singlefile` creates a single self-contained `build/octopus-<version>.html` that runs offline from a local file, with all JavaScript, CSS, icons, and the logo inlined.
- `npm run typecheck`, `npm run lint` and `npm run test:ci` are described under Testing.

Octopus is a Create React App, so `npm run eject` (one-way config ejection) is also
available. It is not recommended.

## License

Octopus is open source under the [Apache 2.0 license](LICENSE).
