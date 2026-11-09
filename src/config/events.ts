/**
 * Events aggregator (D435): web3 and tech events from official open data.
 * Registration and organizer submissions are a later stage.
 */
export const EVENT_TOPICS = [
  "web3",
  "ai",
  "dev",
  "data",
  "security",
  "devops",
  "product",
  "design",
  "business",
  "career",
] as const;
export type EventTopic = (typeof EVENT_TOPICS)[number];

export const EVENT_KINDS = [
  "summit",
  "conference",
  "meetup",
  "hackathon",
  "business",
  "career",
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export const EVENT_FORMATS = ["online", "offline", "hybrid"] as const;
export type EventFormat = (typeof EVENT_FORMATS)[number];

export const EVENT_STATUSES = ["published", "removed", "expired"] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

/**
 * Event feeds the code knows. A feed runs live only when the founder has
 * approved it (D18) and its name is listed in EVENTS_IMPORT_SOURCES. The
 * default is empty: nothing is fetched.
 */
export const KNOWN_EVENT_SOURCES = ["confs.tech", "ccfddl"] as const;

export function approvedEventSources(
  value: string | undefined = process.env.EVENTS_IMPORT_SOURCES,
): string[] {
  if (!value) return [];
  const known = new Set<string>(KNOWN_EVENT_SOURCES);
  return [
    ...new Set(
      value
        .split(",")
        .map((name) => name.trim())
        .filter((name) => known.has(name)),
    ),
  ];
}
