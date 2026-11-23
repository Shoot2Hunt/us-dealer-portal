/** Contact form topics, shared by the form, the server action and the Studio schema. */
export const CONTACT_TOPICS = [
  { title: "General question", value: "general" },
  { title: "Becoming a dealer", value: "dealer" },
  { title: "Pricing", value: "pricing" },
  { title: "An order", value: "order" },
  { title: "My account", value: "account" },
  { title: "Something else", value: "other" },
] as const;

export type ContactTopic = (typeof CONTACT_TOPICS)[number]["value"];
