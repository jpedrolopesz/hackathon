import { describe, expect, it } from 'vitest';
import type { Material } from '@/domain/entities/Material';

describe('Material', () => {
  it('represents an official discipline material', () => {
    const material: Material = {
      id: 'material-central-tendency',
      institutionId: 'institution-fictional',
      disciplineId: 'discipline-statistics',
      title: 'Medidas de tendência central',
      materialType: 'ARTICLE',
      sourceRef: 'materials/central-tendency.pdf',
      createdAt: '2026-01-11T10:00:00.000Z',
    };

    expect(material.disciplineId).toBe('discipline-statistics');
    expect(material.sourceRef).toBe('materials/central-tendency.pdf');
  });
});
