/**
 * BKMVDATA Router - main entry point for parsing BKMVDATA files
 *
 * Decodes the buffer, classifies the software type, parses the content,
 * and builds summaries. This is the function that external code calls.
 */

import type { BkmvParseResult } from './types';
import { decodeBuffer } from './encoding';
import { classifyBkmvFile } from './classifier';
import { parseContent } from './parser';
import { buildSupplierSummary, buildRevenueSummary } from './summaries';

/**
 * Main parser function - decodes, classifies, parses, and builds summaries
 */
export function parseBkmvData(content: string | Buffer): BkmvParseResult {
  const textContent = Buffer.isBuffer(content) ? decodeBuffer(content) : content;

  const softwareType = classifyBkmvFile(textContent);

  const result = parseContent(textContent, softwareType);

  buildSupplierSummary(result);
  buildRevenueSummary(result);

  return result;
}
