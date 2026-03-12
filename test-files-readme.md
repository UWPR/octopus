# OCTOPUS Test Data Files

This directory contains example CSV files for testing the OCTOPUS Block Randomizer application.

## Available Test Files

### 1. trx-phase1b-full.csv
**Full dataset with 672 samples from TRX T&E Phase 1b mouse study**

- **Total Samples**: 672
- **Plates**: Exactly 7 plates (96-well format, 8×12)
- **Sample Distribution**:
  - Blinded: 400 samples
  - Control: 94 samples
  - Training: 72 samples
  - BatchRef: 53 samples (QC/Reference)
  - BatchQC: 53 samples (QC/Reference)

**Use Case**: Testing with large datasets, multiple plates, real-world complexity

### 2. trx-phase1b-small.csv
**Small dataset with 288 samples (3 full plates)**

- **Total Samples**: 288
- **Plates**: Exactly 3 plates (96-well format, 8×12)
- **Sample Distribution**:
  - Blinded: 144 samples (72 per Focus Area)
  - Training: 72 samples (12 per dose/focus area combination)
  - BatchQC: 24 samples (1 per row, 8 per plate)
  - BatchRef: 24 samples (1 per row, 8 per plate)
  - Control: 24 samples (6 per dose, 2 per dose per plate)

**Design Features**:
- Each row has exactly 1 BatchQC and 1 BatchRef sample
- Each plate has 2 samples of each Control+radiation dose combination
- All covariate combinations (Condition|Dose|Focus Area) are evenly divisible by 3 for uniform distribution

**Use Case**: Quick demonstrations, tutorials, testing balanced distribution across 3 plates

## How to Use These Files

See [how-to-use-octopus.md](how-to-use-octopus.md) for detailed instructions on using these test files with OCTOPUS.

## Column Descriptions

All test files contain the following columns:

| Column | Description | Example Values |
|--------|-------------|----------------|
| **Sample ID** | Unique sample identifier | TRX-TE-MSP-0623 |
| **Strain** | Mouse strain | Balb_cJ, C57BL6 |
| **IR Type** | Irradiation type | Xray, Control, pool |
| **IR Location** | Irradiation location | TBI, pool |
| **Timepoint** | Days post-irradiation | 1, 6, 14, 90, 130, 150, pool |
| **Radiaion Dose_cGy** | Radiation dose in centiGray | 0, 100, 108, 200, 400, 433 |
| **Focus Area** | Study focus area | FA1, FA2 |
| **Condition** | Simplified condition label | Training, Blinded, Control, BatchQC, BatchRef |
| **Description** | Researcher-created detailed description combining multiple factors | TnE_Training_4Gy_FA1, Xray_Balb_Control |
| **Gender** | Sample gender | Male, Female, Mix |

### About the Description Column

The `Description` column is a researcher-created field that combines multiple experimental factors into a single label. For example:
- `TnE_Training_4Gy_FA1` = Training sample, 4Gy radiation, Focus Area 1
- `TnE_Baseline_0Gy_FA2` = Training sample (baseline), 0Gy radiation, Focus Area 2
- `Xray_Balb_Control` = Control sample (all radiation doses lumped together)

**Using Description vs. Individual Covariates:**

You can use `Description` as a single covariate, but this has limitations:
- **Advantage**: Simpler - one covariate instead of three
- **Disadvantage**: Less granular - all Control samples are grouped as `Xray_Balb_Control` regardless of radiation dose

**Recommended approach**: Use `Condition` + `Radiaion Dose_cGy` + `Focus Area` as separate covariates. This splits Control samples into 4 groups by dose (0, 100, 200, 400 cGy), providing better balance and more precise control over radiation dose distribution.

## Data Source and Processing

### Original Source
`TRX T&E Phase 1b Metadata copy-MJM v2 - v2-1b_mouse_pelt_meta.csv`

### Processing Steps

1. **Column Selection**: Extracted relevant experimental covariates
2. **Column Renaming**:
   - `search name` → `Sample ID`
   - `Timepoint_days` → `Timepoint`
3. **Condition Simplification**: Simplified condition labels for clarity
   - `Training_4Gy_FA1` → `Training`
   - `Baseline-Training_0Gy_FA2` → `Training`
   - `Xray_Balb_Control` → `Control`
   - `BatchQC` and `BatchRef` unchanged
4. **Column Removal**: Removed administrative columns (plate assignments, dates, filenames)

### Small Dataset Creation

The small dataset (288 samples) was specifically designed for optimal demonstration:

1. **QC Samples**: Selected 24 BatchQC + 24 BatchRef (1 of each per row)
2. **Control Samples**: Selected 6 per radiation dose (4 doses × 6 = 24 total)
3. **Training Samples**: Included all 72 training samples (6 dose/focus combinations)
4. **Blinded Samples**: Randomly selected 72 from each focus area (144 total)

**Result**: All 14 covariate combinations are evenly divisible by 3, ensuring perfect uniform distribution across 3 plates.

## Recommended OCTOPUS Configuration

For both test files, use these settings:

- **ID Column**: `Sample ID`
- **QC/Reference Column**: `Condition`
- **QC/Reference Values**: `BatchQC`, `BatchRef`
- **Covariates**: `Condition`, `Radiaion Dose_cGy`, `Focus Area`
- **Algorithm**: `Balanced Block Randomization`
- **Plate Dimensions**: 8 rows × 12 columns (96-well plate)

This configuration creates 14 unique covariate groups with optimal balance and distribution.

## Study Background

These samples are from a mouse radiation study investigating:
- Effects of different radiation doses on mouse skin tissue
- Time-course analysis post-irradiation

The study includes:
- **Training samples**: Known conditions for model training
- **Blinded samples**: Unknown conditions for testing
- **Control samples**: Various radiation doses for comparison
- **QC/Reference samples**: Quality control and reference pools for batch monitoring

## File Format

All files are CSV (Comma-Separated Values) format with:
- UTF-8 encoding
- Header row with column names
- One sample per row
- No missing Sample ID values

## Notes

- The typo "Radiaion" (instead of "Radiation") in the dose column name is preserved from the original data
- Some samples have "na" values for certain covariates (e.g., Blinded samples have no dose information)
- QC/Reference samples (BatchQC, BatchRef) have "na" for most experimental covariates as they are pooled samples
