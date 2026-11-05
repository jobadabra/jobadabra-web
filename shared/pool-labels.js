// The fixed role kinds and regions the pool, the employer index and the intelligence page agree on. Used by api/pool.js, api/employers.js,
// shared/intelligence.js and shared/scoutingvisual.js. Guarded by test/unit/api/pool.test.js.
export const ROLES = ['software', 'sre_devops', 'data', 'security', 'mobile', 'qa', 'management', 'sales_b2b', 'sales_retail', 'logistics', 'hospitality', 'healthcare', 'creative_media', 'finance_admin', 'education', 'trades', 'engineering', 'business_ops', 'manufacturing', 'science', 'customer_service', 'legal', 'aviation_transport', 'public_security', 'other'];   // src/contribute.py: IT families, then src/role_kinds.py's other trades
// The kinds of role (src/role_kinds.py KINDS): what an employer mostly hires for and what a search looks for. The site lands first, so it may know
// more kinds than the engine, never fewer. Every other copy here (api/employers.js KINDS, ROLES above, shared/search-report.js FAMILIES) is checked
// against this one by test/unit/shared/role-kinds.test.js. 26 Oct 2026: 8 kinds split out of 'other' (4,452 of the heatmap's employer cells sat there).
export const KINDS = ['software', 'sales_b2b', 'sales_retail', 'logistics', 'hospitality', 'healthcare', 'creative_media', 'finance_admin', 'education', 'trades',
  'engineering', 'business_ops', 'manufacturing', 'science', 'customer_service', 'legal', 'aviation_transport', 'public_security', 'other'];
export const KIND_NAMES = {software: 'Software & IT', sales_b2b: 'B2B sales', sales_retail: 'Retail', logistics: 'Logistics', hospitality: 'Hospitality',
  healthcare: 'Healthcare', creative_media: 'Creative & media', finance_admin: 'Finance & admin', education: 'Education', trades: 'Trades',
  engineering: 'Engineering', business_ops: 'Business & ops', manufacturing: 'Manufacturing', science: 'Science & research', customer_service: 'Customer service',
  legal: 'Legal', aviation_transport: 'Aviation & transport', public_security: 'Public & security', other: 'Other'};
export const REGIONS = ['europe', 'north_america', 'latin_america', 'asia_pacific', 'middle_east_africa', 'remote'];
