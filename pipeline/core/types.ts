/**
 * Core pipeline types. An Adapter knows how to find and parse one authority's
 * published files; everything downstream (validation, import, stats, flags) is shared.
 */

export type DatasetKind = "transactions" | "contracts" | "budget" | "decisions" | "documents" | "performance";

export interface AuthorityMeta {
  id: string;
  name: string;
  shortName: string;
  tier: "county" | "district" | "parish" | "unitary" | "other";
  area: string;
  website: string;
  onsCode?: string;
  population?: number;
  populationSource?: string;
  notes?: string;
}

/** A file an adapter has found on a council page (not yet downloaded). */
export interface DiscoveredFile {
  kind: DatasetKind;
  title: string;
  url: string;
  pageUrl: string;
  format: "csv" | "xlsx" | "xls" | "pdf" | "html" | "json";
  licence?: string;
  publishedAt?: string;   // ISO date if stated by the council
  periodStart?: string;   // ISO date
  periodEnd?: string;     // ISO date
}

export interface NormalisedTransaction {
  rowNumber: number;
  date: Date;
  supplierRaw: string;
  amount: number;         // GBP, 2dp
  amountIsNet?: boolean;
  department?: string;
  serviceArea?: string;
  category?: string;
  description?: string;
  reference?: string;
  extra?: Record<string, string>;
}

export interface NormalisedContract {
  rowNumber: number;
  reference?: string;
  title: string;
  description?: string;
  supplierRaw: string;
  value?: number;
  valueBasis?: string;
  awardDate?: Date;
  startDate?: Date;
  endDate?: Date;
  reviewDate?: Date;
  department?: string;
  category?: string;
  procurementRoute?: string;
  sourceRecordUrl?: string;
  extra?: Record<string, string>;
}

export interface RejectedRow {
  rowNumber: number;
  reason: string;
  raw: Record<string, string> | string;
}

export interface ParseResult<T> {
  rows: T[];
  rejected: RejectedRow[];
  headers: string[];          // headers as found in the file
  headerMap: Record<string, string>; // logical field -> source header
  notes: string[];            // anything a human should know (format quirks etc.)
}

export interface Adapter {
  id: string;
  authority: AuthorityMeta;
  /** Fetch council pages and list the files that exist right now. */
  discover(): Promise<DiscoveredFile[]>;
  /** Parse a downloaded transactions file into normalised rows. Must throw on an unrecognised format. */
  parseTransactions?(buffer: Buffer, file: DiscoveredFile): Promise<ParseResult<NormalisedTransaction>>;
  parseContracts?(buffer: Buffer, file: DiscoveredFile): Promise<ParseResult<NormalisedContract>>;
}

export class FormatChangedError extends Error {
  constructor(message: string, public details?: unknown) {
    super(message);
    this.name = "FormatChangedError";
  }
}
