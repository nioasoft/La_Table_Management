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
 */
export const DEFAULT_SUPPLIER_MATCHER_CONFIG: SupplierMatcherConfig = {
  minConfidence: 0.7,
  reviewThreshold: 0.85,
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
      averageConfidence: Math.round(averageConfidence * 100) / 100,
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
 * IMPORTANT: Uses a two-pass approach to prevent duplicate supplier matches:
 * 1. First pass: Find all exact matches (100% confidence)
 * 2. Second pass: For non-exact matches, exclude suppliers already matched exactly
 *
 * This prevents cases like:
 * - "ארגל" matching supplier "ארגל" at 100%
 * - "אראל" also matching supplier "ארגל" at 82% (wrong - should look for different supplier)
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
  const results: BkmvSupplierMatchingResult[] = [];

  // Track suppliers that have been matched with exact (100%) confidence
  const exactMatchedSupplierIds = new Set<string>();

  // First pass: Find all exact matches
  const firstPassResults: Array<{
    bkmvName: string;
    summary: { totalAmount: number; transactionCount: number };
    matchResult: SupplierMatchResult;
    isBlacklisted: boolean;
  }> = [];

  for (const [bkmvName, summary] of supplierSummary) {
    // Check if this name is blacklisted
    const normalizedBkmvName = normalizeName(bkmvName);
    const isBlacklisted = blacklistedNames?.has(normalizedBkmvName) ?? false;

    if (isBlacklisted) {
      // Create a blacklisted match result
      const blacklistedResult: SupplierMatchResult = {
        originalName: bkmvName,
        matchedSupplier: null,
        confidence: 1, // 100% confident this is blacklisted
        matchType: "blacklisted",
        matchedOn: "blacklist",
        requiresReview: false, // No review needed, it's intentionally blacklisted
        alternatives: [],
      };
      firstPassResults.push({ bkmvName, summary, matchResult: blacklistedResult, isBlacklisted: true });
    } else {
      // Regular supplier matching
      const matchResult = matchSupplierName(bkmvName, suppliers, config);
      firstPassResults.push({ bkmvName, summary, matchResult, isBlacklisted: false });

      // Track exact matches (confidence === 1)
      if (matchResult.matchedSupplier && matchResult.confidence === 1) {
        exactMatchedSupplierIds.add(matchResult.matchedSupplier.id);
      }
    }
  }

  // Second pass: Re-match non-exact matches, excluding already-matched suppliers
  for (const { bkmvName, summary, matchResult, isBlacklisted } of firstPassResults) {
    // If this is blacklisted, keep it as-is (no supplier matching needed)
    if (isBlacklisted) {
      results.push({
        bkmvName,
        amount: summary.totalAmount,
        transactionCount: summary.transactionCount,
        matchResult,
      });
      continue;
    }

    // If this was an exact match, keep it as-is
    if (matchResult.matchedSupplier && matchResult.confidence === 1) {
      results.push({
        bkmvName,
        amount: summary.totalAmount,
        transactionCount: summary.transactionCount,
        matchResult,
      });
      continue;
    }

    // For non-exact matches, check if the matched supplier was already claimed
    if (matchResult.matchedSupplier && exactMatchedSupplierIds.has(matchResult.matchedSupplier.id)) {
      // This supplier was already matched exactly to another name
      // Try to find a different match excluding already-matched suppliers
      const availableSuppliers = suppliers.filter(s => !exactMatchedSupplierIds.has(s.id));
      const newMatchResult = matchSupplierName(bkmvName, availableSuppliers, config);

      results.push({
        bkmvName,
        amount: summary.totalAmount,
        transactionCount: summary.transactionCount,
        matchResult: newMatchResult,
      });
    } else {
      // Keep the original match result
      results.push({
        bkmvName,
        amount: summary.totalAmount,
        transactionCount: summary.transactionCount,
        matchResult,
      });
    }
  }

  // Sort by amount descending (largest suppliers first)
  results.sort((a, b) => b.amount - a.amount);

  return results;
}
