import type { EngagementLink } from "./types";

export const KIND_LABELS: Record<EngagementLink["kind"], string> = {
  challenge: "Challenge",
  class: "Class link",
  group: "Group test",
  public: "Public test",
  post: "Question post",
};

/** Where the admin can open a link. A group test's links belong to each member, so it has none. */
export function linkUrl(l: EngagementLink): string {
  if (!l.token) return "";
  return { challenge: `/c/${l.token}`, class: `/class/${l.token}`, public: `/p/${l.token}`, post: `/q/${l.token}`, group: "" }[l.kind];
}
