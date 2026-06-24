# How to Use Octopus with Test Data

This guide shows you how to use Octopus with the provided test files from a published mouse radiation proteomics study.

## About the Test Data

The test files contain sample metadata from a study investigating low-dose X-ray radiation effects on mouse dorsal skin tissue (Zelter et al. 2026, bioRxiv). The study includes:

- **Radiation types**: X-ray irradiation at low dose rate (LDR, 3 cGy/min) and high dose rate (HDR, 28 cGy/min), plus sham controls
- **Radiation doses**: 0, 10, 25, 75, and 100 cGy
- **Timepoints**: 7, 14, 21, 90, 120, and 150 days post-irradiation
- **Focus areas**: FA1 (early, 7–21 days) and FA2 (late, 90–150 days)
- **Sample roles**: Training samples, blinded samples, baseline controls, and QC/reference pools

## Quick Start Tutorial

### Step 1: Download a Test File

- **octopus_test_dataset_small.csv** (288 samples, 3 plates) — Quick demo, clean balance
- **octopus_test_dataset.csv** (936 samples, 10 plates) — Full dataset, real-world complexity

### Step 2: Open in Octopus

1. Open Octopus
2. Click "Choose File"
3. Select your downloaded CSV file
4. Wait for the file to load (sample count will appear)

### Step 3: Configure Settings

#### ID Column
Select: **`UW_Sample_ID`**

#### QC/Reference Column
Select: **`Set`**

Check these values:
- ☑ **`UW IB Reference`** — Inter-Batch Reference pool
- ☑ **`UW IE Reference`** — Inter-Experiment Reference pool

(For the full files, also check ☑ **`UW IC Reference`** — Internal Control)

#### Covariates (Recommended)
Select: **`Condition`** + **`Focus_Area`**

This creates 14 covariate groups (small file) or 37 groups (full files) that balance:
- Treatment condition (Training at various doses/rates, Baseline controls, Blinded holdout)
- Experimental phase (FA1 = early timepoints, FA2 = late timepoints)

**Alternative: Using Multiple Design Columns (full file)**

With `octopus_test_dataset.csv`, you can instead select: **`Focus_Area`** + **`Set`** + **`Dose_Rate`** + **`Dose_cGy`**

This also produces 37 groups, demonstrating how Octopus constructs covariate groups from multiple columns. The pool-aware `Dose_Rate` and `Dose_cGy` columns write `pool` for samples that intentionally span multiple values, preventing unwanted group splitting.

#### Plate Dimensions
Keep default: **8 rows × 12 columns** (96-well plate)

### Step 4: Generate Plates

Click **"Generate Randomized Plates"**

### Step 5: Review Results

#### Check Quality Scores
Click the **"Quality"** button to see:
- Overall quality score
- Average balance score (how evenly samples are distributed)
- Average clustering score (how well samples are spatially separated)
- Individual plate scores

#### View Covariate Summary
Click **"Show Covariate Summary"** to see:
- All covariate groups with color coding
- Sample counts per group (sorted from most to least)
- QC/Reference groups (marked with red dashed border and "QC" badge)

#### Inspect Plates
- **Compact View** (default): See overall distribution patterns
- **Full Size View**: See detailed sample information in each well
- Click the **"i"** icon on any plate for detailed balance metrics

#### Interactive Features
- **Highlight Groups**: Click any covariate group in the summary to highlight those samples across all plates
- **Move Samples**: Drag and drop samples between wells or plates
  - Quality scores update automatically after moves
  - Useful for manual optimization or specific placement requirements
- **Plate Details**: Click "i" to see expected vs. actual counts for each group

### Step 6: Optimize (Optional)

#### Global Re-randomization
Click **"Re-randomize"** to generate a completely new distribution if:
- Quality scores are lower than desired
- You want to explore alternative arrangements

#### Individual Plate Re-randomization
Click the **"R"** button on any plate header to re-randomize just that plate while keeping others unchanged.

### Step 7: Export Results

#### CSV Export
Click **"Download CSV"** to get:
- All original sample data
- Assigned plate numbers
- Well positions (e.g., A01, B05)

#### Excel Export
Click **"Download Excel"** to get:
- Color-coded plates matching the visual display
- Select which covariates to include
- Formatted for easy printing and reference

#### Save Layout (Reproducible Record)
Click **"Save Layout"** to save the plate arrangement together with the settings that produced it, in a single CSV file. Later, click **"Load Layout"** (next to Choose File at the top) to read it back and reproduce the exact same layout, with all settings and colors restored. This is a durable record for an audit trail.

### Step 8: Export Injection Sequence (Optional)

If you want to export a Thermo Fisher Scientific instrument-ready acquisition sequence, click **"Export Sequence"** to launch the Injection Sequence Export wizard. The wizard walks you through six configuration steps and produces a CSV in the Thermo format with file names, folder paths, instrument methods, autosampler positions, and injection volumes.

For this test dataset, a typical configuration is:

1. **System Suitability**: Skip (leave all run counts at 0) for a quick test, or set 3 runs at start and 2 at end to see SS rows in the preview.
2. **Slot Assignment**: Accept the default — Plate 1 → Yellow, Plate 2 → Blue, Plate 3 → Red.
3. **File Naming**: Add fields like `experiment name`, `plate well`, and `sample identifier`. Set Experiment Name to something like `trx_phase2`. The Run Number is appended automatically.
4. **Sample Categories**: IB Reference and IE Reference samples are auto-assigned to their respective QC categories; everything else lands in **Experimental**. No changes needed for the default test data.
5. **Paths & Instrument Methods**: Enter any folder path (e.g., `D:\Data\trx_phase2`) and instrument method path (e.g., `D:\Methods\DIA_4mz.meth`). Use **"Apply to all categories"** to fill every category at once. Keep injection volume at 3 µL.
6. **Preview & Export**: Verify the run order and file names, then click **Export Sequence CSV**.

See [octopus_doc.html](octopus_doc.html#step-7-export-injection-sequence-optional) for the full wizard reference.

## Expected Results

### Small Dataset (288 samples, 3 plates)

**Distribution per Plate (approximate):**
- 12 IB Reference samples (evenly across rows)
- 12 IE Reference samples (evenly across rows)
- 4 Training samples per dose/rate combination (8 conditions × 4 = 32)
- 8 Baseline samples per focus area (2 × 8 = 16)
- 12 Blinded samples per focus area (2 × 12 = 24)

**Quality Scores:**
- Both balance and clustering scores should be excellent (90+)

### Full Dataset (936 samples, 10 plates)

**Distribution:**
- QC/Reference samples distributed across all plates
- Training and Baseline samples balanced by dose, rate, and focus area
- Blinded and Partial samples evenly distributed

**Quality Scores:**
- Both balance and clustering scores should be good to excellent

## Understanding the Covariate Groups

### Small File (14 groups with `Condition` + `Focus_Area`)

#### QC/Reference Groups (2)
- `Inter-Batch Reference (IBR)|na` — Pooled lysate QC (36 samples)
- `Inter-Experiment Reference (IER)|na` — Cross-experiment QC (36 samples)

#### Blinded Groups (2)
- `Blinded_Xray|FA1` — Blinded holdout, early timepoints (36 samples)
- `Blinded_Xray|FA2` — Blinded holdout, late timepoints (36 samples)

#### Baseline Groups (2)
- `Baseline_0cGy_Xray|FA1` — Sham controls, early (24 samples)
- `Baseline_0cGy_Xray|FA2` — Sham controls, late (24 samples)

#### Training Groups (8)
- `Training_Xray_LDR_10cGy|FA1` — 10 cGy, low dose rate, early (12 samples)
- `Training_Xray_LDR_10cGy|FA2` — 10 cGy, low dose rate, late (12 samples)
- `Training_Xray_LDR_75cGy|FA1` — 75 cGy, low dose rate, early (12 samples)
- `Training_Xray_LDR_75cGy|FA2` — 75 cGy, low dose rate, late (12 samples)
- `Training_Xray_HDR_10cGy|FA1` — 10 cGy, high dose rate, early (12 samples)
- `Training_Xray_HDR_10cGy|FA2` — 10 cGy, high dose rate, late (12 samples)
- `Training_Xray_HDR_75cGy|FA1` — 75 cGy, high dose rate, early (12 samples)
- `Training_Xray_HDR_75cGy|FA2` — 75 cGy, high dose rate, late (12 samples)

## Tips for Best Results

### Achieving High Balance Scores

1. **Use recommended covariates**: `Condition` + `Focus_Area` provides optimal balance
2. **Check plate details**: Click "i" on plates with lower scores to see which groups are imbalanced
3. **Re-randomize if needed**: Try global or individual plate re-randomization to improve scores

### Improving Clustering Scores

1. **Re-randomize individual plates**: Plates with low clustering scores can be re-randomized independently
2. **Manual adjustment**: Drag and drop samples to reduce clustering of same-group samples
3. **Accept reasonable scores**: Some clustering is unavoidable with large groups (e.g., Blinded_Xray has 36 samples per FA)

### Working with QC Samples

- QC samples (IB Reference and IE Reference) should appear on every plate
- Each row should have 1–2 QC samples for quality monitoring
- QC samples are visually distinguished with darker colors and red dashed borders

### Manual Sample Movement

You can drag and drop samples to:
- Swap positions within a plate
- Move samples between plates
- Manually optimize spatial distribution
- Place specific samples in desired positions

**Note**: Quality scores update automatically after each move, allowing you to see the impact of manual adjustments in real-time.

## Troubleshooting

### Low Balance Scores

**Possible causes:**
- Too many covariates selected (creates many small groups)
- Some covariate groups are very small relative to plate capacity

**Solutions:**
- Try using fewer covariates (e.g., just `Condition` + `Focus_Area`)
- Use the "Re-randomize" button
- Check plate details to identify problematic groups

### Low Clustering Scores

**Possible causes:**
- Large groups naturally cluster more (e.g., Blinded_Xray with 36 samples per FA)
- Random placement resulted in adjacent same-group samples

**Solutions:**
- Re-randomize individual plates with low scores
- Manually move samples to reduce clustering

## Advanced Usage

### Testing Different Covariate Combinations

Try these to see how they affect distribution:

1. **Recommended** (`Condition` + `Focus_Area`): 14 groups (small) or 37 groups (full), optimal balance
2. **Multi-column** (`Focus_Area` + `Set` + `Dose_Rate` + `Dose_cGy`, full file): 37 groups, demonstrates multi-column group construction
3. **Minimal** (`Condition` only): Fewer groups (references collapse since Focus_Area is not distinguishing them), higher balance but less granular

### Exporting for Different Purposes

- **CSV**: Simple format for data analysis, import into other tools
- **Excel**: Visual reference, color-coded for easy identification, good for lab use
- **Save Layout**: A reproducible record of the run that you can load back later to recreate the exact same layout and settings

## Need More Help?

- **Full Documentation**: See [octopus_doc.html](octopus_doc.html) for complete user guide
- **Test File Details**: See [test-files-readme.html](test-files-readme.html) for column descriptions and data provenance
