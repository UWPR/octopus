import { SearchData, SubjectGroup, GroupingConstraint, GroupValidationResult } from '../utils/types';

/**
 * Groups samples by the selected subject column value.
 * Samples with empty/missing subject column values become singletons (group size 1).
 * Returns an array of SubjectGroup objects.
 */
export function buildSubjectGroups(
  samples: SearchData[],
  subjectColumn: string
): SubjectGroup[] {
  const groupMap = new Map<string, SearchData[]>();
  const singletons: SubjectGroup[] = [];

  for (const sample of samples) {
    const subjectValue = sample.metadata[subjectColumn]?.trim() ?? '';

    if (subjectValue === '') {
      // Empty/missing subject column values become singletons
      singletons.push({
        subjectId: `__singleton_${singletons.length}`,
        samples: [sample],
        size: 1,
      });
    } else {
      if (!groupMap.has(subjectValue)) {
        groupMap.set(subjectValue, []);
      }
      groupMap.get(subjectValue)!.push(sample);
    }
  }

  const groups: SubjectGroup[] = [];
  groupMap.forEach((groupSamples, subjectId) => {
    groups.push({
      subjectId,
      samples: groupSamples,
      size: groupSamples.length,
    });
  });

  return [...groups, ...singletons];
}

/**
 * Validates that all subject groups fit within the chosen constraint level.
 * Checks each group size against row capacity (Same Row) or plate capacity (Same Plate).
 * Checks total sample count against total well capacity.
 * Returns GroupValidationResult with errors and warnings.
 */
export function validateSubjectGroups(
  groups: SubjectGroup[],
  constraint: GroupingConstraint,
  rowCapacity: number,
  plateCapacity: number,
  totalWellCapacity: number
): GroupValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const totalSamples = groups.reduce((sum, g) => sum + g.size, 0);

  // Check total capacity
  if (totalSamples > totalWellCapacity) {
    errors.push(
      `Total samples (${totalSamples}) exceed available well capacity (${totalWellCapacity}).`
    );
  }

  // Check per-group capacity based on constraint level
  for (const group of groups) {
    if (constraint === 'same-row' && group.size > rowCapacity) {
      errors.push(
        `Subject ${group.subjectId} has ${group.size} samples, which exceeds the row capacity of ${rowCapacity}. Reduce group size or switch to Same Plate constraint.`
      );
    }
    if (constraint === 'same-plate' && group.size > plateCapacity) {
      errors.push(
        `Subject ${group.subjectId} has ${group.size} samples, which exceeds the plate capacity of ${plateCapacity}.`
      );
    }
  }

  // Warn if many singletons
  const singletonCount = groups.filter(g => g.subjectId.startsWith('__singleton_')).length;
  if (singletonCount > 0 && singletonCount > groups.length / 2) {
    warnings.push(
      `${singletonCount} out of ${groups.length} groups are singletons (empty subject ID). Consider checking your subject column selection.`
    );
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}
