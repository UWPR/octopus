/**
 * Property-based tests for buildCovariateKey (escape-encoded covariate key) under the
 * na-value-handling NaPolicy.
 *
 * Complements the hand-picked cases in `utils.test.ts` by asserting the correctness
 * properties over a large random sample space, with an alphabet that includes the
 * delimiter `|`, the escape character `\`, blank, whitespace, and the sentinel spellings
 * `na`, `NA`, `n/a`, `N/A`.
 *
 * The key encodes an EFFECTIVE identity per value (see effectiveValue in utils):
 *   - blank folds to canonical N/A only when the policy sets foldBlank; otherwise it is a
 *     distinct "missing" identity (the lone-backslash marker),
 *   - the literal `N/A` always folds,
 *   - any other spelling folds only when the policy lists it, else it stays its own value.
 *
 * Property 1 (Injectivity): two samples whose effective identity tuples differ produce
 *   different keys; equal effective tuples produce equal keys. Checked across several
 *   policies (fold nothing, fold blank, fold spellings, fold all).
 * Property 2 (Clean-data preservation): for tuples with NO N/A-type value, the key is
 *   byte-identical to the pre-feature escape-join, so grouping is unchanged (Requirement 6.1).
 * Property 3 (QC prefix injectivity): with a QC column selected, a QC sample's key (QC value
 *   prepended, also run through the policy) and a non-QC sample's key are equal iff their
 *   effective identity matches, and a QC key never collides with a non-QC key.
 */

import * as fc from 'fast-check';
import { buildCovariateKey } from '../utils/utils';
import { SearchData, CovariateConfig, NaPolicy, DEFAULT_NA_POLICY } from '../utils/types';

// Alphabet exercising every hazard: delimiter, escape char, both together, blank,
// whitespace-only, and the sentinel spellings in several cases.
const VALUE = fc.constantFrom(
  'a', 'Drug', 'Hi|10', '|', '\\', '\\|', '|\\', 'na', 'NA', 'n/a', 'N/A', '', '   ', '0'
);

// Clean values: no N/A-type value (no blank, no na/n/a spelling). Delimiter and escape
// characters are still exercised, since those are handled by escaping, not the policy.
const CLEAN_VALUE = fc.constantFrom('a', 'Drug', 'Hi|10', '|', '\\', '\\|', '|\\', '108', 'FA1', '0');

// Policies spanning the meaningful choices.
const POLICIES: NaPolicy[] = [
  DEFAULT_NA_POLICY, // fold nothing extra: blank distinct, spellings literal
  { foldBlank: true, foldSpellings: [] }, // fold blank into N/A
  { foldBlank: false, foldSpellings: ['na', 'NA', 'n/a'] }, // fold spellings, keep blank distinct
  { foldBlank: true, foldSpellings: ['na', 'NA', 'n/a'] }, // fold everything
];

const tupleArb = (n: number) => fc.array(VALUE, { minLength: n, maxLength: n });

const configFor = (n: number, naPolicy: NaPolicy): CovariateConfig => ({
  selectedCovariates: Array.from({ length: n }, (_, i) => `c${i}`),
  naPolicy,
});

const sampleFor = (values: string[]): SearchData => ({
  name: 's',
  metadata: Object.fromEntries(values.map((v, i) => [`c${i}`, v])),
});

// A canonical identity token for a raw value under a policy. Distinct tokens correspond to
// distinct key parts and vice versa. Mirrors effectiveValue: a real value carries a "V:" tag
// so it can never coincide with the NA or MISSING tokens.
function identity(raw: string, policy: NaPolicy): string {
  const isBlank = raw.trim().length === 0;
  const lower = raw.toLowerCase();
  const isNa = isBlank || lower === 'na' || lower === 'n/a';
  if (!isNa) return `V:${raw}`;
  if (isBlank) return policy.foldBlank ? 'NA' : 'MISSING';
  if (raw === 'N/A') return 'NA';
  return policy.foldSpellings.includes(raw) ? 'NA' : `V:${raw}`;
}

const identityTuple = (values: string[], policy: NaPolicy): string[] =>
  values.map(v => identity(v, policy));

// The pre-feature escape used by covariate-key-fragility, replicated so clean-data keys can be
// checked to be byte-identical to that behavior.
const escape = (v: string) => v.replace(/\\/g, '\\\\').replace(/\|/g, '\\|');

// QC-prefix arbitraries. The selected QC values include one with the delimiter and one N/A-type
// spelling, and the value space also draws non-selected values, blank, and the sentinels.
const QC_VALUES = ['Ref', 'Batch|QC', 'na'];
const QC_VALUE = fc.constantFrom('Ref', 'Batch|QC', 'na', 'X', '', 'N/A', '\\', 'Ref|x');

const qcConfigFor = (n: number, naPolicy: NaPolicy): CovariateConfig => ({
  selectedCovariates: Array.from({ length: n }, (_, i) => `c${i}`),
  qcColumn: 'qc',
  selectedQcValues: QC_VALUES,
  naPolicy,
});

const qcSampleFor = (qcValue: string, values: string[]): SearchData => ({
  name: 's',
  metadata: { qc: qcValue, ...Object.fromEntries(values.map((v, i) => [`c${i}`, v])) },
});

// The effective identity the key encodes: the base identity tuple, with the QC value's identity
// prepended as an extra leading segment only when the sample is QC. A QC identity has one more
// segment than a non-QC one, so the two can never coincide.
const qcIdentity = (qcValue: string, values: string[], policy: NaPolicy): string[] => {
  const base = identityTuple(values, policy);
  const isQC = !!qcValue && QC_VALUES.includes(qcValue);
  return isQC ? [identity(qcValue, policy), ...base] : base;
};

describe('buildCovariateKey property tests (NaPolicy)', () => {
  it('maps distinct effective tuples to distinct keys, equal ones to equal keys (Property 1)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5 }).chain(n =>
          fc.tuple(tupleArb(n), tupleArb(n), fc.constantFrom(...POLICIES))
        ),
        ([t1, t2, policy]) => {
          const config = configFor(t1.length, policy);
          const k1 = buildCovariateKey(sampleFor(t1), config);
          const k2 = buildCovariateKey(sampleFor(t2), config);
          const same =
            JSON.stringify(identityTuple(t1, policy)) === JSON.stringify(identityTuple(t2, policy));
          return same ? k1 === k2 : k1 !== k2;
        }
      ),
      { numRuns: 4000 }
    );
  });

  it('prepends the QC value injectively; QC and non-QC keys never collide (Property 3)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 4 }).chain(n =>
          fc.tuple(
            fc.tuple(QC_VALUE, tupleArb(n)),
            fc.tuple(QC_VALUE, tupleArb(n)),
            fc.constantFrom(...POLICIES)
          )
        ),
        ([[q1, t1], [q2, t2], policy]) => {
          const config = qcConfigFor(t1.length, policy);
          const k1 = buildCovariateKey(qcSampleFor(q1, t1), config);
          const k2 = buildCovariateKey(qcSampleFor(q2, t2), config);
          const same =
            JSON.stringify(qcIdentity(q1, t1, policy)) === JSON.stringify(qcIdentity(q2, t2, policy));
          return same ? k1 === k2 : k1 !== k2;
        }
      ),
      { numRuns: 4000 }
    );
  });

  it('is byte-identical to the pre-feature escape-join for clean data (Property 2)', () => {
    fc.assert(
      fc.property(
        fc.array(CLEAN_VALUE, { minLength: 1, maxLength: 5 }).chain(values =>
          fc.tuple(fc.constant(values), fc.constantFrom(...POLICIES))
        ),
        ([values, policy]) => {
          const config = configFor(values.length, policy);
          const expected = values.map(escape).join('|');
          return buildCovariateKey(sampleFor(values), config) === expected;
        }
      ),
      { numRuns: 3000 }
    );
  });
});
