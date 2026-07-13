import type { MetadataFinding } from '../types';

export type HeicBlockReason =
  | 'malformed'
  | 'too-large'
  | 'too-many-images'
  | 'no-primary-image'
  | 'auxiliary-image'
  | 'depth-map'
  | 'animation'
  | 'unsupported-colour'
  | 'decode-failed'
  | 'resource-limit';

export interface HeicBlock {
  blocked: true;
  reason: HeicBlockReason;
  message: string;
}

export interface HeicScanData {
  brands: string[];
  dimensions: { width: number; height: number };
  imageCount: number;
  metadataContainers: string[];
  hasAlpha: boolean;
  orientation: number | null;
  outputFormat: 'jpeg' | 'png';
  colourHandling: string;
  findings: MetadataFinding[];
  unsupportedMetadataRisk: string[];
  sourceMetadataSentinels: string[];
}

export interface HeicVerification {
  sourceMetadataContainersDetected: string[];
  exportedFormat: 'jpeg' | 'png';
  personalMetadataTransferred: false;
  outputVerificationPassed: boolean;
  orientationApplied: boolean;
  colourHandling: string;
  remainingUnsupportedMetadataRisk: string[];
}

export interface HeicPreflight {
  brands: string[];
  dimensions: { width: number; height: number } | null;
  imageCount: number;
  metadataContainers: string[];
  hasAlpha: boolean;
  orientation: number | null;
  outputFormat: 'jpeg' | 'png';
  colourHandling: string;
  sourceMetadataSentinels: string[];
}
