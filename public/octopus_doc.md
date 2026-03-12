# Octopus Plate Designer

## What is Octopus Plate Designer?

Octopus Plate Designer is a web application designed to optimize the distribution of experimental samples across multiple plates (e.g., 96-well plates). The tool ensures that samples are distributed in a balanced and randomized manner, helping researchers minimize bias and maintain statistical validity in their experiments.

### Key Purposes

**Balanced Distribution**: The app ensures each plate contains a representative mix of sample types based on your selected covariates (such as treatment, time points, dose levels, or other experimental factors).

**Spatial Randomization**: Samples are positioned on plates to minimize clustering of similar samples in rows and columns, reducing potential position-based biases.

**Quality Assessment**: Built-in metrics evaluate how well your sample distribution achieves balance and randomization, helping you identify and correct issues before running experiments.

**Flexible Configuration**: Customizable plate dimensions allow you to adapt the randomization strategy to your specific experimental needs.

---

## How Octopus Plate Designer Works

### The Randomization Process

1. **Sample Classification**: Your samples are grouped based on selected covariates (experimental factors like treatment type, time point, etc.)

2. **Proportional Distribution**: Samples are distributed across plates so that each plate receives a proportional representation of each covariate group

3. **Spatial Placement**: Within each plate, samples are positioned using a greedy process that minimizes adjacency (horizontal, vertical, cross-row) of identical covariate groups. Randomness is introduced via shuffling and tie‑breaking, but the primary objective is reduced clustering rather than pure uniform randomness.

4. **Quality Evaluation**: Balance and clustering scores are calculated to assess the quality of the distribution

---

## How to Use Octopus Plate Designer

### Step 1: Upload Your Data

Prepare a CSV file containing your sample information with:
- A unique identifier column for each sample
- One or more columns representing experimental covariates (factors you want to balance)

Click **Choose File** to select and upload your CSV file.

### Step 2: Configuration

#### Select ID Column
Choose which column contains your unique sample identifiers. The app will automatically select common identifier column names like "_UW_Sample_ID_" or "_search name_".

#### Choose Covariates
Select which experimental factors should be balanced across plates. You can select multiple covariates (e.g., Treatment, Time Point, Dose Level). The selected covariates will be displayed below the selection box.
Each unique combination of the selected covariate values becomes a distinct "covariate group". Internally the app concatenates the selected column values with a `|` separator to form a covariate group key (e.g. `Treatment|Time|Dose`). All samples sharing the same combination are pooled together for proportional distribution.

Example:

| Sample_ID | Treatment | Time | Dose |
|-----------|----------|------|------|
| S1        | DrugA    | 0h   | Low  |
| S2        | DrugA    | 0h   | Low  |
| S3        | DrugA    | 24h  | Low  |
| S4        | DrugB    | 0h   | High |
| S5        | Control  | n/a   | n/a  |

If you select Treatment + Time, the grcovariate group keys are:
`DrugA|0h` (S1,S2), `DrugA|24h` (S3), `DrugB|0h` (S4), `Control|n/a` (S5).

If you select Treatment + Time + Dose, the keys are:
`DrugA|0h|Low` (S1,S2), `DrugA|24h|Low` (S3), `DrugB|0h|High` (S4), `Control|n/a|n/a` (S5).

These groupings drive plate-level and row-level expected minimum calculations and distribution.

#### Set QC/Reference Samples (Optional)
Select a column that identifies quality control or reference samples, then check the values that represent QC/reference samples.

**How it works:**
1. Select a column from the "QC/Reference Column" dropdown (e.g., "Sample_Type")
2. Check the boxes for values that represent QC/Reference samples (e.g., "QC", "Reference")
3. Samples with these values will be marked as QC/Reference samples

**Covariate key generation:**
- If the QC column is NOT selected as a treatment covariate, the QC value is prepended to the covariate key (e.g., `QC|DrugA|0h`)
- If the QC column IS selected as a treatment covariate, it's treated like any other covariate (no prefix)

QC/Reference samples will be visually distinguished in the summary panel (see Covariate Summary Panel section below).

#### Configure Plate Dimensions
- **Rows**: Set from 1-16 (default: 8)
- **Columns**: Set from 1-24 (default: 12)
- The total plate capacity (rows × columns) is displayed automatically

![Configuration - Plate Size](images/octopus_config-plate-size.png)

#### Choose Empty Cell Distribution
When your sample count doesn't fill all available wells, use the **"Keep empty spots in last plate"** checkbox:

- **Checked** (default): All empty wells are concentrated in the final plate, keeping all other plates fully populated
- **Unchecked**: Empty wells are distributed across all plates and available rows, creating a more uniform fill level across all plates

This setting affects plate capacity calculations and can impact how samples are distributed across plates.

### Step 3: Generate Randomized Plates

Click the **"Generate Randomized Plates"** button to create your sample distribution.

### Step 4: Review and Evaluate

#### View Modes

**Compact View** (Default)
- Small cells (18×16 pixels)
- Ideal for visualizing overall distribution patterns
- Hover over cells to see sample details

![Compact Plates](images/octopus_compact-plates.png)

**Full Size View**
- Large cells (100×60 pixels) display complete information
- Sample names and covariate values visible directly in each well
- Better for detailed inspection

![Full Plate](images/octopus_full-plate.png)

Switch between views using the **"Compact View"** / **"Full Size View"** button.

#### Covariate Summary Panel

Click **"Show/Hide Covariate Summary"** to display:
- All unique covariate groups with color indicators
- Sample counts for each group (sorted from most to least samples)
- Values for each covariate in the group

![Show Covariate Summary Button](images/octopus_show-covariate-summary-btn.png)

![Covariate Summary](images/octopus_covariate-summary.png)

**QC/Reference Visual Indicators** (if QC/Reference samples are configured):
- QC/Reference covariate groups are displayed with a **red dashed border**
- A **"QC" badge** appears on these groups
- These groups are **listed first** in the summary panel for easy identification

**Interactive Highlighting**: Click any covariate group in the summary to highlight all samples from that group across all plates (blue glowing border).

![Compact Plates Selected Covariate Highlighted](images/octopus_compact-plates-covariate-highlighted.png)

#### Quality Metrics

**Overall Quality Button**: Shows experiment-wide quality score and level (Excellent, Good, Fair, Poor, or Bad)

Click the quality button to open the **Quality Assessment Modal** showing:
- Overall quality score and level
- Average balance and clustering scores across all plates
- Individual scores for each plate with quality badges

**Plate Headers**: Each plate displays:
- **Bal**: Balance score (0-100) for that plate
- **Clust**: Clustering score (0-100) for that plate
- **Overall**: Combined score displayed with color-coded quality badge

#### Plate Details Popup

Click the **"i"** icon in any plate header to view:
- Plate capacity and sample count
- Quality scores (balance and clustering)
- Detailed breakdown of each covariate group on that plate:
  - Color indicator matching the plate display
  - Sample proportions (plate count / total group count)
  - Expected vs. actual sample counts
  - Deviation percentages
  - Individual balance scores


### Step 5: Refine Your Randomization (Optional)

#### Global Re-randomization
Click the main **"Re-randomize"** button to generate a completely new distribution for all plates while preserving your configuration settings.

#### Individual Plate Re-randomization
Click the **"R"** button in any plate header to re-randomize only that specific plate. Quality scores update automatically after any re-randomization.

### Step 6: Export Your Results

Once satisfied with the distribution, click **"Download CSV"** or **"Download Excel"** to save your plate assignments.

**CSV Export**: Includes all original sample data plus assigned plate numbers and well positions.

**Excel Export**: Opens a modal allowing you to select which covariates to include in the Excel file. The exported file contains:
- Color-coded plates matching the visual display
- Selected covariate information for each sample
- Plate and well position assignments

---

## Understanding Quality Scores

### Balance Score (0-100)
Measures how proportionally each covariate group is represented on each plate compared to the overall population. Higher scores indicate better balance.

**Calculation:**
For each covariate group on each plate:
```
Actual Proportion = Actual Count / Plate Capacity
Expected Proportion = Group Size / Total Samples
Relative Deviation = |Actual Proportion - Expected Proportion| / Expected Proportion
```

The overall plate balance uses weighted averaging based on global covariate group proportions, ensuring large groups influence the score proportionally while very rare groups have limited impact.

### Clustering Score (0-100)
Measures spatial clustering by counting same-covariate group adjacencies across the entire plate. The score evaluates three types of adjacencies:
- **Horizontal**: Same row, adjacent columns (left-right neighbors)
- **Vertical**: Same column, adjacent rows (up-down neighbors)
- **Cross-row**: Last column of row N adjacent to first column of row N+1

The score is calculated as: `Score = (1 - actualClusters / maxPossibleAdjacencies) × 100`

Higher scores indicate better spatial distribution with fewer same-treatment samples adjacent to each other. A score of 100 means no same-treatment adjacencies, while lower scores indicate more clustering.

### Overall Score
The average of balance and clustering scores, calculated at both plate level and experiment level.

### Quality Levels

| Score Range | Quality Level |
|-------------|---------------|
| 90-100 | Excellent |
| 80-89 | Good |
| 70-79 | Fair |
| 60-69 | Poor |
| 0-59 | Bad |

---

## Tips for Best Results

1. **Select Relevant Covariates**: Choose only the experimental factors that matter for your analysis. Too many covariates can make it diffcult to achieve a balanced distribution.

2. **Use QC/Reference Column**: Specifying QC/Reference labels helps you quickly identify these samples in the plate layout.

3. **Inspect Distributions**: Use the covariate summary and interactive highlighting to verify that key sample groups are well-distributed across plates.

4. **Use Compact View First**: Start with the compact view to identify any obvious distribution issues, then switch to full size for detailed verification.

5. **Check Plate Details**: Review the plate details popup for each plate to ensure expected counts align with actual counts.

---

## Color Coding

The app uses 24 distinct bright colors to represent different covariate groups. For experiments with more groups:

- **Groups 1-24**: Solid color fill
- **Groups 25-48**: Outline only (transparent fill)
- **Groups 49-72**: Diagonal stripes pattern

This system supports up to 72 unique covariate groups while maintaining visual distinction.

**QC/Reference Sample Colors**: When QC/Reference samples are configured, their covariate groups are assigned darker color variants from a separate palette. This makes QC/Reference samples easily distinguishable from treatment samples at a glance, helping you quickly verify their distribution across plates.

---

## Technical Details

### Algorithm Details

**Balanced Randomization**
- Distributes samples proportionally across plates and rows
- Uses greedy spatial placement to minimize adjacency clustering

Detailed Steps:
1. **Grouping**: Samples are grouped by concatenated covariate values (e.g. `Treatment|Time|Dose`).
2. **Plate Capacity Assignment**: Plate capacities are computed based on total sample count, plate size and whether empty wells are concentrated in the final plate or spread across plates.
3. **Expected Minimums (Plate Level)**: For every (plate, group) an expected minimum count is computed from `floor(groupSize / numPlates)` scaled by plate capacity ratio (for partial plates). Prevents early overfilling.
4. **Phase 1 Proportional Placement**: Baseline expected minimum samples for each group are placed into plates. Remaining samples are tagged as either unplaced (group too small for baseline) or overflow (extras beyond baseline).
5. **Phase 2A (Unplaced Groups)**: Small groups are added to plates prioritizing those with the most remaining capacity—spreads rare groups.
6. **Phase 2B (Overflow Samples)**: Remaining samples of larger groups are added with a prioritization strategy: plate level prefers higher-capacity plates; row level prefers rows currently containing fewer of that group.
7. **Row Distribution**: For each plate, rows are treated as mini-blocks; the same proportional + overflow logic is applied using row capacities.
8. **Greedy Spatial Placement**: Within each populated row, samples are placed into columns minimizing a cluster score (penalties for same-group left/right/above and cross-row adjacency). Random tie-breaking preserves diversity.
9. **Final Spatial Metrics**: Horizontal, vertical and cross-row cluster counts logged for diagnostic quality analysis.


### Quality Score Calculations

#### Balance Score
For each covariate group on each plate, the balance score evaluates how closely the actual sample distribution matches the expected proportional distribution:

```
Actual Proportion = Actual Count / Plate Capacity
Expected Proportion = Group Size / Total Samples
Relative Deviation = |Actual Proportion - Expected Proportion| / Expected Proportion
Balance Score = max(0, 100 - (Relative Deviation × 100))
```

The overall plate balance uses weighted averaging based on global covariate group proportions. Each group's relative deviation is multiplied by its global expected proportion, ensuring large groups influence the score proportionally while very rare groups have limited impact:

```
WeightedDeviation(group) = RelativeDeviation(group) × GlobalExpectedProportion(group)
OverallWeightedDeviation = Σ WeightedDeviation / Σ GlobalExpectedProportion
PlateBalanceScore = max(0, 100 − (min(OverallWeightedDeviation, 1) × 100))
```

Group-level balance scores are listed separately to identify which combinations drive penalties.

#### Clustering Score
The clustering score measures spatial distribution quality by analyzing same-treatment adjacencies:

**Calculation Method:**
1. **Count actual clusters**: For each filled position, check if adjacent positions (right, below, cross-row) contain samples from the same treatment group
   - Horizontal adjacency: Same row, next column
   - Vertical adjacency: Same column, next row
   - Cross-row adjacency: Last column of row N to first column of row N+1

2. **Calculate maximum possible adjacencies**: Count all potential adjacency pairs between filled positions

3. **Compute clustering ratio**: `clusterRatio = totalClusters / maxPossibleAdjacencies`

4. **Convert to score**: `ClusteringScore = (1 - clusterRatio) × 100`

**Score Interpretation:**
- **100**: Perfect distribution - no same-treatment adjacencies (ideal checkerboard pattern)
- **75-99**: Good distribution - minimal clustering
- **50-74**: Moderate clustering - some same-treatment neighbors
- **0-49**: High clustering - many same-treatment adjacencies

**Special Cases:**
- Empty plates or single-sample plates: Score = 100 (no adjacencies possible)
- No possible adjacencies: Score = 100

The clustering score complements the balance score by ensuring samples are not only proportionally distributed but also spatially dispersed to minimize position-based biases.

#### Overall Scores
- **Plate Overall Score** = (Balance Score + Clustering Score) / 2
- **Experiment Scores** = Average of all plate scores

---
