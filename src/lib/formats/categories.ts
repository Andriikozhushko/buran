import type { MetadataCategory, MetadataFinding } from './types';

export interface CategoryDefinition {
  id: MetadataCategory;
  label: string;
  description: string;
}

export const CATEGORIES: CategoryDefinition[] = [
  {
    id: 'geolocation',
    label: 'Geolocation',
    description: 'GPS coordinates and location data',
  },
  {
    id: 'device',
    label: 'Device and camera',
    description: 'Device, camera model and lens information',
  },
  {
    id: 'author',
    label: 'Author and owner',
    description: 'Author name, copyright and owner data',
  },
  {
    id: 'dates',
    label: 'Dates and history',
    description: 'Capture, modification and creation date/time',
  },
  {
    id: 'software',
    label: 'Editor / Software',
    description: 'Software used to create or edit the file',
  },
  {
    id: 'thumbnails',
    label: 'Embedded previews',
    description: 'Embedded thumbnails and image previews',
  },
  {
    id: 'containers',
    label: 'Metadata containers',
    description: 'Detected metadata blocks and segments',
  },
  {
    id: 'other',
    label: 'Other',
    description: 'Other detected metadata',
  },

  // --- PDF metadata categories (milestone 02A) ---
  {
    id: 'pdf-author',
    label: 'Author and owner',
    description: 'Document author name and owner details',
  },
  {
    id: 'pdf-title',
    label: 'Title and description',
    description: 'Document title, subject and keywords',
  },
  {
    id: 'pdf-dates',
    label: 'Dates and history',
    description: 'Document creation and modification dates',
  },
  {
    id: 'pdf-software',
    label: 'Editor / creating application',
    description: 'Creator application and PDF producer',
  },
  {
    id: 'pdf-custom',
    label: 'Custom properties',
    description: 'Non-standard document properties and app-private data',
  },
  {
    id: 'pdf-xmp',
    label: 'XMP metadata',
    description: 'XMP metadata: author, description, software, dates, custom fields',
  },
  {
    id: 'pdf-identifiers',
    label: 'Document identifiers',
    description: 'Trailer file identifier and related identifiers',
  },
  {
    id: 'pdf-annotations',
    label: 'Comment authors',
    description: 'Author names in comments and annotations (comment text is preserved)',
  },

  // --- Office (DOCX/XLSX/PPTX) metadata categories (milestone 02B) ---
  {
    id: 'office-author',
    label: 'Author and owner',
    description: 'Document author and who last modified it',
  },
  {
    id: 'office-app',
    label: 'Company and application',
    description: 'Company, manager, creating application and template',
  },
  {
    id: 'office-dates',
    label: 'Dates and history',
    description: 'Creation, modification, printing dates and revision counter',
  },
  {
    id: 'office-custom',
    label: 'Custom properties',
    description: 'Title, subject, keywords and custom document properties',
  },
  {
    id: 'office-comment-authors',
    label: 'Comment authors',
    description: 'Author names in comments and notes (comment text is preserved)',
  },
  {
    id: 'office-revisions',
    label: 'Revision history',
    description: 'Revision authors and dates, edit session identifiers',
  },
  {
    id: 'office-embedded-images',
    label: 'Embedded image metadata',
    description: 'Personal metadata of images inside the document (EXIF/GPS, etc.)',
  },
  {
    id: 'office-container',
    label: 'File container metadata',
    description: 'Timestamps and service data of the document ZIP container',
  },
  {
    id: 'zip-container',
    label: 'Archive metadata',
    description: 'ZIP comment, timestamps, extra fields and external attributes of archive entries',
  },
];

export function groupByCategory(findings: MetadataFinding[]): Map<MetadataCategory, MetadataFinding[]> {
  const map = new Map<MetadataCategory, MetadataFinding[]>();
  for (const f of findings) {
    const existing = map.get(f.category);
    if (existing) {
      existing.push(f);
    } else {
      map.set(f.category, [f]);
    }
  }
  return map;
}
