/**
 * Property-based tests for buildCovariateKey (escape-encoded covariate key).
 *
 * Complements the hand-picked cases in `utils.test.ts` by asserting the two
 * correctness properties from the covariate-key-fragility design over a large
 * random sample space, with an alphabet that includes the delimiter `|`, the
 * escape character `\`, empty, `na`, and `N/A`.
 *
 * Property 1 (Injectivity): two samples with different value tuples produce
 *   different keys; two samples with the same effective tuple produce the same
 *   key (the `|| 'N/A'` fallback means empty and a literal `N/A` collide, which
 *   is the accepted B-min residual).
 * Property 2 (Clean-data preservation): for tuples with no `|` and no `\`, the
 *   key is byte-identical to the legacy `values.map(v => v || 'N/A').join('|')`.
 */

import * as fc from 'fast-check';
import { buildCovariateKey } from '../utils/utils';
import { SearchData, CovariateConfig } from '../utils/types';

// Alphabet exercising every hazard: delimiter, escape char, both together,
// empty, and the sentinel spellings.
const VALUE = fc.constantFrom('a', 'Drug', 'Hi|10', '|', '\\', '\\|', '|\\', 'na', 'N/A', '', '0');

// Clean values: no delimiter and no escape character (empty and sentinels are
// still allowed, since the legacy formula also maps them through `|| 'N/A'`).
const CLEAN_VALUE = fc.constantFrom('a', 'Drug', 'Training', '108', 'FA1', 'S1', '0', '', 'N/A', 'na');

const tupleArb = (n: number) => fc.array(VALUE, { minLength: n, maxLength: n });

const configFor = (n: number): CovariateConfig => ({
  selectedCovariates: Array.from({ length: n }, (_, i) => `c${i}`),
});

const sampleFor = (values: string[]): SearchData => ({
  name: 's',
  metadata: Object.fromEntries(values.map((v, i) => [`c${i}`, v])),
});

// The effective tuple is what the key builder actually encodes: an empty cell
// falls back to the literal 'N/A'.
const effective = (values: string[]): string[] => values.map(v => v || 'N/A');

describe('buildCovariateKey property tests', () => {
  it('maps distinct value tuples to distinct keys, equal tuples to equal keys (Property 1)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5 }).chain(n => fc.tuple(tupleArb(n), tupleArb(n))),
        ([t1, t2]) => {
          const config = configFor(t1.length);
          const k1 = buildCovariateKey(sampleFor(t1), config);
          const k2 = buildCovariateKey(sampleFor(t2), config);
          const sameTuple = JSON.stringify(effective(t1)) === JSON.stringify(effective(t2));
          return sameTuple ? k1 === k2 : k1 !== k2;
        }
      ),
      { numRuns: 3000 }
    );
  });

  it('is byte-identical to the legacy pipe-join for clean data (Property 2)', () => {
    fc.assert(
      fc.property(
        fc.array(CLEAN_VALUE, { minLength: 1, maxLength: 5 }),
        (values) => {
          const config = configFor(values.length);
          const legacy = values.map(v => v || 'N/A').join('|');
          return buildCovariateKey(sampleFor(values), config) === legacy;
        }
      ),
      { numRuns: 2000 }
    );
  });
});
