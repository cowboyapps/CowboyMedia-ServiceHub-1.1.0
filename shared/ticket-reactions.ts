export const TICKET_REACTIONS = [
  { emoji: "👍", label: "Thumbs up" },
  { emoji: "❤️", label: "Heart" },
  { emoji: "😂", label: "Laugh" },
  { emoji: "😮", label: "Surprised" },
  { emoji: "😢", label: "Sad" },
  { emoji: "🙏", label: "Thank you" },
  { emoji: "🎉", label: "Celebrate" },
  { emoji: "✅", label: "Done" },
  { emoji: "👀", label: "Looking" },
  { emoji: "🤔", label: "Thinking" },
  { emoji: "👏", label: "Applause" },
  { emoji: "🔥", label: "Great" },
] as const;
export const TICKET_REACTION_EMOJIS: readonly string[] = TICKET_REACTIONS.map(({ emoji }) => emoji);
export type TicketReactionSummary = { emoji: string; count: number; reacted: boolean };
