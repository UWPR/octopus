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
 * Property 3 (QC prefix injectivity): with a QC column selected, a QC sample's
 *   key (QC value prepended) and a non-QC sample's key are equal iff their
 *   effective identity matches, and a QC key never collides with a non-QC key.
 *   Covers a QC value that itself contains the delimiter `|`.
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

// QC-prefix arbitraries. The selected QC values include one that carries the
// delimiter, and the value space also draws non-selected values, empty, and the
// sentinels, so a sample is QC only when its QC value is truthy and selected.
const QC_VALUES = ['Ref', 'Batch|QC', 'na'];
const QC_VALUE = fc.constantFrom('Ref', 'Batch|QC', 'na', 'X', '', 'N/A', '\\', 'Ref|x');

const qcConfigFor = (n: number): CovariateConfig => ({
  selectedCovariates: Array.from({ length: n }, (_, i) => `c${i}`),
  qcColumn: 'qc',
  selectedQcValues: QC_VALUES,
});

const qcSampleFor = (qcValue: string, values: string[]): SearchData => ({
  name: 's',
  metadata: { qc: qcValue, ...Object.fromEntries(values.map((v, i) => [`c${i}`, v])) },
});

// The effective identity the key encodes: the base tuple, with the QC value
// prepended as an extra leading segment only when the sample is QC. A QC identity
// has one more segment than a non-QC one, so the two can never coincide.
const qcIdentity = (qcValue: string, values: string[]): string[] => {
  const eff = effective(values);
  const isQC = !!qcValue && QC_VALUES.includes(qcValue);
  return isQC ? [qcValue, ...eff] : eff;
};

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

  it('prepends the QC value injectively; QC and non-QC keys never collide (Property 3)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 4 }).chain(n =>
          fc.tuple(
            fc.tuple(QC_VALUE, tupleArb(n)),
            fc.tuple(QC_VALUE, tupleArb(n))
          )
        ),
        ([[q1, t1], [q2, t2]]) => {
          const config = qcConfigFor(t1.length);
          const k1 = buildCovariateKey(qcSampleFor(q1, t1), config);
          const k2 = buildCovariateKey(qcSampleFor(q2, t2), config);
          const sameIdentity =
            JSON.stringify(qcIdentity(q1, t1)) === JSON.stringify(qcIdentity(q2, t2));
          return sameIdentity ? k1 === k2 : k1 !== k2;
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
