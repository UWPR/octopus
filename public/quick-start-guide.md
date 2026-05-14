# How to Use OCTOPUS with Test Data

This guide shows you how to use OCTOPUS Plate Designer with the provided test files from a mouse radiation study.

## About the Test Data

The test files contain samples from a mouse study investigating radiation effects on mouse skin tissue. The study includes:

- **Mouse strains**: Balb_cJ and C57BL6
- **Radiation types**: X-ray irradiation and controls
- **Timepoints**: Multiple days post-irradiation (1, 6, 14, 90, 130, 150 days)
- **Radiation doses**: Various doses in centiGray (0, 100, 108, 200, 400, 433 cGy)
- **Focus areas**: Two study areas (FA1, FA2)
- **Sample types**: Training samples, blinded samples, controls, and QC/reference pools

## Quick Start Tutorial

### Step 1: Download a Test File

- **trx-phase1b-small.csv** (288 samples, 3 plates) - Quick demo, perfect balance
- **trx-phase1b-full.csv** (672 samples, 7 plates) - Full dataset, real-world complexity

### Step 2: Upload to OCTOPUS

1. Open OCTOPUS Plate Designer
2. Click "Choose File"
3. Select your downloaded CSV file
4. Wait for the file to load (sample count will appear)

### Step 3: Configure Settings

#### ID Column
Select: **`Sample ID`**

#### QC/Reference Column
Select: **`Condition`**

Check these values:
- ☑ **`BatchQC`** - Quality control pool samples
- ☑ **`BatchRef`** - Reference pool samples

#### Covariates (Recommended)
Select: **`Condition`**, **`Radiaion Dose_cGy`**, **`Focus Area`**

This creates 14 unique covariate combinations that balance:
- Sample type (Training, Blinded, Control, QC)
- Radiation dose
- Study focus area

**Alternative: Using the Description Column**

The `Description` column is a researcher-created field that combines multiple experimental factors into a single label (e.g., `TnE_Training_4Gy_FA1` indicates a Training sample with 4Gy radiation in focus area FA1).

You can use `Description` as a single covariate instead of the three recommended covariates. However, note:
- **Advantage**: Simpler selection (1 covariate instead of 3)
- **Disadvantage**: Less granular control - for example, all Control samples are grouped as `Xray_Balb_Control` regardless of radiation dose
- **Recommended approach**: Using `Condition` + `Radiaion Dose_cGy` + `Focus Area` splits Control samples into 4 separate dose groups, providing better balance across radiation doses

#### Plate Dimensions
Keep default: **8 rows × 12 columns** (96-well plate)

#### Empty Spots
Keep checked: **"Keep empty spots in last plate"**

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
- All 14 covariate groups with color coding
- Sample counts per group
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

### Step 8: Export Injection Sequence (Optional)

If you want to produce a Thermo Fisher instrument-ready acquisition sequence, click **"Export Sequence"** to launch the Injection Sequence Export wizard. The wizard walks you through six configuration steps and produces a CSV in the Thermo `Bracket Type=4` format with file names, folder paths, instrument methods, autosampler positions, and injection volumes.

For this test dataset, a typical configuration is:

1. **System Suitability**: Skip (leave all run counts at 0) for a quick test, or set 2 runs at start and 2 at end to see SS rows in the preview.
2. **Slot Assignment**: Accept the default — Plate 1 → Yellow, Plate 2 → Blue, Plate 3 → Red.
3. **File Naming**: Add fields like `experiment name`, `plate well`, and `sample identifier`. Set Experiment Name to something like `trx_phase1b_small`. The Run Number is appended automatically.
4. **Sample Categories**: `BatchQC` and `BatchRef` samples are auto-assigned to their respective QC categories; everything else lands in **Experimental**. No changes needed for the default test data.
5. **Paths & Instrument Methods**: Enter any folder path (e.g., `D:\Data\trx_phase1b`) and instrument method path (e.g., `D:\Methods\standard.meth`). Use **"Apply to all categories"** to fill every category at once. Keep injection volume at 3 µL.
6. **Preview & Export**: Verify the run order and file names, then click **Export Sequence CSV**.

See [octopus_doc.html](octopus_doc.html#step-7-export-injection-sequence-optional) for the full wizard reference.

## Expected Results

### Small Dataset (288 samples, 3 plates)

**Distribution per Plate:**
- 8 BatchQC samples (1 per row)
- 8 BatchRef samples (1 per row)
- 8 Control samples (2 per radiation dose)
- 24 Training samples
- 48 Blinded samples

**Quality Scores:**
- Both balance and clustering scores should be excellent

### Full Dataset (672 samples, 7 plates)

**Distribution:**
- QC samples distributed across all plates
- Control samples balanced by dose
- Training and Blinded samples evenly distributed

**Quality Scores:**
-  Both balance and clustering scores should be excellent

## Understanding the Covariate Groups

When you select **Condition**, **Radiaion Dose_cGy**, and **Focus Area**, you get 14 groups:

### QC/Reference Groups (2)
- `BatchQC|na|na` - Quality control pool
- `BatchRef|na|na` - Reference pool

### Blinded Groups (2)
- `Blinded|na|FA1` - Blinded samples, focus area 1
- `Blinded|na|FA2` - Blinded samples, focus area 2

### Training Groups (6)
- `Training|0|FA1` - No radiation, focus area 1
- `Training|0|FA2` - No radiation, focus area 2
- `Training|108|FA1` - 108 cGy, focus area 1
- `Training|108|FA2` - 108 cGy, focus area 2
- `Training|433|FA1` - 433 cGy, focus area 1
- `Training|433|FA2` - 433 cGy, focus area 2

### Control Groups (4)
- `Control|0|na` - No radiation control
- `Control|100|na` - 100 cGy control
- `Control|200|na` - 200 cGy control
- `Control|400|na` - 400 cGy control

## Tips for Best Results

### Achieving High Balance Scores

1. **Use recommended covariates**: The combination of Condition, Dose, and Focus Area provides optimal balance
2. **Check plate details**: Click "i" on plates with lower scores to see which groups are imbalanced
3. **Re-randomize if needed**: Try global or individual plate re-randomization to improve scores

### Improving Clustering Scores

1. **Re-randomize individual plates**: Plates with low clustering scores can be re-randomized independently
2. **Manual adjustment**: Drag and drop samples to reduce clustering of same-group samples
3. **Accept reasonable scores**: Some clustering is unavoidable with large groups

### Working with QC Samples

- QC samples (BatchQC and BatchRef) should appear on every plate
- Each row should have 1-2 QC samples for quality monitoring
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
- Too many covariates selected
- Some covariate groups are very small
- Uneven sample distribution

**Solutions:**
- Try using fewer covariates
- Use the "Re-randomize" button
- Check plate details to identify problematic groups

### Low Clustering Scores

**Possible causes:**
- Large groups naturally cluster more
- Random placement resulted in adjacent same-group samples

**Solutions:**
- Re-randomize individual plates with low scores
- Manually move samples to reduce clustering


## Advanced Usage

### Testing Different Covariate Combinations

Try these to see how they affect distribution:

1. **Recommended** (`Condition` + `Radiaion Dose_cGy` + `Focus Area`): 14 groups, optimal balance, splits Control samples by dose, more granular control over radiation dose distribution
2. **Minimal** (`Condition` only): 5 groups, high balance scores, low clustering score due to large groups, loses dose/focus information
3. **Description Only**: Uses researcher-created labels, simpler but lumps all Control samples together as `Xray_Balb_Control`


### Exporting for Different Purposes

- **CSV**: Simple format for data analysis, import into other tools
- **Excel**: Visual reference, color-coded for easy identification, good for lab use

## Need More Help?

- **Full Documentation**: See [octopus_doc.html](octopus_doc.html) for complete user guide
- **Test File Details**: See [test-files-readme.html](test-files-readme.html) for information about test file creation
