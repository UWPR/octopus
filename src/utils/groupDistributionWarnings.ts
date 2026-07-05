import { SummaryItem, QualityMetrics, SearchData } from './types';
import { QUALITY_LEVEL_CONFIG } from './configs';

/**
 * Group distribution warnings.
 *
 * A non-blocking diagnostic that flags covariate groups that are poorly
 * distributed across plates or rows. It never disables Generate and never
 * changes randomization, colors, or scores. It only reads existing state.
 *
 * A group is flagged when one of these holds:
 * - Treatment coverage error: with more than one plate, the group has fewer
 *   samples than there are plates, so at least one plate must contain none of it.
 * - QC row-coverage error: a selected QC/reference group is absent from at least
 *   one used row of the generated layout. QC samples are meant to be interspersed
 *   through the run, so one per plate is not enough; every used row should have
 *   one. This is layout-based and only available after generation.
 * - Balance warning: the group is covered but its measured balance score is Poor
 *   or Bad. Balance is only known after a layout is generated, so this tier is
 *   skipped when no observed balance is supplied.
 *
 * A coverage error outranks the balance warning. A group that fails both is
 * reported once, as an error.
 */

export type WarningSeverity = 'error' | 'warning';

export interface GroupWarning {
  combination: string; // covariate-key, matches SummaryItem.combination
  severity: WarningSeverity;
  reason: string; // human-readable, names the counts involved
  count: number; // samples in the group across the whole dataset
  isQc: boolean;
}

export interface GroupDistributionWarnings {
  byCombination: Map<string, GroupWarning>;
  warningCount: number; // groups flagged error or warning
  totalGroups: number;
  plateCount: number;
  // Run-level lines, one per category that has a flagged group (treatment
  // coverage, QC/reference coverage, balance). Empty when nothing is flagged.
  summaries: string[];
}

// Per-group row-coverage counts from a generated layout. usedRows is the same for
// every group (rows that hold any sample); uncoveredRows is how many of those the
// group is absent from.
export interface GroupRowCoverage {
  usedRows: number;
  uncoveredRows: number;
}

export interface WarningOptions {
  // Mean observed balance per group, present after a layout is generated.
  observedGroupBalance?: Map<string, number>;
  // QC/reference values the user selected, used to tag QC groups.
  selectedQcValues?: string[];
  // Per-QC-group row coverage from the generated layout. When a QC group appears
  // here with uncoveredRows > 0, it is flagged instead of the treatment coverage
  // rule.
  qcRowCoverage?: Map<string, GroupRowCoverage>;
}

// A group whose balance score falls below this is flagged as a balance warning.
// Mapped to the Fair floor in QUALITY_LEVEL_CONFIG, so Poor and Bad groups are
// flagged and Fair or better is treated as acceptable.
export const POOR_BALANCE_THRESHOLD = QUALITY_LEVEL_CONFIG.fair.lowScore; // 70

/**
 * Average the per-plate group balance into one score per group.
 *
 * Walks every plate's covariateGroupBalance and returns the mean balanceScore
 * for each covariate combination, so the warning reflects the layout on screen.
 */
export function aggregateObservedGroupBalance(metrics: QualityMetrics): Map<string, number> {
  const totals = new Map<string, { sum: number; plates: number }>();

  metrics.plateDiversity.plateScores.forEach((plate) => {
    Object.entries(plate.covariateGroupBalance).forEach(([combination, detail]) => {
      const acc = totals.get(combination) ?? { sum: 0, plates: 0 };
      acc.sum += detail.balanceScore;
      acc.plates += 1;
      totals.set(combination, acc);
    });
  });

  const means = new Map<string, number>();
  totals.forEach((acc, combination) => {
    means.set(combination, acc.sum / acc.plates);
  });
  return means;
}

/**
 * Per-QC-group row coverage from a generated layout.
 *
 * A row is "used" when it holds any sample. For each QC/reference group, counts
 * how many used rows contain no sample of that group. Empty rows are ignored.
 *
 * @param plates - the generated layout: plates -> rows -> cells (sample or empty)
 * @param qcCombinations - covariate keys of the selected QC/reference groups
 * @param keyOf - maps a sample to its covariate key (matches SummaryItem.combination)
 */
export function computeQcRowCoverage(
  plates: (SearchData | undefined)[][][],
  qcCombinations: Set<string>,
  keyOf: (sample: SearchData) => string
): Map<string, GroupRowCoverage> {
  let usedRows = 0;
  const rowsWithGroup = new Map<string, number>();
  qcCombinations.forEach((combination) => rowsWithGroup.set(combination, 0));

  plates.forEach((plate) => {
    plate.forEach((row) => {
      const groupsInRow = new Set<string>();
      row.forEach((cell) => {
        if (cell) groupsInRow.add(keyOf(cell));
      });
      if (groupsInRow.size === 0) return; // empty row, ignored
      usedRows += 1;
      qcCombinations.forEach((combination) => {
        if (groupsInRow.has(combination)) {
          rowsWithGroup.set(combination, rowsWithGroup.get(combination)! + 1);
        }
      });
    });
  });

  const coverage = new Map<string, GroupRowCoverage>();
  qcCombinations.forEach((combination) => {
    const covered = rowsWithGroup.get(combination) ?? 0;
    coverage.set(combination, { usedRows, uncoveredRows: usedRows - covered });
  });
  return coverage;
}

function coverageReason(count: number, plateCount: number): string {
  const missing = plateCount - count;
  const platesWord = missing === 1 ? 'plate' : 'plates';
  const sampleWord = count === 1 ? 'sample' : 'samples';
  return (
    `Only ${count} ${sampleWord} for ${plateCount} plates. ` +
    `At least ${missing} ${platesWord} will have 0 samples of this group.`
  );
}

function qcRowReason(uncoveredRows: number, usedRows: number, count: number): string {
  const rowWord = usedRows === 1 ? 'row' : 'rows';
  const missing = `This QC/reference group is missing from ${uncoveredRows} of ${usedRows} used ${rowWord}. `;
  if (count < usedRows) {
    // Too few samples to reach every used row, so moving cannot fix it.
    const sampleWord = count === 1 ? 'sample' : 'samples';
    return missing + `It has only ${count} ${sampleWord} for ${usedRows} used rows, so add more QC/reference samples.`;
  }
  // Enough samples exist, so this is a placement gap.
  return missing + `Move samples so every used row has one.`;
}

function balanceReason(score: number, plateCount: number): string {
  return (
    `Balance score ${score} (Poor or Bad). ` +
    `This group is spread unevenly across the ${plateCount} plates.`
  );
}

// "is" / "are", for the "N of the ... groups" coverage summaries. The noun stays
// plural ("groups"), so only the verb changes with the count.
function beVerb(n: number): string {
  return n === 1 ? 'is' : 'are';
}

function treatmentCoverageSummary(count: number): string {
  return (
    `${count} of the treatment covariate groups ${beVerb(count)} not represented on every plate. ` +
    `Ideally, each plate should have at least one sample from every treatment covariate group.`
  );
}

function qcCoverageSummary(count: number): string {
  return (
    `${count} of the QC/Reference groups ${beVerb(count)} not represented on every row. ` +
    `Ideally, each row should have at least one sample from every QC/Reference group.`
  );
}

function balanceSummary(count: number): string {
  const groupVerb = count === 1 ? 'group is' : 'groups are';
  return `${count} covariate ${groupVerb} placed unevenly across the plates (Poor or Bad balance).`;
}

// One line per category that has a flagged group.
function buildSummaries(warnings: GroupWarning[]): string[] {
  let treatmentCoverage = 0;
  let qcCoverage = 0;
  let balance = 0;
  warnings.forEach((warning) => {
    if (warning.severity === 'warning') balance += 1;
    else if (warning.isQc) qcCoverage += 1;
    else treatmentCoverage += 1;
  });

  const summaries: string[] = [];
  if (treatmentCoverage > 0) summaries.push(treatmentCoverageSummary(treatmentCoverage));
  if (qcCoverage > 0) summaries.push(qcCoverageSummary(qcCoverage));
  if (balance > 0) summaries.push(balanceSummary(balance));
  return summaries;
}

/**
 * Compute the group distribution warnings for a set of covariate groups.
 *
 * Pure. No React, no side effects. Depends only on its inputs.
 *
 * @param summaryData - per-group rollup (carries count and QC column value)
 * @param plateCount - number of plates the run will use (P)
 * @param options - observed balance, selected QC values, and per-QC-group row
 *   coverage. All optional; each tier is skipped when its input is absent.
 */
export function computeGroupDistributionWarnings(
  summaryData: SummaryItem[],
  plateCount: number,
  options: WarningOptions = {}
): GroupDistributionWarnings {
  const { observedGroupBalance, selectedQcValues = [], qcRowCoverage } = options;
  const byCombination = new Map<string, GroupWarning>();
  const totalGroups = summaryData.length;

  // Nothing to evaluate before a layout exists.
  if (plateCount >= 1) {
    summaryData.forEach((item) => {
      const isQc =
        item.qcColumnValue !== undefined && selectedQcValues.includes(item.qcColumnValue);

      // Coverage errors take precedence over the balance warning.
      if (isQc) {
        // QC groups: one per used row. Layout-based, so it can fire even on a
        // single plate. Skipped if no layout row coverage was supplied.
        const rowCoverage = qcRowCoverage?.get(item.combination);
        if (rowCoverage && rowCoverage.uncoveredRows > 0) {
          byCombination.set(item.combination, {
            combination: item.combination,
            severity: 'error',
            reason: qcRowReason(rowCoverage.uncoveredRows, rowCoverage.usedRows, item.count),
            count: item.count,
            isQc: true,
          });
          return;
        }
      } else if (plateCount > 1 && item.count < plateCount) {
        // Treatment groups: one per plate. A single plate holds every group, so
        // this is suppressed when P == 1.
        byCombination.set(item.combination, {
          combination: item.combination,
          severity: 'error',
          reason: coverageReason(item.count, plateCount),
          count: item.count,
          isQc: false,
        });
        return;
      }

      // Balance warning applies to QC and treatment groups alike. Cross-plate
      // balance is not meaningful on a single plate, so this needs P > 1 and a
      // generated layout with a real score.
      if (plateCount > 1) {
        const observed = observedGroupBalance?.get(item.combination);
        if (observed !== undefined && observed < POOR_BALANCE_THRESHOLD) {
          byCombination.set(item.combination, {
            combination: item.combination,
            severity: 'warning',
            // Floor, not round, so a flagged group (observed < 70) can never
            // display a score of 70 or above, which is the acceptable Fair floor.
            reason: balanceReason(Math.floor(observed), plateCount),
            count: item.count,
            isQc,
          });
        }
      }
    });
  }

  const warningCount = byCombination.size;
  const summaries = buildSummaries(Array.from(byCombination.values()));

  return { byCombination, warningCount, totalGroups, plateCount, summaries };
}
