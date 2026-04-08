export const ERRAND_TYPES = [
  { slug: 'delivery', name: 'Delivery', icon: 'Package' },
  { slug: 'grocery', name: 'Grocery Shopping', icon: 'ShoppingCart' },
  { slug: 'food', name: 'Food Pickup', icon: 'UtensilsCrossed' },
  { slug: 'document', name: 'Document Delivery', icon: 'FileText' },
  { slug: 'laundry', name: 'Laundry', icon: 'Shirt' },
  { slug: 'transportation', name: 'Transportation', icon: 'Car' },
  { slug: 'custom', name: 'Custom Errand', icon: 'PenTool' },
] as const;

export type ErrandTypeSlug = (typeof ERRAND_TYPES)[number]['slug'];
