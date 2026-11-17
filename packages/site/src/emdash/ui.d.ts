// EmDash's `emdash/ui`, at the version @himlio/site pins. Import from here, not from `emdash/ui`:
// sites don't depend on EmDash themselves, so the version can't drift.
// Shipped as written, not compiled: its types include Astro components, which tsc can't read.
export * from 'emdash/ui';
