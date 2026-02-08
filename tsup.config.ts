import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'index': 'src/index.ts',
    'lib': 'src/lib.ts',
  },
  format: ['esm'],
  target: 'node18',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  minify: false,
  treeshake: {
    preset: 'smallest',
  },
  splitting: false,
  sourcemap: true,
  dts: {
    entry: { 'lib': 'src/lib.ts' },
  },
  esbuildOptions(options) {
    options.banner = {
      js: '// Architect AI - CLI\n',
    };
  },
  onSuccess: async () => {
    // Add shebang to index.js after build
    const fs = await import('fs/promises');
    const indexPath = './dist/index.js';
    const content = await fs.readFile(indexPath, 'utf-8');
    if (!content.startsWith('#!/usr/bin/env node')) {
      await fs.writeFile(indexPath, `#!/usr/bin/env node\n${content}`);
    }
  },
});