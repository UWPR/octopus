import { SummaryItem, QualityMetrics, SearchData, NaPolicy } from './types';
import { QUALITY_LEVEL_CONFIG } from './configs';
import { buildCovariateKey, effectiveDisplayValue } from './utils';

/**
 * Group distribution warnings.
 *
 * A non-blocking diagnostic that flags covariate groups that are poorly
 * distributed across plates or rows. It never disables Generate and never
 * changes randomization, colors, or scores. It only reads existing state.
 *
 * A group is flagged when one of these holds:
 * - Treatment coverage error: with more than one plate, the group has fewer
 *   samples than there are plates, so at least one plate will have no samples from it.
 * - QC row-coverage error: a selected QC/reference group is absent from at least
 *   one used row of the generated layout. QC samples are meant to be interspersed
 *   through the run, so one per plate is not enough. Every used row should have
 *   one. This is layout-based and only available after generation.
 * - Balance warning: the group is covered but its measured balance score is below
 *   70, and it is not already placed as evenly as its count allows.
 *   Balance is only known after a layout is generated, so this tier is
 *   skipped when no observed balance is supplied.
 *
 * A coverage error outranks the balance warning. A group that fails both is
 * reported once, as an error.
 */

export type WarningSeverity = 'error' | 'warning';

// The fields of a covariate group that the warnings read.
export type WarningGroup = Pick<SummaryItem, 'combination' | 'count' | 'qcColumnValue'>;

export interface GroupWarning {
  combination: string; // covariate-key, matches SummaryItem.combination
  severity: WarningSeverity;
  reason: string; // human-readable, names the counts involved
  count: number; // samples in the group across the whole dataset
  isQc: boolean;
  // Present on a balance warning, the numbers behind its reason
  balance?: GroupBalanceDetail;
}

export type WarningSectionKind = 'treatment-coverage' | 'qc-coverage' | 'balance';

// One category of flagged groups, its run-level line and the groups it names
export interface WarningSection {
  kind: WarningSectionKind;
  line: string;
  combinations: string[]; // in the order the groups were flagged
}

export interface GroupDistributionWarnings {
  byCombination: Map<string, GroupWarning>;
  warningCount: number; // groups flagged error or warning
  totalGroups: number;
  plateCount: number;
  // One section per category that has a flagged group (treatment coverage, QC/reference
  // coverage, balance). Empty when nothing is flagged.
  sections: WarningSection[];
  // The section lines alone, for the Quality button tooltip
  summaries: string[];
}

// How a group's samples are spread over the plates, and how evenly they could be
export interface GroupBalanceDetail {
  // Mean of the group's per-plate balance scores, the number the warning reports
  observedMean: number;
  // The group's sample count on each plate, in plate order
  plateCounts: number[];
  // The even split nearest the layout, one count per plate in plate order, from nearestEvenCounts
  evenCounts: number[];
  // Every plate holds the group's expected count rounded down or up
  atBest: boolean;
}

// Per-group row-coverage counts from a generated layout. usedRows counts the rows
// that hold any sample and is the same for every group. uncoveredRows is how many
// of those rows lack the group.
export interface GroupRowCoverage {
  usedRows: number;
  uncoveredRows: number;
}

export interface WarningOptions {
  // Per-group balance detail from groupBalanceDetails, present after a layout is generated.
  // A group at its best achievable balance, every plate holding its expected count rounded down
  // or up, gets no balance warning.
  balanceDetails?: Map<string, GroupBalanceDetail>;
  // QC/reference values the user selected, used to tag QC groups.
  selectedQcValues?: string[];
  // Per-QC-group row coverage from the generated layout. When a QC group appears
  // here with uncoveredRows > 0, it is flagged instead of the treatment coverage
  // rule.
  qcRowCoverage?: Map<string, GroupRowCoverage>;
}

// A group whose balance score falls below this is flagged as a balance warning.
// Mapped to the floor of the 70-79 band in QUALITY_LEVEL_CONFIG, so a group below 70 is
// flagged and 70 or above is treated as acceptable.
export const POOR_BALANCE_THRESHOLD = QUALITY_LEVEL_CONFIG.fair.lowScore; // 70

/**
 * The balance detail of every group in a generated layout.
 *
 * The observed mean averages the group's per-plate balance scores, so the warning reflects the
 * layout on screen. A group is at its best when every plate holds its expected count (its share
 * of that plate's samples) rounded down or up. A small group can score below 70 even then, for
 * example 4 samples on 3 equal plates split 2/1/1.
 *
 * An empty plate has no balance data. It counts as 0 in both lists and is left out of the mean.
 */
export function groupBalanceDetails(metrics: QualityMetrics): Map<string, GroupBalanceDetail> {
  const plateScores = [...metrics.plateDiversity.plateScores].sort((a, b) => a.plateIndex - b.plateIndex);
  const combinations = new Set(plateScores.flatMap((plate) => Object.keys(plate.covariateGroupBalance)));

  const details = new Map<string, GroupBalanceDetail>();
  combinations.forEach((combination) => {
    const entries = plateScores.map((plate) => plate.covariateGroupBalance[combination]);
    const plates = entries
      .filter((entry) => entry !== undefined)
      .map((entry) => ({ actual: entry.actualCount, expected: entry.expectedCount, score: entry.balanceScore }));
    const observedSum = plates.reduce((sum, plate) => sum + plate.score, 0);
    const evenCounts = nearestEvenCounts(plates);
    let plateIndex = 0;
    details.set(combination, {
      observedMean: observedSum / plates.length,
      plateCounts: entries.map((entry) => entry?.actualCount ?? 0),
      evenCounts: entries.map((entry) => (entry === undefined ? 0 : evenCounts[plateIndex++])),
      atBest: plates.every((plate) => isRoundedExpected(plate.actual, plate.expected)),
    });
  });
  return details;
}

/** The observed mean of each group, from groupBalanceDetails. */
export function aggregateObservedGroupBalance(metrics: QualityMetrics): Map<string, number> {
  const means = new Map<string, number>();
  groupBalanceDetails(metrics).forEach((detail, combination) => means.set(combination, detail.observedMean));
  return means;
}

/** The groups at their best achievable balance, from groupBalanceDetails. */
export function groupsAtBestAchievableBalance(metrics: QualityMetrics): Set<string> {
  const best = new Set<string>();
  groupBalanceDetails(metrics).forEach((detail, combination) => {
    if (detail.atBest) best.add(combination);
  });
  return best;
}

// Tolerance for expected counts that are whole numbers up to floating-point error
const COUNT_EPSILON = 1e-9;

// True when the count is the expected count rounded down or up
function isRoundedExpected(actual: number, expected: number): boolean {
  return actual >= Math.floor(expected + COUNT_EPSILON) && actual <= Math.ceil(expected - COUNT_EPSILON);
}

// A plate's balance score for one group, computed as calculatePlateBalance does: the relative
// deviation from the expected count, capped at 1, as a rounded score out of 100.
function plateGroupScore(actual: number, expected: number): number {
  if (expected <= 0) return actual > 0 ? 0 : 100;
  const deviation = Math.min(Math.abs(actual - expected) / expected, 1);
  return Math.round(Math.max(0, 100 - deviation * 100));
}

/**
 * The even split nearest the layout, one count per plate. Each plate holds the group's expected
 * count rounded down or up, and a plate whose count already is one keeps it.
 *
 * Moving the other plates into range changes the group's total, so some plates in range change
 * too, between their rounded-down and rounded-up counts.
 * - Plates whose score gains most change first, then the first in plate order.
 * - With 6 samples expected 1.36 on four large plates and 0.57 on a small one, placed 1, 1, 1, 1, 2,
 *   the small plate drops to 1 and plate 1 rises to 2. Any large plate would do equally well.
 */
function nearestEvenCounts(plates: { actual: number; expected: number }[]): number[] {
  const low = plates.map(({ expected }) => Math.floor(expected + COUNT_EPSILON));
  const high = plates.map(({ expected }) => Math.ceil(expected - COUNT_EPSILON));
  const counts = plates.map(({ actual }, i) => Math.min(Math.max(actual, low[i]), high[i]));
  const total = plates.reduce((sum, plate) => sum + plate.actual, 0);
  const excess = counts.reduce((sum, count) => sum + count, 0) - total;
  const step = excess > 0 ? -1 : 1;
  const gain = (i: number) => plateGroupScore(counts[i] + step, plates[i].expected) -
    plateGroupScore(counts[i], plates[i].expected);
  plates
    .map((_, i) => i)
    .filter((i) => low[i] < high[i] && counts[i] === (step < 0 ? high[i] : low[i]))
    .sort((a, b) => gain(b) - gain(a) || a - b)
    .slice(0, Math.abs(excess))
    .forEach((i) => {
      counts[i] += step;
    });
  return counts;
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
    return missing + `It has only ${count} ${sampleWord} for ${usedRows} used rows.`;
  }
  // Enough samples exist, so this is a placement gap.
  return missing + `Move samples so every used row has one.`;
}

function samplesWord(n: number): string {
  return n === 1 ? 'sample' : 'samples';
}

function balanceReason(detail: GroupBalanceDetail): string {
  return (
    // Floor, not round, so a flagged group (mean below 70) never displays a score of 70 or
    // above, which is acceptable
    `Mean per-plate balance score ${Math.floor(detail.observedMean)} (below ${POOR_BALANCE_THRESHOLD}). ` +
    `Per plate: ${detail.plateCounts.join(', ')}. ` +
    `Most even: ${detail.evenCounts.join(', ')}.`
  );
}

// "is" / "are", for the "N of the ... groups" coverage summaries. The noun stays
// plural ("groups"), so only the verb changes with the count.
function beVerb(n: number): string {
  return n === 1 ? 'is' : 'are';
}

function treatmentCoverageSummary(count: number): string {
  return (
    `${count} of the covariate groups ${beVerb(count)} not represented on every plate. ` +
    `Ideally, each plate should have at least one sample from every covariate group.`
  );
}

function qcCoverageSummary(count: number): string {
  return (
    `${count} of the QC/Reference groups ${beVerb(count)} not represented on every row. ` +
    `Ideally, each row should have at least one sample from every QC/Reference group.`
  );
}

function balanceSummary(count: number): string {
  const groups = count === 1 ? '1 covariate group' : `${count} covariate groups`;
  const allows = count === 1 ? 'its sample count allows' : 'their sample counts allow';
  return (
    `${groups} placed less evenly across the plates than ${allows} ` +
    `(mean per-plate balance score below ${POOR_BALANCE_THRESHOLD}).`
  );
}

// One section per category that has a flagged group, in a fixed order.
function buildSections(warnings: GroupWarning[]): WarningSection[] {
  const kindOf = (warning: GroupWarning): WarningSectionKind =>
    warning.severity === 'warning' ? 'balance' : warning.isQc ? 'qc-coverage' : 'treatment-coverage';
  const lineFor: Record<WarningSectionKind, (count: number) => string> = {
    'treatment-coverage': treatmentCoverageSummary,
    'qc-coverage': qcCoverageSummary,
    balance: balanceSummary,
  };
  const order: WarningSectionKind[] = ['treatment-coverage', 'qc-coverage', 'balance'];
  return order.flatMap((kind) => {
    const combinations = warnings.filter((w) => kindOf(w) === kind).map((w) => w.combination);
    return combinations.length > 0 ? [{ kind, line: lineFor[kind](combinations.length), combinations }] : [];
  });
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
  summaryData: WarningGroup[],
  plateCount: number,
  options: WarningOptions = {}
): GroupDistributionWarnings {
  const { balanceDetails, selectedQcValues = [], qcRowCoverage } = options;
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
        const detail = balanceDetails?.get(item.combination);
        if (detail && detail.observedMean < POOR_BALANCE_THRESHOLD && !detail.atBest) {
          byCombination.set(item.combination, {
            combination: item.combination,
            severity: 'warning',
            reason: balanceReason(detail),
            count: item.count,
            isQc,
            balance: detail,
          });
        }
      }
    });
  }

  const warningCount = byCombination.size;
  const sections = buildSections(Array.from(byCombination.values()));

  return { byCombination, warningCount, totalGroups, plateCount, sections, summaries: sections.map((s) => s.line) };
}

/**
 * Whether any flagged group is a coverage error rather than a balance-only
 * warning. Drives the red-versus-amber accent on both the collapsed indicator
 * and the warning banner, so the two never disagree.
 */
export function hasCoverageError(warnings: GroupDistributionWarnings): boolean {
  return Array.from(warnings.byCombination.values()).some((w) => w.severity === 'error');
}

/**
 * The name of a covariate group in a warning, its display values in the order of the selected
 * covariates, such as "Drug | T0 | A". `values` holds the display values, as in SummaryItem.values.
 */
export function covariateGroupLabel(values: { [covariate: string]: string }, selectedCovariates: string[]): string {
  // A blank kept distinct from N/A displays as '', so name it as the N/A values checklist does
  return selectedCovariates.map((covariate) => values[covariate] || '(blank)').join(' | ');
}

/**
 * The name of a group with its QC value in front, as "BatchQC | Drug | T0". The QC value goes in
 * front only when the QC column is not a selected covariate, the same rule as buildCovariateKey.
 * `qcValue` is undefined for a group that is not a QC group.
 */
export function qcGroupLabel(
  label: string,
  qcValue: string | undefined,
  qcColumn: string | undefined,
  selectedCovariates: string[]
): string {
  return qcValue && qcColumn && !selectedCovariates.includes(qcColumn) ? `${qcValue} | ${label}` : label;
}

// A section of the warning banner, its line and the groups listed under it
export interface BannerSection {
  line: string;
  groups: string[];
}

/** "b | y (1 sample)", a group named with its sample count. */
export function groupCountText(label: string, count: number): string {
  return `${label} (${count} ${samplesWord(count)})`;
}

/** The banner items for groups that cannot reach every plate or row, smallest group first. */
export function coverageItems(groups: { label: string; count: number }[]): string[] {
  return [...groups]
    .sort((a, b) => a.count - b.count || a.label.localeCompare(b.label))
    .map((group) => groupCountText(group.label, group.count));
}

/**
 * The banner sections for a generated layout, one per warning section, each naming its groups.
 * Coverage sections list groups smallest first. The balance section lists groups lowest mean
 * score first, as "label (12 samples, score 64)". A QC group is named by qcGroupLabel.
 */
export function bannerSections(
  warnings: GroupDistributionWarnings,
  summaryData: Pick<SummaryItem, 'combination' | 'count' | 'qcColumnValue' | 'values'>[],
  selectedCovariates: string[],
  qcColumn: string | undefined
): BannerSection[] {
  const itemByCombination = new Map(summaryData.map((item) => [item.combination, item]));
  return warnings.sections.map((section) => {
    const entries = section.combinations.flatMap((combination) => {
      const item = itemByCombination.get(combination);
      const warning = warnings.byCombination.get(combination);
      if (!item || !warning) return [];
      const qcValue = warning.isQc ? item.qcColumnValue : undefined;
      const label = qcGroupLabel(
        covariateGroupLabel(item.values, selectedCovariates), qcValue, qcColumn, selectedCovariates
      );
      return [{ label, count: item.count, score: warning.balance?.observedMean ?? 0 }];
    });
    if (section.kind !== 'balance') return { line: section.line, groups: coverageItems(entries) };
    const groups = entries
      .sort((a, b) => a.score - b.score || a.label.localeCompare(b.label))
      .map((entry) => `${entry.label} (${entry.count} ${samplesWord(entry.count)}, score ${Math.floor(entry.score)})`);
    return { line: section.line, groups };
  });
}

/**
 * The treatment groups of the samples before Generate, keyed with buildCovariateKey as the layout
 * keys them. Samples with a selected value in the QC column are left out, since the QC coverage
 * rule needs a generated layout. Each group carries its covariateGroupLabel.
 * Groups are in the order their first sample appears.
 */
export function plannedTreatmentGroups(
  samples: SearchData[],
  selectedCovariates: string[],
  naPolicy: NaPolicy,
  qcColumn: string,
  selectedQcValues: string[]
): (WarningGroup & { label: string })[] {
  const groups = new Map<string, WarningGroup & { label: string }>();
  samples.forEach((sample) => {
    if (qcColumn && selectedQcValues.includes(sample.metadata[qcColumn])) return;
    const key = buildCovariateKey(sample, { selectedCovariates, naPolicy });
    const group = groups.get(key);
    if (group) {
      group.count += 1;
    } else {
      const values: { [covariate: string]: string } = {};
      selectedCovariates.forEach((covariate) => {
        values[covariate] = effectiveDisplayValue(sample.metadata[covariate] ?? '', naPolicy);
      });
      groups.set(key, { combination: key, count: 1, label: covariateGroupLabel(values, selectedCovariates) });
    }
  });
  return Array.from(groups.values());
}

/** The warning shown before Generate when some treatment groups cannot reach every plate. */
export function plannedCoverageSummary(
  count: number,
  totalGroups: number,
  covariateCount: number
): string {
  const fewer = count === 1 ? 'has fewer samples' : 'have fewer samples';
  const pronoun = count === 1 ? 'it' : 'they';
  const summary =
    `With these covariates, ${count} of the ${totalGroups} covariate groups ${fewer} than the ` +
    `number of plates, so ${pronoun} cannot appear on every plate.`;
  // With one covariate there is no fewer-covariates option to suggest
  return covariateCount > 1 ? `${summary} Try selecting fewer covariates.` : summary;
}
