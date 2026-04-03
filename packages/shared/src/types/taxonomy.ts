export interface TaxonomyCategory {
  id: string;
  name: string;
  parentId: string | null;
  taxonomyId: string | null;
  color: string | null;
  sortOrder: number | null;
  weight: number | null;
}

export interface TaxonomyAssignment {
  securityId: string;
  categoryId: string;
  weight: number | null;
}
