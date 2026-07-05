# Group Distribution Warnings - Manual Test File

`group-distribution-demo.csv` is built to exercise the group distribution warnings:
the non-blocking diagnostic that flags covariate groups poorly distributed across
plates or rows.

It is sized so it produces flagged groups at the **default 96-well plate (8 rows x
12 columns) with no configuration changes**. 200 samples give
`P = ceil(200 / 96) = 3` plates.

## Two coverage rules

- **Treatment covariate groups: one per plate.** With more than one plate, a group
  with fewer than 3 samples cannot appear on all 3 plates, so it is flagged.
- **QC/reference groups: one per used row.** QC samples are meant to be
  interspersed through the run, so per-plate is not enough. Each selected QC group
  is checked against the generated layout: if it is absent from any used row (a row
  that holds any sample), it is flagged. This is per group, so a scarce reference
  can be flagged while a plentiful QC is not.

Both coverage checks show up only after **Generate**, because the Covariate Summary
is only shown once a layout exists.

## Columns

- `Sample ID` - unique ID (`DEMO-0001` ...)
- `SampleType` - the QC column. Values: `Study`, `QC`, `Ref`.
- `Treatment` - `Drug`, `Placebo`, `Vehicle` (`na` on QC/Ref rows)
- `Timepoint` - `T0`, `T24` (`na` on QC/Ref rows)
- `Site` - `A`, `B` (`na` on QC/Ref rows)

## Recommended configuration

- ID column: `Sample ID`
- QC/Reference column: `SampleType`, selected values `QC` and `Ref`
- Covariates: `Treatment`, `Timepoint`, `Site`
- Plate size: leave at the default 8 x 12
- Then click **Generate Randomized Plates**.

## What you should see

With all three covariates selected there are 12 covariate groups. The flagged ones:

| Group | Count | Why flagged |
|---|---|---|
| `Vehicle` `T0` `A` | 2 | treatment coverage: 2 < 3 plates |
| `Vehicle` `T24` `B` | 2 | treatment coverage |
| `Drug` `T24` `B` | 1 | treatment coverage |
| `Placebo` `T0` `A` | 1 | treatment coverage |
| `Ref` (QC group) | 2 | row coverage: 2 samples cannot reach every used row |
| `QC` (QC group) | 16 | row coverage: 16 samples cannot fill all ~24 used rows |

The four treatment errors and the `Ref` row-coverage error are always present. The
`QC` group is flagged whenever the layout uses more than 16 rows, which the default
8x12 plates do (about 24 used rows). So expect six flagged groups.

The remaining six large study groups (counts 18 to 40) cover all three plates and
are not flagged, unless a particular randomization spreads one so unevenly that its
measured balance drops to Poor or Bad, which shows as an amber `UNEVEN` warning.

Expect:

- A warning banner at the top of the Covariate Summary, with a separate line per
  category, for example:
  - "4 of the treatment covariate groups are not represented on every plate.
    Ideally, each plate should have at least one sample from every treatment
    covariate group."
  - "2 of the QC/Reference groups are not represented on every row. Ideally, each
    row should have at least one sample from every QC/Reference group."
- A red `SPARSE` label on each flagged card. Its tooltip carries the full reason:
  treatment cards say a plate will have 0 samples of the group, QC cards say the
  group is missing from N of M used rows.
- A warning triangle with the flagged-group count on the collapsed "Covariate
  Summary" toggle button (red when any group fails coverage, amber when the only
  issues are balance warnings).
- The `Ref` and `QC` cards show both the dashed QC outline and a `SPARSE` label.

## Demonstrating over-blocking

To see how adding covariates fragments the treatment groups, generate twice:

- Covariates = `Treatment` only: all treatments have enough samples to place at
  least one sample on every plate, so the layout gets no `SPARSE` coverage errors for treatment groups.
  The QC and Ref groups are flagged for row coverage as before. 
  The `Vehicle` group (4 samples) does get an amber `UNEVEN` balance warning,
  though, since 4 samples cannot spread evenly across 3 plates (the best split is
  2/1/1).

- Covariates = `Treatment` + `Timepoint` + `Site`: `Vehicle` and the two singletons
  split out, so four treatment groups now fail per-plate coverage on top of the two
  QC groups. Same 200 samples, more covariates, more over-blocking.
