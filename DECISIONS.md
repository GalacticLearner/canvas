# Decisions

- 2026-11-03: Product name: Canvas. Follow plan.md in its phase order. No PDF report, slides, or video will be authored.
- 2026-11-03: Installed impeccable skill v4.8.0 verified at C:/Users/Efanio Jens/.agents/skills/impeccable. Design-only use in phases 5 and 11. Existing hook consent is declined and will be respected. Commands include context, teach, shape, craft, critique, audit, polish, normalize, harden, adapt, animate.
- 2026-11-03: Host has Node 24.21.0; project targets Node 22 via .nvmrc and CI. Lockfile records exact installed dependencies. TypeScript/React/Vite/Electron/Vitest/esbuild/ESLint/Zustand/Zod/fractional-indexing/lucide use MIT; rbush ISC; jsPDF MIT; bundled fonts OFL. Packaging tools retain their published licenses; generate final inventory before delivery.
- 2026-11-03: A bounded transfer_chunk transport extension carries large logical snapshots/imports in 1 MiB chunks, preserving the 4 MiB frame ceiling; total is capped at 64 MiB with strict ordered reassembly and timeout. No extra runtime transport introduced.
- 2026-11-03: Upgraded Zod/jsPDF/Vitest to resolve high/critical npm audit findings. Current audit reports 25 moderate transitive/tooling findings; no high/critical findings. Native toolchain compatibility remains under test.
