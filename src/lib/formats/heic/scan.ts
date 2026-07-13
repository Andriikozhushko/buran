import type { MetadataFinding } from '../types';
import { heicBlock, preflightHeic, readHeicOrientationFromExif } from './preflight';
import type { HeicBlock, HeicScanData } from './types';

export async function scanHeic(buffer: ArrayBuffer): Promise<{ data: HeicScanData } | HeicBlock> {
  const preflight = preflightHeic(buffer);
  if ('blocked' in preflight) return preflight;
  const dimensions = preflight.dimensions;
  if (!dimensions) return heicBlock('malformed', 'Не удалось безопасно определить размеры HEIC/HEIF.');
  const orientation = readHeicOrientationFromExif(buffer) ?? preflight.orientation;
  const findings: MetadataFinding[] = [];

  if (preflight.metadataContainers.length > 0) {
    findings.push({
      category: 'containers',
      field: 'HEIC:MetadataContainer',
      label: 'HEIC metadata container',
      value: preflight.metadataContainers.join(', '),
      severity: 'high',
      description: '',
    });
  }
  if (orientation && orientation !== 1) {
    findings.push({
      category: 'other',
      field: 'HEIC:Orientation',
      label: 'Image orientation',
      value: `Value ${orientation}`,
      severity: 'medium',
      description: '',
    });
  }
  if (preflight.metadataContainers.some((item) => /ICC|colour|color|NCLX/i.test(item))) {
    findings.push({
      category: 'other',
      field: 'HEIC:ColourProfile',
      label: 'HEIC colour profile',
      value: 'Present',
      severity: 'low',
      description: '',
    });
  }

  return {
    data: {
      ...preflight,
      dimensions,
      orientation,
      findings,
      unsupportedMetadataRisk: [
        'HEIC/HEIF экспорт создаётся из декодированных пикселей; исходные контейнеры метаданных не переносятся.',
        'Исходный ICC/широкий цветовой профиль не заявляется как сохранённый.',
      ],
    },
  };
}

export { heicBlock };
