/** Lint TypeScript sources without imposing formatting on the wire protocol. */
import tseslint from 'typescript-eslint';
export default tseslint.config({ignores:['dist/**','node_modules/**','packages/client/dist/**','coverage/**','.runtime/**','.impeccable/**']},...tseslint.configs.recommended,{rules:{'@typescript-eslint/no-explicit-any':'off','@typescript-eslint/no-unused-vars':['error',{argsIgnorePattern:'^_',varsIgnorePattern:'^_'}]}});

