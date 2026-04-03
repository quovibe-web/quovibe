export interface TemplateCategory {
  name: string;
  color: string;
  children?: TemplateCategory[];
}

export interface TaxonomyTemplate {
  key: string;
  defaultName: string;
  categories: TemplateCategory[];
}

// Curated 16-color palette for category colors
export const PALETTE = [
  '#4ade80', '#f97316', '#a78bfa', '#38bdf8',
  '#f472b6', '#facc15', '#34d399', '#fb923c',
  '#818cf8', '#22d3ee', '#e879f9', '#fbbf24',
  '#6ee7b7', '#f87171', '#60a5fa', '#c084fc',
];

function p(i: number): string {
  return PALETTE[i % PALETTE.length];
}

// Taxonomy template: Asset Classes
const assetClasses: TaxonomyTemplate = {
  key: 'asset-classes',
  defaultName: 'Asset Classes',
  categories: [
    { name: 'Cash', color: p(0) },
    { name: 'Equity', color: p(1) },
    { name: 'Debt', color: p(2) },
    { name: 'Real Estate', color: p(3) },
    { name: 'Commodity', color: p(4) },
  ],
};

// Taxonomy template: Industries (GICS Sectors)
const industriesGicsSectors: TaxonomyTemplate = {
  key: 'industries-gics-sectors',
  defaultName: 'Industries (GICS, Sectors)',
  categories: [
    { name: 'Energy', color: p(0) },
    { name: 'Materials', color: p(1) },
    { name: 'Industrials', color: p(2) },
    { name: 'Consumer Discretionary', color: p(3) },
    { name: 'Consumer Staples', color: p(4) },
    { name: 'Health Care', color: p(5) },
    { name: 'Financials', color: p(6) },
    { name: 'Information Technology', color: p(7) },
    { name: 'Communication Services', color: p(8) },
    { name: 'Utilities', color: p(9) },
    { name: 'Real Estate', color: p(10) },
  ],
};

// Taxonomy template: Industry (non-GICS)
const industry: TaxonomyTemplate = {
  key: 'industry',
  defaultName: 'Industry',
  categories: [
    { name: 'Construction Industry', color: p(0) },
    { name: 'Biotechnology', color: p(1) },
    { name: 'Chemistry', color: p(2) },
    { name: 'Energy', color: p(3) },
    { name: 'Financial Services', color: p(4) },
    { name: 'Food & Beverages', color: p(5) },
    { name: 'Trade & Retail', color: p(6) },
    { name: 'Industry & Production', color: p(7) },
    { name: 'Consumer Goods', color: p(8) },
    { name: 'Logistics & Transport', color: p(9) },
    { name: 'Media', color: p(10) },
    { name: 'Pharmaceutical', color: p(11) },
    { name: 'Technology', color: p(12) },
    { name: 'Telecommunication', color: p(13) },
    { name: 'Insurance', color: p(14) },
    { name: 'Utilities', color: p(15) },
  ],
};

// Taxonomy template: Asset Allocation
const assetAllocation: TaxonomyTemplate = {
  key: 'asset-allocation',
  defaultName: 'Asset Allocation',
  categories: [
    { name: 'Risk Free', color: p(0), children: [
      { name: 'Deposit Accounts', color: p(1) },
    ]},
    { name: 'Risk Based', color: p(2), children: [
      { name: 'USA', color: p(3) },
      { name: 'Western Europe', color: p(4) },
      { name: 'Emerging Markets', color: p(5) },
      { name: 'Asia Pacific', color: p(6) },
      { name: 'Japan', color: p(7) },
      { name: 'Other', color: p(8) },
    ]},
  ],
};

// Taxonomy template: Regions
const regions: TaxonomyTemplate = {
  key: 'regions',
  defaultName: 'Regions',
  categories: [
    { name: 'Europe', color: p(0), children: [
      { name: 'Germany', color: p(0) },
      { name: 'France', color: p(1) },
      { name: 'United Kingdom', color: p(2) },
      { name: 'Switzerland', color: p(3) },
      { name: 'Italy', color: p(4) },
      { name: 'Spain', color: p(5) },
      { name: 'Netherlands', color: p(6) },
      { name: 'Sweden', color: p(7) },
      { name: 'Norway', color: p(8) },
      { name: 'Denmark', color: p(9) },
      { name: 'Finland', color: p(10) },
      { name: 'Belgium', color: p(11) },
      { name: 'Austria', color: p(12) },
      { name: 'Poland', color: p(13) },
      { name: 'Ireland', color: p(14) },
      { name: 'Portugal', color: p(15) },
    ]},
    { name: 'America', color: p(1), children: [
      { name: 'United States', color: p(0) },
      { name: 'Canada', color: p(1) },
      { name: 'Brazil', color: p(2) },
      { name: 'Mexico', color: p(3) },
      { name: 'Argentina', color: p(4) },
      { name: 'Chile', color: p(5) },
    ]},
    { name: 'Asia', color: p(2), children: [
      { name: 'China', color: p(0) },
      { name: 'Japan', color: p(1) },
      { name: 'South Korea', color: p(2) },
      { name: 'India', color: p(3) },
      { name: 'Taiwan', color: p(4) },
      { name: 'Hong Kong', color: p(5) },
      { name: 'Singapore', color: p(6) },
      { name: 'Indonesia', color: p(7) },
      { name: 'Thailand', color: p(8) },
      { name: 'Malaysia', color: p(9) },
      { name: 'Philippines', color: p(10) },
    ]},
    { name: 'Africa', color: p(3), children: [
      { name: 'South Africa', color: p(0) },
      { name: 'Nigeria', color: p(1) },
      { name: 'Egypt', color: p(2) },
      { name: 'Kenya', color: p(3) },
      { name: 'Morocco', color: p(4) },
    ]},
    { name: 'Oceania', color: p(4), children: [
      { name: 'Australia', color: p(0) },
      { name: 'New Zealand', color: p(1) },
    ]},
  ],
};

// Taxonomy template: Regions (MSCI)
const regionsMsci: TaxonomyTemplate = {
  key: 'regions-msci',
  defaultName: 'Regions (MSCI)',
  categories: [
    { name: 'Developed Markets', color: p(0), children: [
      { name: 'Australia', color: p(0) },
      { name: 'Austria', color: p(1) },
      { name: 'Belgium', color: p(2) },
      { name: 'Canada', color: p(3) },
      { name: 'Denmark', color: p(4) },
      { name: 'Finland', color: p(5) },
      { name: 'France', color: p(6) },
      { name: 'Germany', color: p(7) },
      { name: 'Hong Kong', color: p(8) },
      { name: 'Ireland', color: p(9) },
      { name: 'Israel', color: p(10) },
      { name: 'Italy', color: p(11) },
      { name: 'Japan', color: p(12) },
      { name: 'Netherlands', color: p(13) },
      { name: 'New Zealand', color: p(14) },
      { name: 'Norway', color: p(15) },
      { name: 'Portugal', color: p(0) },
      { name: 'Singapore', color: p(1) },
      { name: 'Spain', color: p(2) },
      { name: 'Sweden', color: p(3) },
      { name: 'Switzerland', color: p(4) },
      { name: 'United Kingdom', color: p(5) },
      { name: 'United States', color: p(6) },
    ]},
    { name: 'Emerging Markets', color: p(1), children: [
      { name: 'Brazil', color: p(0) },
      { name: 'Chile', color: p(1) },
      { name: 'China', color: p(2) },
      { name: 'Colombia', color: p(3) },
      { name: 'Czech Republic', color: p(4) },
      { name: 'Egypt', color: p(5) },
      { name: 'Greece', color: p(6) },
      { name: 'Hungary', color: p(7) },
      { name: 'India', color: p(8) },
      { name: 'Indonesia', color: p(9) },
      { name: 'South Korea', color: p(10) },
      { name: 'Kuwait', color: p(11) },
      { name: 'Malaysia', color: p(12) },
      { name: 'Mexico', color: p(13) },
      { name: 'Peru', color: p(14) },
      { name: 'Philippines', color: p(15) },
      { name: 'Poland', color: p(0) },
      { name: 'Qatar', color: p(1) },
      { name: 'Saudi Arabia', color: p(2) },
      { name: 'South Africa', color: p(3) },
      { name: 'Taiwan', color: p(4) },
      { name: 'Thailand', color: p(5) },
      { name: 'Turkey', color: p(6) },
      { name: 'United Arab Emirates', color: p(7) },
    ]},
    { name: 'Frontier & Standalone Markets', color: p(2), children: [
      { name: 'Argentina', color: p(0) },
      { name: 'Bahrain', color: p(1) },
      { name: 'Bangladesh', color: p(2) },
      { name: 'Croatia', color: p(3) },
      { name: 'Estonia', color: p(4) },
      { name: 'Iceland', color: p(5) },
      { name: 'Jordan', color: p(6) },
      { name: 'Kazakhstan', color: p(7) },
      { name: 'Kenya', color: p(8) },
      { name: 'Lithuania', color: p(9) },
      { name: 'Mauritius', color: p(10) },
      { name: 'Morocco', color: p(11) },
      { name: 'Nigeria', color: p(12) },
      { name: 'Oman', color: p(13) },
      { name: 'Pakistan', color: p(14) },
      { name: 'Romania', color: p(15) },
      { name: 'Serbia', color: p(0) },
      { name: 'Slovenia', color: p(1) },
      { name: 'Sri Lanka', color: p(2) },
      { name: 'Tunisia', color: p(3) },
      { name: 'Vietnam', color: p(4) },
    ]},
  ],
};

// Taxonomy template: Type of Security
const typeOfSecurity: TaxonomyTemplate = {
  key: 'type-of-security',
  defaultName: 'Type of Security',
  categories: [
    { name: 'Stock', color: p(0) },
    { name: 'Equity Fund', color: p(1) },
    { name: 'Exchange Traded Fund (ETF)', color: p(2) },
    { name: 'Bond', color: p(3) },
    { name: 'Stock Option', color: p(4) },
    { name: 'Index', color: p(5) },
    { name: 'Currency', color: p(6) },
  ],
};

export const TAXONOMY_TEMPLATES: TaxonomyTemplate[] = [
  assetClasses,
  industriesGicsSectors,
  industry,
  assetAllocation,
  regions,
  regionsMsci,
  typeOfSecurity,
];

export function getTemplate(key: string): TaxonomyTemplate | undefined {
  return TAXONOMY_TEMPLATES.find((t) => t.key === key);
}
