/**
 * Franchisee Fuzzy Matching Utility
 *
 * Provides fuzzy matching of franchisee names from supplier files using
 * the aliases system. Handles various name formats, spellings, and flags
 * unmatched entries for manual review.
 */

import type { Franchisee } from "@/db/schema";

// ============================================================================
// TYPES
// ============================================================================

/**
 * Match result for a single franchisee name lookup
 */
export interface FranchiseeMatchResult {
  /** The original name from the supplier file */
  originalName: string;
  /** The matched franchisee record, if found */
  matchedFranchisee: Franchisee | null;
  /** Confidence score 0-1 (1 = exact match) */
  confidence: number;
  /** Type of match found */
  matchType: MatchType;
  /** Which alias or field matched (for debugging) */
  matchedOn: string | null;
  /** Whether this match requires manual review */
  requiresReview: boolean;
  /** Alternative matches above threshold but not best match */
  alternatives: AlternativeMatch[];
}

/**
 * Alternative match suggestion
 */
export interface AlternativeMatch {
  franchisee: Franchisee;
  confidence: number;
  matchedOn: string;
}

/**
 * Type of match that was found
 */
export type MatchType =
  | "exact_name"      // Exact match on primary name
  | "exact_alias"     // Exact match on an alias
  | "exact_code"      // Exact match on franchisee code
  | "fuzzy_name"      // Fuzzy match on primary name
  | "fuzzy_alias"     // Fuzzy match on an alias
  | "no_match";       // No match found

/**
 * Configuration for the matching algorithm
 */
export interface MatcherConfig {
  /** Minimum confidence score to consider a match (0-1, default: 0.7) */
  minConfidence: number;
  /** Confidence threshold below which to flag for review (0-1, default: 0.85) */
  reviewThreshold: number;
  /** Maximum number of alternative matches to return (default: 3) */
  maxAlternatives: number;
  /** Whether to include inactive franchisees in matching (default: false) */
  includeInactive: boolean;
  /** Filter matches to a specific brand ID (optional) */
  brandId?: string;
}

/**
 * Default configuration
 * NOTE: reviewThreshold is set to 1.0 to require manual review for ALL fuzzy matches.
 * Only 100% exact matches will be auto-accepted. All other matches require manual approval.
 */
export const DEFAULT_MATCHER_CONFIG: MatcherConfig = {
  minConfidence: 0.7,
  reviewThreshold: 1.0, // Only 100% matches are auto-accepted
  maxAlternatives: 3,
  includeInactive: false,
};

/**
 * Batch matching result
 */
export interface BatchMatchResult {
  /** All match results */
  results: FranchiseeMatchResult[];
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
// STRING SIMILARITY ALGORITHMS
// ============================================================================

/**
 * Calculate Levenshtein distance between two strings
 * (minimum number of single-character edits needed to transform one into the other)
 */
export function levenshteinDistance(str1: string, str2: string): number {
  const m = str1.length;
  const n = str2.length;

  // Create distance matrix
  const dp: number[][] = Array(m + 1)
    .fill(null)
    .map(() => Array(n + 1).fill(0));

  // Initialize base cases
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  // Fill in the rest of the matrix
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (str1[i - 1] === str2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,     // deletion
          dp[i][j - 1] + 1,     // insertion
          dp[i - 1][j - 1] + 1  // substitution
        );
      }
    }
  }

  return dp[m][n];
}

/**
 * Calculate normalized similarity score (0-1) using Levenshtein distance
 * 1 = identical, 0 = completely different
 */
export function calculateSimilarity(str1: string, str2: string): number {
  if (str1 === str2) return 1;
  if (str1.length === 0 || str2.length === 0) return 0;

  const distance = levenshteinDistance(str1, str2);
  const maxLength = Math.max(str1.length, str2.length);

  return 1 - distance / maxLength;
}

/**
 * Calculate Jaro-Winkler similarity (better for names)
 * Returns score 0-1 where 1 is exact match
 */
export function jaroWinklerSimilarity(str1: string, str2: string): number {
  if (str1 === str2) return 1;
  if (str1.length === 0 || str2.length === 0) return 0;

  const matchWindow = Math.floor(Math.max(str1.length, str2.length) / 2) - 1;

  const str1Matches: boolean[] = Array(str1.length).fill(false);
  const str2Matches: boolean[] = Array(str2.length).fill(false);

  let matches = 0;
  let transpositions = 0;

  // Find matching characters
  for (let i = 0; i < str1.length; i++) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(i + matchWindow + 1, str2.length);

    for (let j = start; j < end; j++) {
      if (str2Matches[j] || str1[i] !== str2[j]) continue;
      str1Matches[i] = true;
      str2Matches[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0;

  // Count transpositions
  let k = 0;
  for (let i = 0; i < str1.length; i++) {
    if (!str1Matches[i]) continue;
    while (!str2Matches[k]) k++;
    if (str1[i] !== str2[k]) transpositions++;
    k++;
  }

  // Jaro similarity
  const jaro = (
    matches / str1.length +
    matches / str2.length +
    (matches - transpositions / 2) / matches
  ) / 3;

  // Common prefix (up to 4 chars)
  let prefix = 0;
  for (let i = 0; i < Math.min(4, str1.length, str2.length); i++) {
    if (str1[i] === str2[i]) prefix++;
    else break;
  }

  // Jaro-Winkler (boost for common prefix)
  return jaro + prefix * 0.1 * (1 - jaro);
}

/**
 * Combined similarity score using multiple algorithms
 * Weighted average of Levenshtein and Jaro-Winkler
 */
export function combinedSimilarity(str1: string, str2: string): number {
  const levSim = calculateSimilarity(str1, str2);
  const jwSim = jaroWinklerSimilarity(str1, str2);

  // Weight Jaro-Winkler higher for name matching (better with transpositions)
  return levSim * 0.4 + jwSim * 0.6;
}

// ============================================================================
// NAME NORMALIZATION
// ============================================================================

/**
 * Normalize a name for comparison
 * - Convert to lowercase
 * - Remove extra whitespace
 * - Remove common punctuation
 * - Normalize Hebrew characters
 */
export function normalizeName(name: string): string {
  if (!name) return "";

  return name
    .toLowerCase()
    .trim()
    // Remove common punctuation
    .replace(/[.,\-_'"()[\]{}!?:;#@&*+=/\\<>|`~^]/g, " ")
    // Normalize whitespace
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Generate name variants for comparison
 * Creates multiple versions of the name to improve matching
 */
export function generateNameVariants(name: string): string[] {
  const normalized = normalizeName(name);
  const variants = new Set<string>([normalized]);

  // Add version without common suffixes
  const suffixesToRemove = [
    "ltd", "inc", "corp", "בעמ", "בע\"מ", "llc", "limited",
    "branch", "סניף", "store", "חנות", "outlet"
  ];

  let withoutSuffix = normalized;
  for (const suffix of suffixesToRemove) {
    withoutSuffix = withoutSuffix.replace(new RegExp(`\\s*${suffix}\\s*$`, "i"), "").trim();
  }
  if (withoutSuffix !== normalized) {
    variants.add(withoutSuffix);
  }

  // Add version with numbers extracted (e.g., "Store 5" -> "store5", "store 5")
  const withoutSpaceBeforeNumbers = normalized.replace(/\s+(\d+)/g, "$1");
  if (withoutSpaceBeforeNumbers !== normalized) {
    variants.add(withoutSpaceBeforeNumbers);
  }

  // Add version with numbers as words (only for small numbers)
  const numberWords: Record<string, string> = {
    "1": "one", "2": "two", "3": "three", "4": "four", "5": "five",
    "6": "six", "7": "seven", "8": "eight", "9": "nine", "10": "ten"
  };

  // Add version without numbers
  const withoutNumbers = normalized.replace(/\d+/g, "").replace(/\s+/g, " ").trim();
  if (withoutNumbers !== normalized && withoutNumbers.length > 2) {
    variants.add(withoutNumbers);
  }

  return Array.from(variants);
}

// ============================================================================
// MATCHING ENGINE
// ============================================================================

/**
 * Calculate match score between a search name and a franchisee
 * Returns the best match details
 */
function calculateMatchScore(
  searchName: string,
  franchisee: Franchisee
): { score: number; matchedOn: string; matchType: MatchType } {
  const searchVariants = generateNameVariants(searchName);

  let bestScore = 0;
  let bestMatchedOn = "";
  let bestMatchType: MatchType = "no_match";

  // Check primary name
  const primaryNameVariants = generateNameVariants(franchisee.name);

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
  const normalizedCode = normalizeName(franchisee.code);
  if (normalizedSearch === normalizedCode) {
    return { score: 1, matchedOn: "code", matchType: "exact_code" };
  }

  // Check aliases
  const aliases = franchisee.aliases || [];
  for (const alias of aliases) {
    const aliasVariants = generateNameVariants(alias);

    for (const searchVariant of searchVariants) {
      for (const aliasVariant of aliasVariants) {
        // Check exact alias match
        if (searchVariant === aliasVariant) {
          return { score: 1, matchedOn: `alias:${alias}`, matchType: "exact_alias" };
        }

        // Calculate fuzzy similarity
        const score = combinedSimilarity(searchVariant, aliasVariant);
        if (score > bestScore) {
          bestScore = score;
          bestMatchedOn = `alias:${alias}`;
          bestMatchType = "fuzzy_alias";
        }
      }
    }
  }

  return { score: bestScore, matchedOn: bestMatchedOn, matchType: bestMatchType };
}

/**
 * Match a single franchisee name against a list of franchisees
 */
export function matchFranchiseeName(
  name: string,
  franchisees: Franchisee[],
  config: Partial<MatcherConfig> = {}
): FranchiseeMatchResult {
  const fullConfig: MatcherConfig = { ...DEFAULT_MATCHER_CONFIG, ...config };

  // Filter franchisees based on config
  let candidates = franchisees;

  if (!fullConfig.includeInactive) {
    candidates = candidates.filter(f => f.isActive);
  }

  if (fullConfig.brandId) {
    candidates = candidates.filter(f => f.brandId === fullConfig.brandId);
  }

  // Calculate scores for all candidates
  const scores: Array<{
    franchisee: Franchisee;
    score: number;
    matchedOn: string;
    matchType: MatchType;
  }> = [];

  for (const franchisee of candidates) {
    const { score, matchedOn, matchType } = calculateMatchScore(name, franchisee);
    if (score >= fullConfig.minConfidence) {
      scores.push({ franchisee, score, matchedOn, matchType });
    }
  }

  // Sort by score descending
  scores.sort((a, b) => b.score - a.score);

  // No matches found
  if (scores.length === 0) {
    return {
      originalName: name,
      matchedFranchisee: null,
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
  const alternatives: AlternativeMatch[] = scores
    .slice(1, fullConfig.maxAlternatives + 1)
    .map(s => ({
      franchisee: s.franchisee,
      confidence: s.score,
      matchedOn: s.matchedOn,
    }));

  return {
    originalName: name,
    matchedFranchisee: bestMatch.franchisee,
    confidence: bestMatch.score,
    matchType: bestMatch.matchType,
    matchedOn: bestMatch.matchedOn,
    requiresReview: bestMatch.score < fullConfig.reviewThreshold,
    alternatives,
  };
}

/**
 * Match multiple franchisee names in batch
 */
export function matchFranchiseeNames(
  names: string[],
  franchisees: Franchisee[],
  config: Partial<MatcherConfig> = {}
): BatchMatchResult {
  const results = names.map(name => matchFranchiseeName(name, franchisees, config));

  // Calculate summary
  const matched = results.filter(r => r.matchedFranchisee && !r.requiresReview);
  const needsReview = results.filter(r => r.matchedFranchisee && r.requiresReview);
  const unmatched = results.filter(r => !r.matchedFranchisee);

  const matchedResults = results.filter(r => r.matchedFranchisee);
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

/**
 * Match franchisee names from parsed file data
 * Returns augmented data with match results
 */
export function matchParsedFileData<T extends { franchisee: string }>(
  data: T[],
  franchisees: Franchisee[],
  config: Partial<MatcherConfig> = {}
): Array<T & { matchResult: FranchiseeMatchResult }> {
  return data.map(row => ({
    ...row,
    matchResult: matchFranchiseeName(row.franchisee, franchisees, config),
  }));
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Get unique unmatched names from match results
 * Useful for identifying names that need aliases added
 */
export function getUnmatchedNames(results: FranchiseeMatchResult[]): string[] {
  const unmatched = results
    .filter(r => !r.matchedFranchisee)
    .map(r => r.originalName);

  return [...new Set(unmatched)];
}

/**
 * Get names that need review (matched but low confidence)
 */
export function getNamesNeedingReview(results: FranchiseeMatchResult[]): Array<{
  name: string;
  suggestedMatch: Franchisee;
  confidence: number;
}> {
  return results
    .filter(r => r.matchedFranchisee && r.requiresReview)
    .map(r => ({
      name: r.originalName,
      suggestedMatch: r.matchedFranchisee!,
      confidence: r.confidence,
    }));
}

/**
 * Suggest aliases based on fuzzy matched names
 * Returns a map of franchisee ID to suggested aliases
 */
export function suggestAliases(
  results: FranchiseeMatchResult[]
): Map<string, string[]> {
  const suggestions = new Map<string, string[]>();

  for (const result of results) {
    // Only suggest for fuzzy matches (not exact)
    if (
      result.matchedFranchisee &&
      (result.matchType === "fuzzy_name" || result.matchType === "fuzzy_alias") &&
      result.confidence >= 0.85 // Only high-confidence fuzzy matches
    ) {
      const franchiseeId = result.matchedFranchisee.id;
      const existing = suggestions.get(franchiseeId) || [];

      // Don't suggest if already an alias or the primary name
      const normalizedOriginal = normalizeName(result.originalName);
      const normalizedPrimary = normalizeName(result.matchedFranchisee.name);
      const existingAliases = (result.matchedFranchisee.aliases || []).map(normalizeName);

      if (
        normalizedOriginal !== normalizedPrimary &&
        !existingAliases.includes(normalizedOriginal) &&
        !existing.map(normalizeName).includes(normalizedOriginal)
      ) {
        existing.push(result.originalName);
        suggestions.set(franchiseeId, existing);
      }
    }
  }

  return suggestions;
}
