# OCTOPUS Test Data Files

This directory contains example CSV files for testing the OCTOPUS Plate Designer application. The data is derived from a published mouse radiation proteomics study.

## Source Paper

Zelter A, Riffle M, Merrihew GE, et al. *A quantitative proteomics dataset for assessment and prediction of low dose X-ray radiation exposure in mice.* bioRxiv preprint, posted 19 May 2026. [https://doi.org/10.64898/2026.05.18.725951](https://doi.org/10.64898/2026.05.18.725951)

The study generated large-scale DIA-MS proteomics datasets from mouse dorsal skin punch samples collected after controlled X-ray exposures. Experiment 2 (the source for these test files) comprised 936 LC-MS/MS injections — 700 experimental mice exposed to 0–100 cGy at low (3 cGy/min) or high (28 cGy/min) dose rates, harvested between 7 and 150 days post-exposure, plus 236 pooled QC reference samples — processed across 10 plates of 96 wells each.

The dataset was published as a biomarker prediction challenge: some sample labels were deliberately withheld so downstream users can build models that predict radiation dose, dose rate, and time post-exposure from the proteomics measurements.

## Available Test Files

### 1. octopus_test_dataset_small.csv

**Small dataset — 288 samples, 3 plates (96-well format)**

- **Total Samples**: 288
- **Plates**: Exactly 3 plates (8×12 = 96 wells each)
- **Covariate Groups**: 14 (12 experimental + 2 reference)
- **Columns**: 7

| Condition | Focus Areas | Count |
|---|---|---:|
| Training_Xray_LDR_10cGy | FA1, FA2 | 24 (12 per FA) |
| Training_Xray_LDR_75cGy | FA1, FA2 | 24 (12 per FA) |
| Training_Xray_HDR_10cGy | FA1, FA2 | 24 (12 per FA) |
| Training_Xray_HDR_75cGy | FA1, FA2 | 24 (12 per FA) |
| Baseline_0cGy_Xray | FA1, FA2 | 48 (24 per FA) |
| Blinded_Xray | FA1, FA2 | 72 (36 per FA) |
| Inter-Batch Reference (IBR) | na | 36 |
| Inter-Experiment Reference (IER) | na | 36 |

**Use Case**: Quick demonstrations, tutorials, testing balanced distribution across 3 plates.

### 2. octopus_test_dataset.csv

**Full dataset — 936 samples, 10 columns**

- **Total Samples**: 936
- **Covariate Groups**: 37 (34 experimental + 3 reference)
- **Includes**: All experimental Sets (Training, Add Train, Baseline, 1Gy ref dose, Partial, Blind) plus all three reference types (IBR, IC, IER)
- **Pool-aware columns**: `Dose_Rate` and `Dose_cGy` write `pool` for Conditions that intentionally span multiple values. The truthful source values are preserved in `Dose_Rate_Orig` and `Dose_cGy_Orig`.

**Use Case**: Full-scale testing with many covariate groups and real-world complexity. Demonstrates how Octopus constructs covariate groups from multiple columns.

## Column Descriptions

### Small file (7 columns)

| Column | Description | Example Values |
|--------|-------------|----------------|
| **UW_Sample_ID** | Unique sample identifier | TRX-TE-MSP-2047, REF-XP2P-001 |
| **Condition** | Treatment condition or QC role | Training_Xray_LDR_10cGy, Blinded_Xray, Inter-Batch Reference (IBR) |
| **Focus_Area** | Experimental phase | FA1 (early, 7–21 days), FA2 (late, 90–150 days), na (references) |
| **Set** | Role in the prediction challenge | Training, Baseline, Blind, UW IB Reference, UW IE Reference |
| **Time_point** | Days post-irradiation | 7, 14, 21, 90, 120, 150, blind, na, pool |
| **Dose_Rate** | Radiation dose rate (pool-aware) | HDR (28 cGy/min), LDR (3 cGy/min), blind, na, pool |
| **Dose_cGy** | Radiation dose in centiGray (pool-aware) | 0, 10, 25, 75, 100, blind, na, pool |

### Full file (10 columns)

All columns from the small file plus:

| Column | Description | Example Values |
|--------|-------------|----------------|
| **Unblinded** | What labels are visible to the analyst | All, Time, Dose_and_Rate, None, na |
| **Dose_Rate_Orig** | Truthful dose rate from source metadata | HDR, LDR, blind, na, pool |
| **Dose_cGy_Orig** | Truthful dose in cGy from source metadata | 0, 5, 10, 15, 25, 35, 45, 55, 65, 75, 100, blind, pool |

## Understanding the Set Values

The `Set` column encodes each sample's role in the biomarker prediction challenge published with the paper:

- **Training** — Fully labelled training examples (doses 10 or 75 cGy, rates HDR or LDR, time points 7/21/90/150 days)
- **Add Train** — Supplementary training data that adds sham controls (0 cGy) and pools doses within each dose-rate × Focus Area cell
- **Baseline** — 0 cGy sham-irradiated controls
- **1Gy ref dose** — 100 cGy reference samples (anchor for the high end of the dose curve)
- **Partial** — Held-out test set with selective unblinding (see `Unblinded` column: `Time` = only time visible; `Dose_and_Rate` = only dose and rate visible)
- **Blind** — Full holdout (all labels withheld)
- **UW IB Reference** — Inter-Batch Reference (pooled lysate from plates 1 and 2)
- **UW IC Reference** — Internal Control (80 Experiment 1 lysates re-injected in Experiment 2)
- **UW IE Reference** — Inter-Experiment Reference (pooled lysate from a separate prior experiment)

## Recommended OCTOPUS Configuration

### Small file (octopus_test_dataset_small.csv)

- **ID Column**: `UW_Sample_ID`
- **QC/Reference Column**: `Set`
- **QC/Reference Values**: ☑ `UW IB Reference`, ☑ `UW IE Reference`
- **Covariates**: `Condition` + `Focus_Area`
- **Plate Dimensions**: 8 rows × 12 columns (96-well plate)

This produces **14 covariate groups** with good balance across 3 plates.

### Full file (octopus_test_dataset.csv)

- **ID Column**: `UW_Sample_ID`
- **QC/Reference Column**: `Set`
- **QC/Reference Values**: ☑ `UW IB Reference`, ☑ `UW IC Reference`, ☑ `UW IE Reference`
- **Covariates**: `Condition` + `Focus_Area`
- **Plate Dimensions**: 8 rows × 12 columns (96-well plate)

This produces **37 covariate groups** across 10 plates.

**Alternative covariate selection** (demonstrates multi-column group construction):
- **Covariates**: `Focus_Area` + `Set` + `Dose_Rate` + `Dose_cGy`

This also produces **37 covariate groups** because the pool-aware `Dose_Rate` and `Dose_cGy` columns write `pool` for Conditions that span multiple values.

## Data Processing

These test files were derived from the Experiment 2 metadata of the source paper. Processing steps:

1. Dropped 63 trailing blank rows from the source CSV (keeping 936 sample rows)
2. Removed 13 sample-handling/provenance columns not relevant to randomization
3. Renamed the `Group` column (opaque values like "Group 14") to `Condition` (descriptive values like `Add_Training_Xray_LDR`)
4. Added `Unblinded` column derived from the source `Unblind` column
5. Created pool-aware `Dose_Rate` and `Dose_cGy` columns that write `pool` for Conditions that intentionally pool across that dimension; preserved truthful values in `_Orig` columns
6. For the small file: subsampled to 288 rows (3 plates), keeping only Training, Baseline, and Blind sets plus IBR and IER references, with time-point-balanced selection

The reproducible generation script is available in the repository at `GennData/build_test_datasets.py`.

## File Format

All files are CSV (Comma-Separated Values) format with:
- UTF-8 encoding
- Header row with column names
- One sample per row
- No missing UW_Sample_ID values

## Notes

- The literal string `blind` appears in `Time_point`, `Dose_Rate`, and `Dose_cGy` for samples whose labels were withheld in the published challenge. This is by design.
- Reference samples (IBR, IER) use `pool` for Time_point, Dose_Rate, and Dose_cGy because they are pooled lysates with no single experimental condition.
- The `na` value indicates "not applicable" (e.g., Focus_Area for reference samples, Dose_Rate for sham controls).
