/**
 * Sections of the site Spoki may hear about with a message (D525): the name
 * of the part the person has open, never an id or an address.
 */
export const PAGE_SECTIONS = [
  "jobs",
  "job",
  "employer",
  "ugc",
  "freelance",
  "events",
  "services",
  "account",
  "pricing",
  "other",
] as const;
export type PageSection = (typeof PAGE_SECTIONS)[number];
