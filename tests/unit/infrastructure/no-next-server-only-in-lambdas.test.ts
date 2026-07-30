import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function typescriptFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory()
      ? typescriptFiles(absolute)
      : entry.name.endsWith('.ts')
        ? [absolute]
        : [];
  });
}

describe('bundles das Lambdas autônomas', () => {
  it('não importam o marcador server-only do Next dentro da camada de infraestrutura', () => {
    const infrastructureRoot = path.resolve('src/infrastructure');
    const offenders = typescriptFiles(infrastructureRoot)
      .filter((file) => readFileSync(file, 'utf8').includes("import 'server-only'"))
      .map((file) => path.relative(process.cwd(), file));

    expect(offenders).toEqual([]);
  });
});
