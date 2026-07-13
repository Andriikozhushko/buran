import type { MetadataFinding, SupportedFormat } from '../types';

export type ZipBlockReason =
  | 'encrypted'
  | 'multi-volume'
  | 'malformed'
  | 'too-large'
  | 'too-many-entries'
  | 'zip-bomb'
  | 'too-deep'
  | 'entry-too-large'
  | 'path-traversal'
  | 'duplicate-path'
  | 'unsupported-package'
  | 'verification-failed'
  | 'nested-clean-failed';

export interface ZipBlock {
  blocked: true;
  reason: ZipBlockReason;
  message: string;
  entryPath?: string;
}

export type ZipEntryStatus = 'ready' | 'clean' | 'blocked' | 'unchanged';

export interface ZipSupportedEntryScan {
  path: string;
  format: SupportedFormat;
  size: number;
  findingsCount: number;
  status: ZipEntryStatus;
  preserved: string;
  nestedDepth: number;
  rawMetadataValues: string[];
}

export interface ZipUnsupportedEntryScan {
  path: string;
  extension: string;
  size: number;
  status: 'unchanged';
  message: string;
  nestedDepth: number;
}

export interface ZipContainerMetadataScan {
  entryTimestamps: number;
  unixPermissionFields: number;
  externalAttributeFields: number;
  extraFields: number;
  archiveCommentFound: boolean;
  hostPlatformFields: number;
}

export interface ZipScanData {
  findings: MetadataFinding[];
  totalEntries: number;
  totalFiles: number;
  uncompressedSize: number;
  supportedEntries: ZipSupportedEntryScan[];
  unsupportedEntries: ZipUnsupportedEntryScan[];
  nestedArchiveCount: number;
  containerMetadata: ZipContainerMetadataScan;
  rawMetadataValues: string[];
  unsupportedMetadataRisk: string[];
}

export interface ZipVerification {
  archiveCommentRemoved: boolean;
  timestampsNormalised: boolean;
  extraFieldsNeutralised: boolean;
  externalAttributesNeutralised: boolean;
  structurePreserved: boolean;
  supportedEntriesVerified: number;
  supportedEntriesFailed: number;
  unsupportedEntriesUnchanged: number;
  nestedArchivesVerified: number;
  verificationPassed: boolean;
  remainingUnsupportedMetadataRisk: string[];
}
