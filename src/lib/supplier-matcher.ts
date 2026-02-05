/**
 * Supplier Fuzzy Matching Utility
 *
 * Provides fuzzy matching of supplier names from franchisee BKMVDATA files
 * using the bkmvAliases system. Handles various name formats, spellings,
 * and flags unmatched entries for manual review.
 *
 * This is the inverse of franchisee-matcher.ts:
 * - franchisee-matcher: matches franchisee names from supplier files
 * - supplier-matcher: matches supplier names from franchisee files (BKMVDATA)
 */

import type { Supplier } from "@/db/schema";
import {
  combinedSimilarity,
  normalizeName,
  generateNameVariants,
} from "./franchisee-matcher";

// Re-export utility functions from franchisee-matcher
export {
  levenshteinDistance,
  calculateSimilarity,
  jaroWinklerSimilarity,
  combinedSimilarity,
  normalizeName,
  generateNameVariants,
} from "./franchisee-matcher";

// ============================================================================
// TYPES
// ============================================================================

/**
 * Match result for a single supplier name lookup
 */
export interface SupplierMatchResult {
  /** The original name from the BKMVDATA file */
  originalName: string;
  /** The matched supplier record, if found */
  matchedSupplier: Supplier | null;
  /** Confidence score 0-1 (1 = exact match) */
  confidence: number;
  /** Type of match found */
  matchType: SupplierMatchType;
  /** Which alias or field matched (for debugging) */
  matchedOn: string | null;
  /** Whether this match requires manual review */
  requiresReview: boolean;
  /** Alternative matches above threshold but not best match */
  alternatives: AlternativeSupplierMatch[];
}

/**
 * Alternative match suggestion
 */
export interface AlternativeSupplierMatch {
  supplier: Supplier;
  confidence: number;
  matchedOn: string;
}

/**
 * Type of match that was found
 */
export type SupplierMatchType =
  | "exact_name"        // Exact match on primary name
  | "exact_alias"       // Exact match on a BKMV alias
  | "exact_code"        // Exact match on supplier code
  | "fuzzy_name"        // Fuzzy match on primary name
  | "fuzzy_alias"       // Fuzzy match on a BKMV alias
  | "blacklisted"       // Name is in the blacklist (not a real supplier)
  | "no_match";         // No match found

/**
 * Configuration for the matching algorithm
 */
export interface SupplierMatcherConfig {
  /** Minimum confidence score to consider a match (0-1, default: 0.7) */
  minConfidence: number;
  /** Confidence threshold below which to flag for review (0-1, default: 0.85) */
  reviewThreshold: number;
  /** Maximum number of alternative matches to return (default: 3) */
  maxAlternatives: number;
  /** Whether to include inactive suppliers in matching (default: false) */
  includeInactive: boolean;
  /** Whether to include hidden suppliers in matching (default: false) */
  includeHidden: boolean;
}

/**
 * Default configuration
 * NOTE: reviewThreshold is set to 1.0 to require manual review for ALL fuzzy matches.
 * Only 100% exact matches will be auto-accepted.
 */
export const DEFAULT_SUPPLIER_MATCHER_CONFIG: SupplierMatcherConfig = {
  minConfidence: 0.7,
  reviewThreshold: 1.0, // Only 100% matches are auto-accepted
  maxAlternatives: 3,
  includeInactive: false,
  includeHidden: false,
};

/**
 * Batch matching result
 */
export interface SupplierBatchMatchResult {
  /** All match results */
  results: SupplierMatchResult[];
  /** Summary statistics */
  summary: {
    /** Total names processed */
    total: number;
    /** Names with confident matches */
    matched: number;
    /** Names flagged for review (matched but low confidence) */
    needsReview: number;
    /** Names with no match */
    unmatched: number;
    /** Average confidence score for matches */
    averageConfidence: number;
  };
}

// ============================================================================
// MATCHING ENGINE
// ============================================================================

/**
 * Calculate match score between a search name and a supplier
 * Returns the best match details
 */
function calculateSupplierMatchScore(
  searchName: string,
  supplier: Supplier
): { score: number; matchedOn: string; matchType: SupplierMatchType } {
  const searchVariants = generateNameVariants(searchName);

  let bestScore = 0;
  let bestMatchedOn = "";
  let bestMatchType: SupplierMatchType = "no_match";

  // Check primary name
  const primaryNameVariants = generateNameVariants(supplier.name);

  for (const searchVariant of searchVariants) {
    for (const nameVariant of primaryNameVariants) {
      // Check exact match first
      if (searchVariant === nameVariant) {
        return { score: 1, matchedOn: "name", matchType: "exact_name" };
      }

      // Calculate fuzzy similarity
      const score = combinedSimilarity(searchVariant, nameVariant);
      if (score > bestScore) {
        bestScore = score;
        bestMatchedOn = "name";
        bestMatchType = "fuzzy_name";
      }
    }
  }

  // Check code (exact match only)
  const normalizedSearch = normalizeName(searchName);
  const normalizedCode = normalizeName(supplier.code);
  if (normalizedSearch === normalizedCode) {
    return { score: 1, matchedOn: "code", matchType: "exact_code" };
  }

  // Check BKMV aliases
  const bkmvAliases = supplier.bkmvAliases || [];
  for (const alias of bkmvAliases) {
    const aliasVariants = generateNameVariants(alias);

    for (const searchVariant of searchVariants) {
      for (const aliasVariant of aliasVariants) {
        // Check exact alias match
        if (searchVariant === aliasVariant) {
          return { score: 1, matchedOn: `bkmvAlias:${alias}`, matchType: "exact_alias" };
        }

        // Calculate fuzzy similarity
        const score = combinedSimilarity(searchVariant, aliasVariant);
        if (score > bestScore) {
          bestScore = score;
          bestMatchedOn = `bkmvAlias:${alias}`;
          bestMatchType = "fuzzy_alias";
        }
      }
    }
  }

  return { score: bestScore, matchedOn: bestMatchedOn, matchType: bestMatchType };
}

/**
 * Match a single supplier name against a list of suppliers
 */
export function matchSupplierName(
  name: string,
  suppliers: Supplier[],
  config: Partial<SupplierMatcherConfig> = {}
): SupplierMatchResult {
  const fullConfig: SupplierMatcherConfig = { ...DEFAULT_SUPPLIER_MATCHER_CONFIG, ...config };

  // Filter suppliers based on config
  let candidates = suppliers;

  if (!fullConfig.includeInactive) {
    candidates = candidates.filter(s => s.isActive);
  }

  if (!fullConfig.includeHidden) {
    candidates = candidates.filter(s => !s.isHidden);
  }

  // Calculate scores for all candidates
  const scores: Array<{
    supplier: Supplier;
    score: number;
    matchedOn: string;
    matchType: SupplierMatchType;
  }> = [];

  for (const supplier of candidates) {
    const { score, matchedOn, matchType } = calculateSupplierMatchScore(name, supplier);
    if (score >= fullConfig.minConfidence) {
      scores.push({ supplier, score, matchedOn, matchType });
    }
  }

  // Sort by score descending
  scores.sort((a, b) => b.score - a.score);

  // No matches found
  if (scores.length === 0) {
    return {
      originalName: name,
      matchedSupplier: null,
      confidence: 0,
      matchType: "no_match",
      matchedOn: null,
      requiresReview: true,
      alternatives: [],
    };
  }

  // Get best match
  const bestMatch = scores[0];

  // Get alternatives (excluding best match)
  const alternatives: AlternativeSupplierMatch[] = scores
    .slice(1, fullConfig.maxAlternatives + 1)
    .map(s => ({
      supplier: s.supplier,
      confidence: s.score,
      matchedOn: s.matchedOn,
    }));

  return {
    originalName: name,
    matchedSupplier: bestMatch.supplier,
    confidence: bestMatch.score,
    matchType: bestMatch.matchType,
    matchedOn: bestMatch.matchedOn,
    requiresReview: bestMatch.score < fullConfig.reviewThreshold,
    alternatives,
  };
}

/**
 * Match multiple supplier names in batch
 */
export function matchSupplierNames(
  names: string[],
  suppliers: Supplier[],
  config: Partial<SupplierMatcherConfig> = {}
): SupplierBatchMatchResult {
  const results = names.map(name => matchSupplierName(name, suppliers, config));

  // Calculate summary
  const matched = results.filter(r => r.matchedSupplier && !r.requiresReview);
  const needsReview = results.filter(r => r.matchedSupplier && r.requiresReview);
  const unmatched = results.filter(r => !r.matchedSupplier);

  const matchedResults = results.filter(r => r.matchedSupplier);
  const averageConfidence = matchedResults.length > 0
    ? matchedResults.reduce((sum, r) => sum + r.confidence, 0) / matchedResults.length
    : 0;

  return {
    results,
    summary: {
      total: names.length,
      matched: matched.length,
      needsReview: needsReview.length,
      unmatched: unmatched.length,
      averageConfidence: Math.trunc(averageConfidence * 100) / 100,
    },
  };
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Get unique unmatched supplier names from match results
 * Useful for identifying names that need aliases added
 */
export function getUnmatchedSupplierNames(results: SupplierMatchResult[]): string[] {
  const unmatched = results
    .filter(r => !r.matchedSupplier)
    .map(r => r.originalName);

  return [...new Set(unmatched)];
}

/**
 * Get supplier names that need review (matched but low confidence)
 */
export function getSuppliersNeedingReview(results: SupplierMatchResult[]): Array<{
  name: string;
  suggestedMatch: Supplier;
  confidence: number;
}> {
  return results
    .filter(r => r.matchedSupplier && r.requiresReview)
    .map(r => ({
      name: r.originalName,
      suggestedMatch: r.matchedSupplier!,
      confidence: r.confidence,
    }));
}

/**
 * Suggest BKMV aliases based on fuzzy matched names
 * Returns a map of supplier ID to suggested aliases
 */
export function suggestBkmvAliases(
  results: SupplierMatchResult[]
): Map<string, string[]> {
  const suggestions = new Map<string, string[]>();

  for (const result of results) {
    // Only suggest for fuzzy matches (not exact)
    if (
      result.matchedSupplier &&
      (result.matchType === "fuzzy_name" || result.matchType === "fuzzy_alias") &&
      result.confidence >= 0.85 // Only high-confidence fuzzy matches
    ) {
      const supplierId = result.matchedSupplier.id;
      const existing = suggestions.get(supplierId) || [];

      // Don't suggest if already an alias or the primary name
      const normalizedOriginal = normalizeName(result.originalName);
      const normalizedPrimary = normalizeName(result.matchedSupplier.name);
      const existingAliases = (result.matchedSupplier.bkmvAliases || []).map(normalizeName);

      if (
        normalizedOriginal !== normalizedPrimary &&
        !existingAliases.includes(normalizedOriginal) &&
        !existing.map(normalizeName).includes(normalizedOriginal)
      ) {
        existing.push(result.originalName);
        suggestions.set(supplierId, existing);
      }
    }
  }

  return suggestions;
}

/**
 * Result of matching BKMVDATA supplier entries with database suppliers
 */
export interface BkmvSupplierMatchingResult {
  /** Supplier name from BKMVDATA */
  bkmvName: string;
  /** Total amount for this supplier in the BKMVDATA file */
  amount: number;
  /** Transaction count */
  transactionCount: number;
  /** Match result from supplier matcher */
  matchResult: SupplierMatchResult;
}

/**
 * Match all suppliers from a BKMVDATA summary against the database
 *
 * Uses a greedy assignment algorithm to prevent duplicate supplier matches:
 * 1. Initial matching: Run matchSupplierName for each BKMV name
 * 2. Sort all entries by confidence DESC, then amount DESC (tiebreaker)
 * 3. Greedy assignment: Higher-confidence matches claim suppliers first.
 *    If a supplier is already claimed, re-match excluding all claimed suppliers.
 * 4. Sort results for display
 *
 * This prevents cases like:
 * - "ארגל" matching supplier "ארגל" at 100%
 * - "אראל" also matching supplier "ארגל" at 82% (wrong - should look for different supplier)
 *
 * Unlike the previous two-pass approach, this handles ALL duplicate collisions
 * (exact-vs-exact, exact-vs-fuzzy, fuzzy-vs-fuzzy).
 *
 * @param supplierSummary - Map of supplier names to their totals from BKMVDATA
 * @param suppliers - List of suppliers from the database to match against
 * @param config - Optional matching configuration
 * @param blacklistedNames - Optional set of normalized names to mark as blacklisted
 */
export function matchBkmvSuppliers(
  supplierSummary: Map<string, { totalAmount: number; transactionCount: number }>,
  suppliers: Supplier[],
  config: Partial<SupplierMatcherConfig> = {},
  blacklistedNames?: Set<string>
): BkmvSupplierMatchingResult[] {
  // Phase 1: Initial matching - run matchSupplierName for each BKMV name
  const entries: Array<{
    bkmvName: string;
    summary: { totalAmount: number; transactionCount: number };
    matchResult: SupplierMatchResult;
    isBlacklisted: boolean;
  }> = [];

  for (const [bkmvName, summary] of supplierSummary) {
    const normalizedBkmvName = normalizeName(bkmvName);
    const isBlacklisted = blacklistedNames?.has(normalizedBkmvName) ?? false;

    if (isBlacklisted) {
      const blacklistedResult: SupplierMatchResult = {
        originalName: bkmvName,
        matchedSupplier: null,
        confidence: 1,
        matchType: "blacklisted",
        matchedOn: "blacklist",
        requiresReview: false,
        alternatives: [],
      };
      entries.push({ bkmvName, summary, matchResult: blacklistedResult, isBlacklisted: true });
    } else {
      const matchResult = matchSupplierName(bkmvName, suppliers, config);
      entries.push({ bkmvName, summary, matchResult, isBlacklisted: false });
    }
  }

  // Phase 2: Sort by confidence DESC, then amount DESC (tiebreaker)
  // Higher-confidence entries get to claim their supplier first
  entries.sort((a, b) => {
    if (a.isBlacklisted !== b.isBlacklisted) return a.isBlacklisted ? 1 : -1;
    const confDiff = b.matchResult.confidence - a.matchResult.confidence;
    if (confDiff !== 0) return confDiff;
    return b.summary.totalAmount - a.summary.totalAmount;
  });

  // Phase 3: Greedy assignment - iterate sorted entries, claim suppliers
  const claimedSupplierIds = new Set<string>();
  const results: BkmvSupplierMatchingResult[] = [];

  for (const entry of entries) {
    const { bkmvName, summary, isBlacklisted } = entry;
    let { matchResult } = entry;

    // Blacklisted: keep as-is, no supplier to claim
    if (isBlacklisted) {
      results.push({
        bkmvName,
        amount: summary.totalAmount,
        transactionCount: summary.transactionCount,
        matchResult,
      });
      continue;
    }

    if (matchResult.matchedSupplier) {
      if (!claimedSupplierIds.has(matchResult.matchedSupplier.id)) {
        // Supplier not yet claimed - claim it
        claimedSupplierIds.add(matchResult.matchedSupplier.id);

        // Filter alternatives to exclude already-claimed suppliers
        matchResult = {
          ...matchResult,
          alternatives: matchResult.alternatives.filter(
            alt => !claimedSupplierIds.has(alt.supplier.id)
          ),
        };
      } else {
        // Supplier already claimed by a higher-confidence entry
        // Re-match excluding all claimed suppliers
        const availableSuppliers = suppliers.filter(s => !claimedSupplierIds.has(s.id));
        matchResult = matchSupplierName(bkmvName, availableSuppliers, config);

        // If we got a new match, claim it
        if (matchResult.matchedSupplier) {
          claimedSupplierIds.add(matchResult.matchedSupplier.id);
        }

        // Filter alternatives to exclude claimed suppliers
        matchResult = {
          ...matchResult,
          alternatives: matchResult.alternatives.filter(
            alt => !claimedSupplierIds.has(alt.supplier.id)
          ),
        };
      }
    }

    results.push({
      bkmvName,
      amount: summary.totalAmount,
      transactionCount: summary.transactionCount,
      matchResult,
    });
  }

  // Phase 4: Sort for display
  /**
   * מיון תוצאות לפי איכות ההתאמה:
   * 1. התאמות 100% ראשונות (exact matches)
   * 2. התאמות חלקיות שניות (fuzzy matches)
   * 3. לא מותאם אחרון
   * 4. Blacklisted בסוף (מוסתר בד"כ)
   *
   * בתוך כל קבוצה - מיון לפי סכום יורד
   */
  results.sort((a, b) => {
    const getPriority = (r: BkmvSupplierMatchingResult): number => {
      if (r.matchResult.matchType === "blacklisted") return 4;
      if (r.matchResult.confidence === 1 && r.matchResult.matchedSupplier) return 1;
      if (r.matchResult.matchedSupplier) return 2;
      return 3;
    };

    const priorityDiff = getPriority(a) - getPriority(b);
    if (priorityDiff !== 0) return priorityDiff;

    return b.amount - a.amount;
  });

  return results;
}
